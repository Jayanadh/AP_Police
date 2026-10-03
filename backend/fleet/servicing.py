"""Servicing: due every X km or Y days since the last service (or since the vehicle was added), whichever is first."""
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Q

from accounts.models import User
from common.exceptions import BusinessRuleError
from common.months import IST, today_ist
from fleet.models import ServiceRecord, Vehicle, VehicleStatus
from fleet.odometer import latest_odometer_km

SERVICED_STATUSES = (VehicleStatus.ACTIVE, VehicleStatus.PAUSED)  # vehicles that are tracked for servicing


def service_status(vehicle: Vehicle, today: date) -> dict:
    """Whether a service is due, with the figures behind it. A vehicle with no interval set is never due."""
    last = vehicle.service_records.first()  # the newest service
    return status_from(
        vehicle,
        last.service_date if last is not None else None,
        last.odometer_km if last is not None else None,
        latest_odometer_km(vehicle),
        today,
    )


def status_from(
    vehicle: Vehicle, last_service_date: date | None, last_service_km: int | None, latest_km: int, today: date
) -> dict:
    """`service_status` from figures already read: the newest service (None when never serviced) and the highest
    odometer figure on record. Lets a list work out many vehicles without a query each."""
    if last_service_date is not None:
        last_date, last_km = last_service_date, last_service_km
    else:  # never serviced: count from the day the vehicle was added
        last_date, last_km = vehicle.created_at.astimezone(IST).date(), vehicle.odometer_at_onboarding_km

    km_since = latest_km - last_km
    days_since = (today - last_date).days
    interval_km, interval_days = vehicle.service_interval_km, vehicle.service_interval_days
    due = bool(interval_km and km_since >= interval_km) or bool(interval_days and days_since >= interval_days)
    return {
        "due": due,
        "last_service_date": last_date,
        "last_service_km": last_km,
        "km_since": km_since,
        "days_since": days_since,
        "next_due_km": last_km + interval_km if interval_km else None,
        "next_due_date": last_date + timedelta(days=interval_days) if interval_days else None,
    }


def due_for_service(unit_id: int, today: date) -> list[tuple[Vehicle, dict]]:
    """The unit's vehicles that are due for a service on `today`, each with its service status."""
    vehicles = Vehicle.objects.filter(
        Q(service_interval_km__isnull=False) | Q(service_interval_days__isnull=False),  # no interval: never due
        unit=unit_id,
        status__in=SERVICED_STATUSES,
    )
    statuses = [(vehicle, service_status(vehicle, today)) for vehicle in vehicles]
    return [(vehicle, service) for vehicle, service in statuses if service["due"]]


def record_service(
    vehicle: Vehicle, service_date: date, odometer_km: int, notes: str, by: User, today: date | None = None
) -> ServiceRecord:
    """Record a service and start a new cycle: the vehicle may alert the MTO again when it next falls due."""
    if service_date > (today or today_ist()):
        raise BusinessRuleError("The service date can't be in the future.")
    with transaction.atomic():
        # Lock the vehicle, as `record_reading` does, so the odometer it checks against cannot change under it.
        Vehicle.objects.select_for_update().get(pk=vehicle.pk)
        record = ServiceRecord.objects.create(
            vehicle=vehicle, service_date=service_date, odometer_km=odometer_km, notes=notes, recorded_by=by
        )
        Vehicle.objects.filter(pk=vehicle.pk).update(service_due_alerted=False)
    vehicle.service_due_alerted = False
    return record
