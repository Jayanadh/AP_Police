"""Fuel statements: what was filled in a period, as the person asking sees it. Bunk statements: what was filled at
one pump in a period, for its staff, its office's MTO and the PTO.

Everyone gets the totals. The MTO, officers and drivers also get a row per vehicle and per pump; the PTO a row per
office, and the rows per vehicle only once one office is picked (the whole state at once would be thousands of
rows); the staff of a pump a row per vehicle filled there and, at a police pump, how each tank's stock moved.
"""
from decimal import Decimal

from django.db.models import Count, F, Q, QuerySet, Sum
from rest_framework import serializers

from accounts.models import Role, Unit
from common.periods import Period
from fleet.models import FuelType
from fleet.services import vehicles_visible_to
from fuel.models import FuelRequest, RequestStatus
from fuel.quota import fmt
from pumps.models import Pump, PumpKind, StockEntryKind

ZERO = Decimal("0.00")
PETROL = Q(fuel_type=FuelType.PETROL)
DIESEL = Q(fuel_type=FuelType.DIESEL)


def fuel_statement(user, period: Period, unit_id: int | None = None) -> dict:
    """The statement of `period` for `user`. `unit_id` narrows the PTO's statement to one office."""
    start, end = period.bounds()
    fills = statement_fills(user, period, unit_id)
    is_pto = user.role == Role.PTO
    at_pump = user.role == Role.PUMP_OPERATOR
    return {
        **_period(period),
        **totals(fills),
        "by_unit": _by_unit(start, end) if is_pto else None,
        "by_vehicle": None if is_pto and unit_id is None else _by_vehicle(fills),
        "by_pump": None if at_pump else _by_pump(fills),
        "stock": _stock(user.pump, period) if at_pump and _is_police(user.pump) else None,
    }


def statement_fills(user, period: Period, unit_id: int | None = None) -> QuerySet[FuelRequest]:
    """The fills of `period` in `user`'s statement, in the order they were made."""
    start, end = period.bounds()
    return (
        _fills(user, unit_id)
        .filter(filled_at__gte=start, filled_at__lt=end)
        .select_related("vehicle__unit", "driver", "pump")
        .order_by("filled_at", "id")
    )


def bunk_statement(pump: Pump, period: Period) -> dict:
    """Every fill made at `pump` in `period`, in the order they were made, with the totals. Fills of vehicles of any
    office count: the bunk filled them."""
    fills = bunk_fills(pump, period)
    return {
        **_period(period),
        "pump": {
            "id": pump.id,
            "name": pump.name,
            "kind": pump.kind,
            "kind_label": pump.get_kind_display(),
            "unit_name": pump.unit.name,
        },
        **{key: value for key, value in totals(fills).items() if key != "emergency_litres"},
        "rows": [
            {
                "id": fill.id,
                "filled_at": _timestamp(fill.filled_at),
                "registration_number": fill.vehicle.registration_number,
                "unit_name": fill.vehicle.unit.name,
                "driver_name": fill.driver.full_name,
                "fuel_type": fill.fuel_type,
                "litres": fmt(fill.litres_filled),
            }
            for fill in fills
        ],
    }


def bunk_fills(pump: Pump, period: Period) -> QuerySet[FuelRequest]:
    start, end = period.bounds()
    return (
        FuelRequest.objects.filter(status=RequestStatus.FILLED, pump=pump, filled_at__gte=start, filled_at__lt=end)
        .select_related("vehicle__unit", "driver")
        .order_by("filled_at", "id")
    )


def totals(fills) -> dict:
    """How many fills and how many litres: in all, of petrol, of diesel and beyond the quota."""
    found = fills.aggregate(
        litres=Sum("litres_filled"),
        fills=Count("id"),
        petrol=Sum("litres_filled", filter=PETROL),
        diesel=Sum("litres_filled", filter=DIESEL),
        emergency=Sum("emergency_litres"),
    )
    return {
        "litres": fmt(found["litres"] or ZERO),
        "fills": found["fills"],
        "petrol_litres": fmt(found["petrol"] or ZERO),
        "diesel_litres": fmt(found["diesel"] or ZERO),
        "emergency_litres": fmt(found["emergency"] or ZERO),
    }


def _period(period: Period) -> dict:
    return {"from": period.start.isoformat(), "to": period.end.isoformat(), "label": period.label}


def _timestamp(value) -> str:
    """As the API writes every other timestamp: in India time, with its offset."""
    return serializers.DateTimeField().to_representation(value)


def _fills(user, unit_id):
    filled = FuelRequest.objects.filter(status=RequestStatus.FILLED)
    if user.role == Role.PTO:
        return filled if unit_id is None else filled.filter(vehicle__unit=unit_id)
    if user.role == Role.MTO:
        return filled.filter(vehicle__unit=user.unit_id)
    if user.role == Role.OFFICER:
        return filled.filter(vehicle__in=vehicles_visible_to(user))
    if user.role == Role.DRIVER:
        return filled.filter(driver=user)
    if user.role == Role.PUMP_OPERATOR and user.pump_id is not None:
        return filled.filter(pump=user.pump_id)
    return filled.none()


def _by_unit(start, end) -> list[dict]:
    """Every office, those with no fills too, by name. Fills count for the office of the vehicle."""
    rows = (
        FuelRequest.objects.filter(status=RequestStatus.FILLED, filled_at__gte=start, filled_at__lt=end)
        .values("vehicle__unit")
        .annotate(
            fills=Count("id"),
            litres=Sum("litres_filled"),
            petrol=Sum("litres_filled", filter=PETROL),
            diesel=Sum("litres_filled", filter=DIESEL),
            emergency=Sum("emergency_litres"),
        )
        .order_by()
    )
    found = {row["vehicle__unit"]: row for row in rows}
    out = []
    for unit in Unit.objects.order_by("name", "id"):
        row = found.get(unit.pk, {})
        out.append(
            {
                "unit": unit.pk,
                "unit_name": unit.name,
                "fills": row.get("fills", 0),
                "litres": fmt(row.get("litres") or ZERO),
                "petrol_litres": fmt(row.get("petrol") or ZERO),
                "diesel_litres": fmt(row.get("diesel") or ZERO),
                "emergency_litres": fmt(row.get("emergency") or ZERO),
            }
        )
    return out


def _by_vehicle(fills) -> list[dict]:
    rows = (
        fills.values("vehicle", "vehicle__registration_number", "vehicle__fuel_type", "vehicle__unit__name")
        .annotate(fills=Count("id"), litres=Sum("litres_filled"), emergency=Sum("emergency_litres"))
        .order_by("-litres", "vehicle__registration_number")
    )
    return [
        {
            "vehicle": row["vehicle"],
            "registration_number": row["vehicle__registration_number"],
            "fuel_type": row["vehicle__fuel_type"],
            "unit_name": row["vehicle__unit__name"],
            "fills": row["fills"],
            "litres": fmt(row["litres"]),
            "emergency_litres": fmt(row["emergency"]),
        }
        for row in rows
    ]


def _by_pump(fills) -> list[dict]:
    rows = (
        fills.values("pump", "pump__name", "pump__kind")
        .annotate(fills=Count("id"), litres=Sum("litres_filled"))
        .order_by("-litres", "pump__name")
    )
    return [
        {
            "pump": row["pump"],
            "pump_name": row["pump__name"],
            "pump_kind": row["pump__kind"],
            "fills": row["fills"],
            "litres": fmt(row["litres"]),
        }
        for row in rows
    ]


def _is_police(pump: Pump | None) -> bool:
    return pump is not None and pump.kind == PumpKind.POLICE


def _stock(pump: Pump, period: Period) -> list[dict]:
    """How each tank's stock moved: opening + received - dispensed + what morning measurements changed = closing."""
    start, end = period.bounds()
    out = []
    for tank in pump.tanks.order_by("id"):
        entries = tank.entries.filter(recorded_at__gte=start, recorded_at__lt=end)
        first = entries.order_by("recorded_at", "id").first()
        if first is not None:
            opening = first.stock_before
            closing = entries.order_by("-recorded_at", "-id").first().stock_after
        else:
            before = tank.entries.filter(recorded_at__lt=start).order_by("-recorded_at", "-id").first()
            after = tank.entries.filter(recorded_at__gte=end).order_by("recorded_at", "id").first()
            if before is not None:
                opening = before.stock_after
            elif after is not None:
                opening = after.stock_before
            else:
                opening = tank.current_stock_litres
            closing = opening
        moved = entries.aggregate(
            received=Sum("litres", filter=Q(kind=StockEntryKind.TANKER_RECEIPT)),
            dispensed=Sum("litres", filter=Q(kind=StockEntryKind.DISPENSE)),
            measured=Sum(F("stock_after") - F("stock_before"), filter=Q(kind=StockEntryKind.MEASUREMENT)),
        )
        out.append(
            {
                "fuel_type": tank.fuel_type,
                "opening_litres": fmt(opening),
                "received_litres": fmt(moved["received"] or ZERO),
                "dispensed_litres": fmt(moved["dispensed"] or ZERO),
                "measured_change_litres": fmt(moved["measured"] or ZERO),
                "closing_litres": fmt(closing),
            }
        )
    return out
