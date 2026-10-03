"""Scheduled fuel jobs. Each takes an aware `now`, returns how many records it acted on and is safe to run again."""
from datetime import datetime

from django.db import transaction

from common.months import IST
from fuel.models import FuelRequest
from fuel.quota import fmt
from fuel.requests import expire_stale, overdue_duty
from notifications.service import notify, unit_mtos


def expire_unused_pins(now: datetime) -> int:
    """Mark open requests whose PIN has run out as expired."""
    return expire_stale(now=now)


def remind_overdue_duty(now: datetime) -> int:
    """Alert the driver and the MTO, once, about a fill whose duty particulars are still missing after 48 hours."""
    overdue = overdue_duty(now).filter(duty_overdue_notified=False).select_related("vehicle", "driver")

    alerted = 0
    for request in overdue:
        with transaction.atomic():
            # Claiming the flag first means a second run, even a simultaneous one, finds nothing left to alert.
            claimed = FuelRequest.objects.filter(pk=request.pk, duty_overdue_notified=False).update(
                duty_overdue_notified=True
            )
            if not claimed:
                continue
            registration = request.vehicle.registration_number
            filled_on = request.filled_at.astimezone(IST).date()
            notify(
                [request.driver],
                "Duty particulars overdue",
                f"{registration}, {fmt(request.litres_filled)} L on {filled_on}.",
                "/driver/fuel",
            )
            notify(unit_mtos(request.vehicle.unit), f"Duty particulars overdue: {registration}", link="/mto/fuel")
        alerted += 1
    return alerted
