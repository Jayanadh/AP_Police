"""Live location while on duty.

A driver starts a trip with the duty particulars; the phone then sends batches of where it was (each location with
the phone's own time, so a batch kept while offline, or sent later by a phone app running in the background, still
lands in the right place); the driver stops the trip on returning. Only the MTO of the vehicle's office sees it.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.models import Role, User, UserStatus
from common.exceptions import BusinessRuleError
from fleet.models import AssignmentKind, Vehicle, VehicleAssignment, VehicleStatus
from fleet.services import current_vehicle_for
from tracking.models import DutyTrip, LocationPoint

# How far a phone's clock may be off from the server's before its locations are refused.
CLOCK_SLACK = timedelta(minutes=2)
SIX_PLACES = Decimal("0.000001")
ALREADY_SHARING = "You are already sharing your live location. Stop it first."


@dataclass(frozen=True)
class BoardRow:
    """One driver of the office on the MTO's live board: the vehicle they drive and their open trip, if any."""

    driver: User
    vehicle: Vehicle | None
    trip: DutyTrip | None


def start_trip(driver: User, duty_particulars: str) -> DutyTrip:
    """Start sharing the driver's live location for a duty, in the vehicle they are linked to."""
    particulars = duty_particulars.strip()
    if not particulars:
        raise BusinessRuleError("Enter the duty particulars.")
    vehicle = current_vehicle_for(driver)
    if vehicle is None:
        raise BusinessRuleError("You are not linked to a vehicle. Contact your MTO.")
    if vehicle.status != VehicleStatus.ACTIVE:
        raise BusinessRuleError("This vehicle is paused or terminated.")
    if DutyTrip.objects.filter(driver=driver, ended_at__isnull=True).exists():
        raise BusinessRuleError(ALREADY_SHARING)
    try:
        with transaction.atomic():
            return DutyTrip.objects.create(
                driver=driver, vehicle=vehicle, unit_id=vehicle.unit_id, duty_particulars=particulars
            )
    except IntegrityError:  # a second start that raced the first one
        raise BusinessRuleError(ALREADY_SHARING) from None


def record_points(trip: DutyTrip, points: list[dict]) -> int:
    """Keep a batch of locations: dicts of latitude, longitude, recorded_at and optionally accuracy (metres), speed
    (metres a second) and heading (degrees). A location already kept is ignored. Returns how many were new."""
    _end_if_unlinked(trip)
    with transaction.atomic():
        locked = DutyTrip.objects.select_for_update().get(pk=trip.pk)
        if locked.ended_at is not None:
            raise BusinessRuleError(f"This trip has ended. {locked.end_reason}")
        earliest, latest = locked.started_at - CLOCK_SLACK, timezone.now() + CLOCK_SLACK
        batch: dict[datetime, LocationPoint] = {}
        for point in points:
            moment = point["recorded_at"]
            if not earliest <= moment <= latest:
                raise BusinessRuleError("A location's time is outside this trip. Check the phone's clock.")
            batch[moment] = LocationPoint(
                trip=locked,
                recorded_at=moment,
                latitude=_coordinate(point["latitude"]),
                longitude=_coordinate(point["longitude"]),
                accuracy_m=point.get("accuracy"),
                speed_mps=point.get("speed"),
                heading_deg=point.get("heading"),
            )
        kept = set(locked.points.filter(recorded_at__in=batch).values_list("recorded_at", flat=True))
        new = [row for moment, row in batch.items() if moment not in kept]
        LocationPoint.objects.bulk_create(new)
        newest = max(new, key=lambda row: row.recorded_at, default=None)
        if newest and (locked.last_point_at is None or newest.recorded_at > locked.last_point_at):
            locked.last_point_at = newest.recorded_at
            locked.last_latitude, locked.last_longitude = newest.latitude, newest.longitude
            locked.last_accuracy_m = newest.accuracy_m
            locked.save(update_fields=["last_point_at", "last_latitude", "last_longitude", "last_accuracy_m"])
    for field in ("last_point_at", "last_latitude", "last_longitude", "last_accuracy_m"):
        setattr(trip, field, getattr(locked, field))
    return len(new)


def stop_trip(trip: DutyTrip, reason: str = "Stopped by the driver.") -> DutyTrip:
    with transaction.atomic():
        locked = DutyTrip.objects.select_for_update().get(pk=trip.pk)
        if locked.ended_at is not None:
            raise BusinessRuleError("This trip has already ended.")
        locked.ended_at = timezone.now()
        locked.end_reason = reason
        locked.save(update_fields=["ended_at", "end_reason"])
    trip.ended_at, trip.end_reason = locked.ended_at, locked.end_reason
    return trip


def live_board(mto: User) -> list[BoardRow]:
    """Every active driver of the MTO's office with their vehicle and open trip: those sharing first, then by name."""
    drivers = list(
        User.objects.filter(role=Role.DRIVER, unit=mto.unit_id, status=UserStatus.ACTIVE).order_by("full_name", "id")
    )
    links = {
        link.person_id: link.vehicle
        for link in VehicleAssignment.objects.filter(
            person__in=drivers, kind=AssignmentKind.DRIVER, ended_at__isnull=True
        ).select_related("vehicle")
    }
    trips = {
        trip.driver_id: trip
        for trip in DutyTrip.objects.filter(unit=mto.unit_id, ended_at__isnull=True).select_related("driver", "vehicle")
    }
    rows = [
        BoardRow(driver, trips[driver.pk].vehicle if driver.pk in trips else links.get(driver.pk), trips.get(driver.pk))
        for driver in drivers
    ]
    return sorted(rows, key=lambda row: row.trip is None)  # stable: by name within each group


def trips_visible_to(user: User):
    """The trips a user may look at: a driver their own, an MTO those of the office's vehicles, nobody else any."""
    if user.role == Role.DRIVER:
        return DutyTrip.objects.filter(driver=user)
    if user.role == Role.MTO:
        return DutyTrip.objects.filter(unit=user.unit_id)
    return DutyTrip.objects.none()


def _end_if_unlinked(trip: DutyTrip) -> None:
    """End an open trip once its driver is no longer linked to its vehicle, however the link ended (unlinked, the
    driver removed, the vehicle terminated): later locations would not be that vehicle's."""
    linked = VehicleAssignment.objects.filter(
        person=trip.driver_id, vehicle=trip.vehicle_id, kind=AssignmentKind.DRIVER, ended_at__isnull=True
    )
    if not linked.exists():
        DutyTrip.objects.filter(pk=trip.pk, ended_at__isnull=True).update(
            ended_at=timezone.now(),
            end_reason=f"The driver is no longer linked to {trip.vehicle.registration_number}.",
        )


def _coordinate(value) -> Decimal:
    return Decimal(str(value)).quantize(SIX_PLACES)
