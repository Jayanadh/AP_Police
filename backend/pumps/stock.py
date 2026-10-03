"""A police pump's stock ledger. Every change to a tank's stock goes through here, so each one leaves an entry."""
from decimal import Decimal

from django.db import transaction
from django.db.models import F, QuerySet

from accounts.models import Role, User, UserStatus
from common.exceptions import BusinessRuleError
from notifications.service import notify, unit_mtos
from pumps.models import PumpKind, PumpTank, StockEntry, StockEntryKind

TWO_PLACES = Decimal("0.01")
TANK_LEVELS = frozenset({"low_stock_threshold_litres", "capacity_litres"})


def police_tanks() -> QuerySet[PumpTank]:
    """The tanks of police pumps. A tie-up bunk keeps no stock, even if it once had tanks."""
    return PumpTank.objects.filter(pump__kind=PumpKind.POLICE)


def low_tanks(tanks: QuerySet[PumpTank]) -> QuerySet[PumpTank]:
    """The tanks below their own alert level: the query form of `PumpTank.is_low`."""
    return tanks.filter(current_stock_litres__lt=F("low_stock_threshold_litres"))


def record_measurement(tank: PumpTank, litres, by: User, note: str = "") -> StockEntry:
    """The morning measurement: the stock becomes exactly the measured value."""
    litres = _litres(litres)
    if litres < 0:
        raise BusinessRuleError("Stock can't be negative.")
    with transaction.atomic():
        locked = _lock(tank)
        return _post(tank, locked, StockEntryKind.MEASUREMENT, litres, litres, by, note)


def record_receipt(tank: PumpTank, litres, by: User, note: str = "") -> StockEntry:
    """A tanker delivery: the litres received are added to the stock."""
    litres = _litres(litres)
    if litres <= 0:
        raise BusinessRuleError("Enter the litres received.")
    with transaction.atomic():
        locked = _lock(tank)
        stock_after = locked.current_stock_litres + litres
        return _post(tank, locked, StockEntryKind.TANKER_RECEIPT, litres, stock_after, by, note)


def dispense(tank: PumpTank, litres, by: User, note: str = "") -> StockEntry:
    """A fill: the litres are taken off the stock. A fill larger than the stock is refused."""
    litres = _litres(litres)
    if litres <= 0:
        raise BusinessRuleError("Enter the litres to fill.")
    with transaction.atomic():
        locked = _lock(tank)
        if problem := shortfall(locked, litres):
            raise BusinessRuleError(problem)
        stock_after = locked.current_stock_litres - litres
        return _post(tank, locked, StockEntryKind.DISPENSE, litres, stock_after, by, note)


def shortfall(tank: PumpTank, litres) -> str | None:
    """Why the tank cannot give `litres` now, or None when its stock covers them."""
    if litres <= tank.current_stock_litres:
        return None
    return (
        f"Only {tank.current_stock_litres:.2f} L of {tank.fuel_type.lower()} in stock. "
        "Record a fresh morning measurement if this is wrong."
    )


def update_levels(tank: PumpTank, **changes) -> None:
    """Change a tank's alert level and/or capacity. The alert is re-checked against the new level, so lowering it
    re-arms a tank that was alerted and raising it above the stock alerts. Stock itself is never written here."""
    if unexpected := set(changes) - TANK_LEVELS:
        raise TypeError(f"Not a tank level: {', '.join(sorted(unexpected))}")
    with transaction.atomic():
        locked = _lock(tank)
        for field, value in changes.items():
            setattr(locked, field, value)
        _check_alert(locked)
        locked.save(update_fields=[*changes, "low_stock_alerted"])
        _sync(tank, locked, *changes)


def _litres(value) -> Decimal:
    return Decimal(str(value)).quantize(TWO_PLACES)


def _lock(tank: PumpTank) -> PumpTank:
    """The tank as it is now, locked until the transaction ends so two writers cannot both act on stale stock."""
    return PumpTank.objects.select_for_update(of=("self",)).select_related("pump__unit").get(pk=tank.pk)


def _post(tank: PumpTank, locked: PumpTank, kind: str, litres: Decimal, stock_after: Decimal, by: User, note: str):
    entry = StockEntry.objects.create(
        tank=locked,
        kind=kind,
        litres=litres,
        stock_before=locked.current_stock_litres,
        stock_after=stock_after,
        note=note,
        recorded_by=by,
    )
    locked.current_stock_litres = stock_after
    _check_alert(locked)
    locked.save(update_fields=["current_stock_litres", "low_stock_alerted"])
    _sync(tank, locked, "current_stock_litres")
    return entry


def _sync(tank: PumpTank, locked: PumpTank, *fields: str) -> None:
    """Keep the caller's copy of the tank in step with what was just written."""
    for field in (*fields, "low_stock_alerted"):
        setattr(tank, field, getattr(locked, field))


def _check_alert(tank: PumpTank) -> None:
    """Alert once per drop below the alert level; a stock back at or above it re-arms the alert."""
    if tank.current_stock_litres >= tank.low_stock_threshold_litres:
        tank.low_stock_alerted = False
    elif not tank.low_stock_alerted:
        tank.low_stock_alerted = True
        _send_low_stock_alert(tank)


def _send_low_stock_alert(tank: PumpTank) -> None:
    pump = tank.pump
    title = f"Low {tank.fuel_type.lower()} stock at {pump.name}"
    body = f"{tank.current_stock_litres:.2f} L left (alert level {tank.low_stock_threshold_litres:.2f} L)."
    notify(unit_mtos(pump.unit), title, body, link=f"/mto/pumps/{pump.id}")
    staff = User.objects.filter(pump=pump, role=Role.PUMP_OPERATOR, status=UserStatus.ACTIVE)
    notify(staff, title, body, link="/pump/stock")
