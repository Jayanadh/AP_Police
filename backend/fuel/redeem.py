"""Filling fuel at a pump. A driver's request waits in the incoming list of the pump the driver picked; the staff pick
it, enter the driver's PIN to see the litres, and fill exactly those litres. Nothing else is typed at the pump.

A refused attempt still counts: an expired request is marked expired, a wrong PIN is counted and the fifth cancels
the request. Those changes are kept although the call reports an error, so the checks run in one transaction that
*returns* the refusal and the error is raised only after the transaction has committed. An error raised inside it
(a police pump without enough stock) rolls the whole fill back instead.
"""
from dataclasses import dataclass
from secrets import compare_digest

from django.conf import settings
from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone
from rest_framework.exceptions import NotFound

from accounts.models import User, UserStatus
from common.exceptions import BusinessRuleError
from common.months import current_month
from fleet.models import AssignmentKind, VehicleStatus
from fleet.services import current_links
from fuel.models import EmergencyStatus, FuelRequest, RequestStatus
from fuel.quota import ZERO, fmt, quota_for
from fuel.requests import expire_stale
from notifications.service import notify, unit_mtos
from pumps.models import Pump, PumpKind, PumpTank
from pumps.stock import dispense, shortfall


@dataclass(frozen=True)
class Rejection:
    """Why a fill was refused, returned (not raised) so the changes the attempt made are kept."""

    message: str


def incoming(operator: User) -> QuerySet[FuelRequest]:
    """The open requests waiting at the operator's pump, oldest first. None while the pump is closed."""
    pump = operator.pump
    if pump is None or not pump.is_active:
        return FuelRequest.objects.none()
    expire_stale()
    return (
        FuelRequest.objects.filter(pump=pump, status=RequestStatus.ISSUED)
        .select_related("vehicle", "driver")
        .order_by("issued_at", "id")
    )


def check_pin(*, operator: User, request_id: int, pin: str) -> FuelRequest:
    """The request, once the PIN is right and it can be filled here now: its litres may be shown. Nothing is filled.

    Raises `BusinessRuleError` with the reason when it cannot be filled, and `NotFound` for a request of another pump.
    """
    return _run(operator, request_id, pin, commit=False)


def fill(*, operator: User, request_id: int, pin: str) -> FuelRequest:
    """Fill exactly the litres asked for, if the PIN is right. Raises as `check_pin` does."""
    return _run(operator, request_id, pin, commit=True)


def _run(operator: User, request_id: int, pin: str, *, commit: bool) -> FuelRequest:
    with transaction.atomic():
        outcome = _attempt(operator, request_id, pin, commit)
    if isinstance(outcome, Rejection):
        raise BusinessRuleError(outcome.message)
    return outcome


def _attempt(operator: User, request_id: int, pin: str, commit: bool) -> FuelRequest | Rejection:
    pump = operator.pump
    if pump is None or not pump.is_active:
        return Rejection("Your pump is not active. Contact your MTO.")

    # Locked until the transaction ends, so the same PIN cannot be redeemed twice at once.
    request = (
        FuelRequest.objects.select_for_update(of=("self",))
        .select_related("vehicle", "driver")
        .filter(pk=request_id, pump=pump)
        .first()
    )
    if request is None:
        raise NotFound("No such request at your pump.")
    if request.status != RequestStatus.ISSUED:
        return Rejection("This request is no longer open.")

    if request.expires_at <= timezone.now():
        request.status = RequestStatus.EXPIRED
        request.save(update_fields=["status"])
        return Rejection("This PIN has expired. The driver must raise a new request.")

    vehicle = request.vehicle
    if vehicle.status != VehicleStatus.ACTIVE:
        return Rejection("This vehicle is paused or terminated.")
    if request.driver.status != UserStatus.ACTIVE:
        return Rejection("The driver who raised this request is no longer active.")
    if not current_links(vehicle).filter(kind=AssignmentKind.DRIVER, person=request.driver).exists():
        return Rejection("The driver who raised this request is no longer linked to this vehicle.")

    # Compared as bytes: compare_digest refuses text that is not ASCII.
    if not compare_digest(pin.encode(), request.pin.encode()):
        return _wrong_pin(request)

    litres = request.litres_requested
    tank = _tank_for(pump, request.fuel_type)
    if not _sells(pump, request.fuel_type, tank):
        return Rejection(f"This pump does not sell {request.fuel_type.lower()}.")

    # Other fills since the request was raised may have used up what it counted on.
    quota = quota_for(vehicle, current_month())
    normal_left = max(ZERO, quota.remaining_litres)
    most = normal_left + quota.emergency_remaining_litres
    if litres > most:
        return Rejection(
            f"This vehicle can now draw only {fmt(most)} L. The driver must cancel this request and ask again."
        )
    if tank is not None and (problem := shortfall(tank, litres)):
        return Rejection(problem)
    if not commit:
        return request

    if tank is not None:  # a police pump: the litres come off its stock
        request.stock_entry = dispense(tank, litres, by=operator, note=f"Fuel request #{request.pk}")
    emergency_litres = max(ZERO, litres - normal_left)
    request.status = RequestStatus.FILLED
    request.filled_by = operator
    request.filled_at = timezone.now()
    request.litres_filled = litres
    request.emergency_litres = emergency_litres
    request.emergency_status = EmergencyStatus.PENDING if emergency_litres > 0 else EmergencyStatus.NONE
    request.save(
        update_fields=[
            "status", "filled_by", "filled_at", "litres_filled", "stock_entry", "emergency_litres", "emergency_status",
        ]
    )
    _notify_fill(request, pump)
    return request


def _wrong_pin(request: FuelRequest) -> Rejection:
    request.failed_pin_attempts += 1
    left = settings.MTO_RULES["MAX_PIN_ATTEMPTS"] - request.failed_pin_attempts
    if left > 0:
        request.save(update_fields=["failed_pin_attempts"])
        return Rejection(f"Wrong PIN. {left} attempt(s) left.")
    request.status = RequestStatus.CANCELLED
    request.cancel_reason = "Too many wrong PIN attempts."
    request.save(update_fields=["failed_pin_attempts", "status", "cancel_reason"])
    return Rejection("Too many wrong PINs. This request is cancelled; the driver must raise a new one.")


def _tank_for(pump: Pump, fuel_type: str) -> PumpTank | None:
    """The tank a fill comes out of: a police pump's tank for the fuel. A tie-up bunk keeps no stock."""
    if pump.kind != PumpKind.POLICE:
        return None
    return pump.tanks.filter(fuel_type=fuel_type).first()


def _sells(pump: Pump, fuel_type: str, tank: PumpTank | None) -> bool:
    # Tanks are never deleted, so a police pump that stopped selling a fuel still has its tank.
    return pump.sells(fuel_type) and (pump.kind == PumpKind.TIE_UP or tank is not None)


def _notify_fill(request: FuelRequest, pump: Pump) -> None:
    vehicle = request.vehicle
    notify(
        [request.driver],
        f"Fuel filled: {fmt(request.litres_filled)} L at {pump.name}",
        "Enter the duty particulars within 2 days.",
        "/driver/fuel",
    )
    if request.emergency_litres > 0:
        notify(
            unit_mtos(vehicle.unit),
            f"Emergency fill: {vehicle.registration_number}",
            f"{fmt(request.emergency_litres)} L over the limit. Reason: {request.emergency_reason}",
            "/mto/emergencies",
        )
