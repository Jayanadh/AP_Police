"""Scheduled fleet jobs. Each takes an aware `now`, returns how many vehicles it alerted and is safe to run again."""
from datetime import datetime

from django.db import transaction

from common.months import IST
from fleet.models import AssignmentKind, Vehicle, VehicleStatus
from fleet.odometer import week_of
from fleet.services import current_links
from fleet.servicing import SERVICED_STATUSES, service_status
from notifications.service import notify, unit_mtos

SUNDAY = 6  # `date.weekday()` of a Sunday


def alert_missing_odometer(now: datetime) -> int:
    """From Monday, alert the driver and the MTO, once a week, when the Sunday reading is still missing."""
    today = now.astimezone(IST).date()
    if today.weekday() == SUNDAY:  # the driver can still record today's reading
        return 0
    target = week_of(today)
    missing = (
        Vehicle.objects.filter(
            status=VehicleStatus.ACTIVE,
            assignments__kind=AssignmentKind.DRIVER,
            assignments__ended_at__isnull=True,
        )
        .exclude(odometer_readings__week_of=target)
        .exclude(odometer_alert_week=target)
        .select_related("unit")
    )

    alerted = 0
    for vehicle in missing:
        with transaction.atomic():
            # Claiming the week first means a second run, even a simultaneous one, finds nothing left to alert.
            claimed = (
                Vehicle.objects.filter(pk=vehicle.pk)
                .exclude(odometer_alert_week=target)
                .update(odometer_alert_week=target)
            )
            if not claimed:
                continue
            drivers = [link.person for link in current_links(vehicle).filter(kind=AssignmentKind.DRIVER)]
            notify(
                drivers,
                "Odometer reading missing",
                f"Enter the reading for {vehicle.registration_number} for the week of {target}.",
                "/driver/odometer",
            )
            notify(
                unit_mtos(vehicle.unit),
                f"Odometer reading missing: {vehicle.registration_number}",
                f"No reading yet for the week of {target}.",
                "/mto/odometer",
            )
        alerted += 1
    return alerted


def alert_service_due(now: datetime) -> int:
    """Alert the MTO, once per service cycle, when a vehicle falls due for service."""
    today = now.astimezone(IST).date()
    candidates = Vehicle.objects.filter(status__in=SERVICED_STATUSES, service_due_alerted=False).select_related("unit")

    alerted = 0
    for vehicle in candidates:
        if not service_status(vehicle, today)["due"]:
            continue
        with transaction.atomic():
            # Claiming the flag first means a second run, even a simultaneous one, finds nothing left to alert.
            claimed = Vehicle.objects.filter(pk=vehicle.pk, service_due_alerted=False).update(
                service_due_alerted=True
            )
            if not claimed:
                continue
            notify(
                unit_mtos(vehicle.unit),
                f"Service due: {vehicle.registration_number}",
                link=f"/mto/vehicles/{vehicle.pk}",
            )
        alerted += 1
    return alerted
