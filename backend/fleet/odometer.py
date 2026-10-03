"""Sunday odometer readings: one per vehicle per week, never lower than the last reading we know of."""
from datetime import date, timedelta

from django.db import transaction
from django.db.models import OuterRef, QuerySet, Subquery

from accounts.models import User
from common.exceptions import BusinessRuleError
from common.months import today_ist
from fleet.models import AssignmentKind, OdometerReading, Vehicle, VehicleAssignment, VehicleStatus
from fleet.services import current_vehicle_for

NOT_LINKED_MESSAGE = "You are not linked to a vehicle. Contact your MTO."


def week_of(day: date) -> date:
    """The most recent Sunday on or before `day`; a Sunday is its own week."""
    return day - timedelta(days=(day.weekday() + 1) % 7)


def latest_odometer_km(vehicle: Vehicle) -> int:
    """The highest figure on record: the onboarding reading, the newest Sunday reading or the newest service's."""
    newest_reading = vehicle.odometer_readings.values_list("reading_km", flat=True).first()
    newest_service = vehicle.service_records.values_list("odometer_km", flat=True).first()
    return max(vehicle.odometer_at_onboarding_km, newest_reading or 0, newest_service or 0)


def missing_readings(unit_id: int, week: date) -> QuerySet[VehicleAssignment]:
    """The current driver links of the unit's active vehicles that have no reading for `week`, by registration."""
    return (
        VehicleAssignment.objects.filter(
            kind=AssignmentKind.DRIVER,
            ended_at__isnull=True,
            vehicle__unit=unit_id,
            vehicle__status=VehicleStatus.ACTIVE,
        )
        .exclude(vehicle__odometer_readings__week_of=week)
        .select_related("vehicle", "person")
        .order_by("vehicle__registration_number")
    )


def readings_with_previous() -> QuerySet[OdometerReading]:
    """Readings, each carrying `previous_km`: the same vehicle's reading of the week before it (None for the first)."""
    previous = (
        OdometerReading.objects.filter(vehicle=OuterRef("vehicle"), week_of__lt=OuterRef("week_of"))
        .order_by("-week_of")
        .values("reading_km")[:1]
    )
    return OdometerReading.objects.select_related("vehicle", "recorded_by").annotate(previous_km=Subquery(previous))


def record_reading(driver: User, reading_km: int, today: date | None = None) -> OdometerReading:
    """Record the driver's reading for the Sunday on or before `today` (default: today in Asia/Kolkata)."""
    week = week_of(today or today_ist())
    with transaction.atomic():
        linked = current_vehicle_for(driver)
        if linked is None:
            raise BusinessRuleError(NOT_LINKED_MESSAGE)
        # Lock the vehicle so two requests cannot both pass the checks below.
        vehicle = Vehicle.objects.select_for_update().get(pk=linked.pk)
        if vehicle.odometer_readings.filter(week_of=week).exists():
            raise BusinessRuleError("This week's reading is already recorded.")
        latest = latest_odometer_km(vehicle)
        if reading_km < latest:
            raise BusinessRuleError(f"The reading can't be lower than the last reading ({latest} km).")
        return OdometerReading.objects.create(
            vehicle=vehicle, week_of=week, reading_km=reading_km, recorded_by=driver
        )
