"""A driver's fuel requests: raising one (and getting its PIN), letting it run out, cancelling it.

The driver picks the pump (a police pump or a tie-up bunk of any office in AP) when asking; the request then waits
in that pump's incoming list, and only that pump can fill it. A request is open (ISSUED) until it is filled, cancelled
or expired. A vehicle has at most one open request.
Open requests do not hold back any of the month's fuel; only litres actually filled count against the quota.

After a fill the driver enters the duty particulars, and the MTO allows an emergency fill (which `fuel.quota` already
counts against the month's additional quota).
"""
from datetime import datetime, timedelta
from decimal import Decimal
from secrets import randbelow

from django.conf import settings
from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone

from accounts.models import Role, User
from common.exceptions import BusinessRuleError
from common.months import current_month
from fleet.models import AssignmentKind, Vehicle, VehicleStatus
from fleet.services import current_links, current_vehicle_for
from fuel.models import EmergencyStatus, FuelRequest, RequestStatus
from fuel.quota import ZERO, fmt, quota_for
from notifications.service import notify
from pumps.models import Pump


def new_pin() -> str:
    return f"{randbelow(1_000_000):06d}"


def expire_stale(vehicle: Vehicle | None = None, now: datetime | None = None) -> int:
    """Mark open requests whose PIN has run out as EXPIRED, for one vehicle or for all. Returns how many."""
    now = now or timezone.now()
    stale = FuelRequest.objects.filter(status=RequestStatus.ISSUED, expires_at__lte=now)
    if vehicle is not None:
        stale = stale.filter(vehicle=vehicle)
    return stale.update(status=RequestStatus.EXPIRED)


def duty_due_at(fuel_request: FuelRequest) -> datetime | None:
    """When the driver must have entered the duty particulars: 48 hours after the fill. None until it is filled."""
    if fuel_request.filled_at is None:
        return None
    return fuel_request.filled_at + timedelta(hours=settings.MTO_RULES["DUTY_PARTICULARS_DUE_HOURS"])


def duty_overdue(fuel_request: FuelRequest, now: datetime | None = None) -> bool:
    """Whether the duty particulars are still missing 48 hours or more after the fill: due is overdue, with no grace.

    `overdue_duty` is the same rule as a query; the API, the dashboards and the alerts all go through one of the two.
    """
    due = duty_due_at(fuel_request)
    return due is not None and fuel_request.duty_submitted_at is None and (now or timezone.now()) >= due


def overdue_duty(now: datetime) -> QuerySet[FuelRequest]:
    """Filled requests whose duty particulars are still missing 48 hours or more after the fill, as of `now`."""
    cutoff = now - timedelta(hours=settings.MTO_RULES["DUTY_PARTICULARS_DUE_HOURS"])
    return FuelRequest.objects.filter(
        status=RequestStatus.FILLED, duty_submitted_at__isnull=True, filled_at__lte=cutoff
    )


@transaction.atomic
def create_request(
    *, driver: User, pump: Pump, litres: Decimal, is_emergency: bool = False, reason: str = ""
) -> FuelRequest:
    """Raise a request for `litres` on the driver's vehicle, to be filled at `pump`, and give it a PIN.

    Up to what is left of the month's quota the request is a normal one. Beyond it (and up to the month's emergency
    litres more) it is an emergency, which needs `is_emergency` and a `reason`.
    """
    vehicle = current_vehicle_for(driver)
    if vehicle is None:
        raise BusinessRuleError("You are not linked to a vehicle. Contact your MTO.")
    # Lock the vehicle so two requests for it cannot both pass the checks below.
    vehicle = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
    if vehicle.status != VehicleStatus.ACTIVE:
        raise BusinessRuleError("This vehicle is paused or terminated.")
    if litres > vehicle.tank_capacity_litres:
        raise BusinessRuleError(f"The tank holds only {fmt(vehicle.tank_capacity_litres)} L.")
    if not pump.is_active:
        raise BusinessRuleError(f"{pump.name} is closed. Pick another pump.")
    if not pump.sells(vehicle.fuel_type):
        raise BusinessRuleError(f"{pump.name} does not sell {vehicle.fuel_type.lower()}. Pick another pump.")

    expire_stale(vehicle)
    # The caller is the vehicle's only current driver, so an open request of anyone else is left over from a handover
    # and would lock the vehicle out of fuel (nobody else can cancel it).
    vehicle.fuel_requests.filter(status=RequestStatus.ISSUED).exclude(driver=driver).update(
        status=RequestStatus.CANCELLED, cancel_reason="The vehicle has a new driver."
    )
    if vehicle.fuel_requests.filter(status=RequestStatus.ISSUED).exists():
        raise BusinessRuleError("This vehicle already has an open request. Use its PIN or cancel it first.")

    quota = quota_for(vehicle, current_month())
    normal_left = max(ZERO, quota.remaining_litres)
    max_total = normal_left + quota.emergency_remaining_litres
    if litres > max_total:
        raise BusinessRuleError(f"This vehicle can draw at most {fmt(max_total)} L more this month.")
    reason = reason.strip()
    emergency = litres > normal_left
    if emergency and not (is_emergency and reason):
        raise BusinessRuleError(
            f"Only {fmt(normal_left)} L is left this month. "
            f"Mark it as an emergency and give the reason to draw up to {fmt(max_total)} L."
        )

    return FuelRequest.objects.create(
        vehicle=vehicle,
        driver=driver,
        pump=pump,
        fuel_type=vehicle.fuel_type,
        litres_requested=litres,
        is_emergency=emergency,
        emergency_reason=reason if emergency else "",
        pin=new_pin(),
        expires_at=timezone.now() + timedelta(hours=settings.MTO_RULES["PIN_VALID_HOURS"]),
    )


def cancel_request(request: FuelRequest, driver: User) -> FuelRequest:
    """The driver who raised an open request cancels it; its PIN stops working."""
    if request.driver_id != driver.pk:
        raise BusinessRuleError("Only the driver who raised a request can cancel it.")
    expire_stale(request.vehicle)
    with transaction.atomic():
        # Re-read under a lock so a stale in-memory copy cannot cancel a request that was filled in the meantime.
        locked = FuelRequest.objects.select_for_update().get(pk=request.pk)
        if locked.status != RequestStatus.ISSUED:
            raise BusinessRuleError("Only an open request can be cancelled.")
        locked.status = RequestStatus.CANCELLED
        locked.cancel_reason = "Cancelled by the driver."
        locked.save(update_fields=["status", "cancel_reason"])
    request.status, request.cancel_reason = locked.status, locked.cancel_reason
    return request


def submit_duty(request: FuelRequest, driver: User, text: str) -> FuelRequest:
    """The driver who raised a filled request enters what the fuel was used for. A late entry is accepted."""
    if request.driver_id != driver.pk:
        raise BusinessRuleError("Only the driver who raised a request can enter its duty particulars.")
    with transaction.atomic():
        # Re-read under a lock so a stale in-memory copy cannot enter the particulars a second time.
        locked = FuelRequest.objects.select_for_update().get(pk=request.pk)
        if locked.status != RequestStatus.FILLED:
            raise BusinessRuleError("Duty particulars can be entered only after the fuel is filled.")
        if locked.duty_submitted_at is not None:
            raise BusinessRuleError("Duty particulars were already submitted.")
        text = text.strip()
        if not text:
            raise BusinessRuleError("Enter the duty particulars.")
        locked.duty_particulars = text
        locked.duty_submitted_at = timezone.now()
        locked.save(update_fields=["duty_particulars", "duty_submitted_at"])
    request.duty_particulars, request.duty_submitted_at = locked.duty_particulars, locked.duty_submitted_at
    return request


def allow_emergency(request: FuelRequest, mto: User) -> FuelRequest:
    """The MTO of the vehicle's office allows an emergency fill. Its litres stay counted against the month's additional
    quota (see `fuel.quota`); the driver who raised it and the vehicle's current officer are told."""
    if mto.role != Role.MTO or mto.unit_id != request.vehicle.unit_id:
        raise BusinessRuleError("Only the MTO of the vehicle's office can review an emergency fill.")
    with transaction.atomic():
        # Re-read under a lock so two reviews cannot both pass the check below.
        locked = FuelRequest.objects.select_for_update(of=("self",)).select_related("vehicle", "driver").get(
            pk=request.pk
        )
        if locked.emergency_status != EmergencyStatus.PENDING:
            raise BusinessRuleError("This emergency fill has already been reviewed.")
        locked.emergency_status = EmergencyStatus.ALLOWED
        locked.emergency_reviewed_by = mto
        locked.emergency_reviewed_at = timezone.now()
        locked.save(update_fields=["emergency_status", "emergency_reviewed_by", "emergency_reviewed_at"])
        _notify_allowed(locked)
    request.emergency_status = locked.emergency_status
    request.emergency_reviewed_by = locked.emergency_reviewed_by
    request.emergency_reviewed_at = locked.emergency_reviewed_at
    return request


def _notify_allowed(request: FuelRequest) -> None:
    title = "Emergency fill allowed"
    body = f"{fmt(request.emergency_litres)} L counted against this month's additional quota."
    notify([request.driver], title, body, "/driver/fuel")
    officers = [link.person for link in current_links(request.vehicle).filter(kind=AssignmentKind.OFFICER)]
    notify(officers, title, body, "/officer")
