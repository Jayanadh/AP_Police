"""What each role sees first: one summary per role, built from the figures the other apps already own.

Every summary takes the logged-in user and `now` (an aware datetime), so the month, the day and the week it reports
on are explicit. Litres are two-decimal strings, as everywhere in the API.
"""
from datetime import date, datetime

from django.db.models import Count, Q, QuerySet, Sum
from rest_framework import serializers

from accounts.models import OfficerTransfer, Role, TransferStatus, Unit, User
from approvals.models import ApprovalRequest, ApprovalStatus
from common.months import IST, day_bounds, format_month, month_bounds, month_start
from common.periods import month_period
from fleet import odometer, servicing, services
from fleet.models import AssignmentKind, Vehicle, VehicleStatus
from fuel import report
from fuel.models import EmergencyStatus, FuelRequest, RequestStatus
from fuel.quota import ZERO, fmt, quota_for, quotas_for
from fuel.requests import duty_due_at, duty_overdue, expire_stale, overdue_duty
from pumps.models import PumpTank
from pumps.stock import low_tanks, police_tanks

TOP_VEHICLES = 5
RECENT_FILLS = 10


def dashboard_for(user: User, now: datetime) -> dict:
    """The role and month, with the summary of the user's role."""
    month = _month(now)
    return {"role": user.role, "month": format_month(month), **SUMMARIES[user.role](user, now)}


def pto_summary(user: User, now: datetime) -> dict:
    """Every MTO office side by side: vehicles, this month's fuel, low tanks and what waits for a look."""
    month = _month(now)
    active = _count_by(Vehicle.objects.filter(status=VehicleStatus.ACTIVE), "unit_id")
    paused = _count_by(Vehicle.objects.filter(status=VehicleStatus.PAUSED), "unit_id")
    low = _count_by(low_tanks(police_tanks()), "pump__unit_id")
    emergencies = _count_by(FuelRequest.objects.filter(emergency_status=EmergencyStatus.PENDING), "vehicle__unit_id")

    counted = _fuel_vehicles(Vehicle.objects.only("unit_id", "monthly_fuel_limit_litres"), month)
    quotas = quotas_for(counted, month)
    used, limit = {}, {}
    for vehicle in counted:
        used[vehicle.unit_id] = used.get(vehicle.unit_id, ZERO) + quotas[vehicle.pk].used_litres
        limit[vehicle.unit_id] = limit.get(vehicle.unit_id, ZERO) + quotas[vehicle.pk].limit_litres

    units = [
        {
            "id": unit.id,
            "name": unit.name,
            "code": unit.code,
            "vehicles_active": active.get(unit.id, 0),
            "vehicles_paused": paused.get(unit.id, 0),
            "fuel_used_litres": fmt(used.get(unit.id, ZERO)),
            "fuel_limit_litres": fmt(limit.get(unit.id, ZERO)),
            "low_stock_tanks": low.get(unit.id, 0),
            "pending_emergencies": emergencies.get(unit.id, 0),
        }
        for unit in Unit.objects.all()
    ]
    return {
        "units": units,
        "pending_approvals": ApprovalRequest.objects.filter(status=ApprovalStatus.PENDING).count(),
        "totals": {
            "vehicles_active": sum(active.values()),
            "fuel_used_litres": fmt(sum(used.values(), ZERO)),
            "fuel_limit_litres": fmt(sum(limit.values(), ZERO)),
            "low_stock_tanks": sum(low.values()),
        },
    }


def mto_summary(user: User, now: datetime) -> dict:
    """One office: its vehicles, this month's fuel, its pumps' stock and the work waiting for the MTO."""
    unit_id = user.unit_id
    month = _month(now)
    today = _today(now)

    # The office's vehicles, a terminated one only if it drew fuel this month: the fleet's statuses below are unaffected
    # (they never count a terminated vehicle), the fuel totals include it and the top list leaves it out.
    vehicles = _fuel_vehicles(Vehicle.objects.filter(unit=unit_id), month)
    live = [vehicle for vehicle in vehicles if vehicle.status != VehicleStatus.TERMINATED]
    quotas = quotas_for(vehicles, month)
    by_use = sorted(live, key=lambda vehicle: (-quotas[vehicle.pk].used_litres, vehicle.registration_number))

    return {
        "vehicles": {
            "active": _count_status(vehicles, VehicleStatus.ACTIVE),
            "paused": _count_status(vehicles, VehicleStatus.PAUSED),
            "termination_pending": _count_status(vehicles, VehicleStatus.TERMINATION_PENDING),
        },
        "fuel": {
            "used_litres": fmt(sum((quota.used_litres for quota in quotas.values()), ZERO)),
            "limit_litres": fmt(sum((quota.limit_litres for quota in quotas.values()), ZERO)),
        },
        "top_vehicles": [
            {
                "id": vehicle.id,
                "registration_number": vehicle.registration_number,
                "used_litres": fmt(quotas[vehicle.pk].used_litres),
                "limit_litres": fmt(quotas[vehicle.pk].limit_litres),
            }
            for vehicle in by_use[:TOP_VEHICLES]
        ],
        "tanks": _tanks(police_tanks().filter(pump__unit=unit_id)),
        "pending_emergencies": FuelRequest.objects.filter(
            vehicle__unit=unit_id, emergency_status=EmergencyStatus.PENDING
        ).count(),
        "overdue_duty": overdue_duty(now).filter(vehicle__unit=unit_id).count(),
        "missing_odometer": odometer.missing_readings(unit_id, odometer.week_of(today)).count(),
        "services_due": len(servicing.due_for_service(unit_id, today)),
        "transfers_to_decide": OfficerTransfer.objects.filter(
            from_unit=unit_id, status=TransferStatus.PENDING
        ).count(),
    }


def officer_summary(user: User, now: datetime) -> dict:
    """The officer's vehicles with this month's fuel and driver, and the latest fills of those vehicles."""
    month = _month(now)
    visible = services.vehicles_visible_to(user)
    vehicles = list(visible.prefetch_related(services.current_links_prefetch()))
    quotas = quotas_for(vehicles, month)
    recent = (
        FuelRequest.objects.filter(status=RequestStatus.FILLED, vehicle__in=visible)
        .select_related("vehicle", "pump")
        .order_by("-filled_at", "-id")[:RECENT_FILLS]
    )
    return {
        "vehicles": [
            {
                "id": vehicle.id,
                "registration_number": vehicle.registration_number,
                "make": vehicle.make,
                "model": vehicle.model,
                "driver_name": _driver_name(vehicle),
                "limit_litres": fmt(quotas[vehicle.pk].limit_litres),
                "used_litres": fmt(quotas[vehicle.pk].used_litres),
                "remaining_litres": fmt(quotas[vehicle.pk].remaining_litres),
            }
            for vehicle in vehicles
        ],
        "recent_fills": [
            {
                "id": fill.id,
                "registration_number": fill.vehicle.registration_number,
                "litres_filled": fmt(fill.litres_filled),
                "filled_at": _when(fill.filled_at),
                "pump_name": fill.pump.name,
                "duty_particulars": fill.duty_particulars,
            }
            for fill in recent
        ],
    }


def driver_summary(user: User, now: datetime) -> dict:
    """The driver's vehicle, this month's fuel, the open PIN, the duty particulars owed and this week's odometer."""
    vehicle = services.current_vehicle_for(user)
    week = odometer.week_of(_today(now))
    reading = vehicle.odometer_readings.filter(week_of=week).first() if vehicle else None
    open_request = FuelRequest.objects.filter(driver=user, status=RequestStatus.ISSUED, expires_at__gt=now).first()
    owed = (
        FuelRequest.objects.filter(driver=user, status=RequestStatus.FILLED, duty_submitted_at__isnull=True)
        .select_related("vehicle")
        .order_by("filled_at", "id")
    )
    quota = quota_for(vehicle, _month(now)) if vehicle else None
    return {
        "vehicle": None
        if vehicle is None
        else {
            "id": vehicle.id,
            "registration_number": vehicle.registration_number,
            "make": vehicle.make,
            "model": vehicle.model,
            "fuel_type": vehicle.fuel_type,
        },
        "quota": None
        if quota is None
        else {
            "limit_litres": fmt(quota.limit_litres),
            "used_litres": fmt(quota.used_litres),
            "remaining_litres": fmt(quota.remaining_litres),
            "emergency_remaining_litres": fmt(quota.emergency_remaining_litres),
        },
        "open_request": None
        if open_request is None
        else {
            "id": open_request.id,
            "pin": open_request.pin,
            "litres_requested": fmt(open_request.litres_requested),
            "expires_at": _when(open_request.expires_at),
        },
        "duty_due": [
            {
                "id": fill.id,
                "registration_number": fill.vehicle.registration_number,
                "filled_at": _when(fill.filled_at),
                "litres_filled": fmt(fill.litres_filled),
                "duty_due_at": _when(duty_due_at(fill)),
                "duty_overdue": duty_overdue(fill, now),
            }
            for fill in owed
        ],
        "odometer": {
            "week_of": week.isoformat(),
            "recorded": reading is not None,
            "reading_km": reading.reading_km if reading else None,
        },
    }


def pump_summary(user: User, now: datetime) -> dict:
    """The operator's pump: its tanks, the vehicles waiting to be filled, and today's and this month's fills."""
    pump = user.pump
    start, end = day_bounds(_today(now))
    fills = FuelRequest.objects.filter(status=RequestStatus.FILLED, pump=pump)
    today = fills.filter(filled_at__gte=start, filled_at__lt=end).aggregate(
        count=Count("pk"), litres=Sum("litres_filled")
    )
    month = report.totals(report.bunk_fills(pump, month_period(_month(now))))
    expire_stale(now=now)
    return {
        "pump": {"id": pump.id, "name": pump.name, "kind": pump.kind},
        "tanks": _tanks(police_tanks().filter(pump=pump)),
        "waiting": FuelRequest.objects.filter(pump=pump, status=RequestStatus.ISSUED).count() if pump.is_active else 0,
        "today_fills": {"count": today["count"], "litres": fmt(today["litres"] or ZERO)},
        "month_fills": {"petrol_litres": month["petrol_litres"], "diesel_litres": month["diesel_litres"]},
    }


SUMMARIES = {
    Role.PTO: pto_summary,
    Role.MTO: mto_summary,
    Role.OFFICER: officer_summary,
    Role.DRIVER: driver_summary,
    Role.PUMP_OPERATOR: pump_summary,
}


def _today(now: datetime) -> date:
    return now.astimezone(IST).date()


def _month(now: datetime) -> date:
    return month_start(_today(now))


def _when(value: datetime) -> str:
    """A moment as the rest of the API writes it."""
    return serializers.DateTimeField().to_representation(value)


def _count_by(rows: QuerySet, field: str) -> dict[int, int]:
    """How many of `rows` there are for each value of `field`."""
    return {row[field]: row["total"] for row in rows.order_by().values(field).annotate(total=Count("pk"))}


def _fuel_vehicles(vehicles: QuerySet[Vehicle], month: date) -> list[Vehicle]:
    """The vehicles whose fuel counts in an office's figures for `month`: every one that is not terminated, and a
    terminated one that drew fuel in the month (those fills happened, so they stay in the total; its limit comes with
    them, so the litres used never outrun the limit). A terminated vehicle that drew nothing counts nowhere."""
    start, end = month_bounds(month)
    drew = FuelRequest.objects.filter(status=RequestStatus.FILLED, filled_at__gte=start, filled_at__lt=end)
    return list(vehicles.filter(~Q(status=VehicleStatus.TERMINATED) | Q(pk__in=drew.values("vehicle"))))


def _count_status(vehicles: list[Vehicle], status: str) -> int:
    return sum(1 for vehicle in vehicles if vehicle.status == status)


def _driver_name(vehicle: Vehicle) -> str | None:
    for link in vehicle.current_links:
        if link.kind == AssignmentKind.DRIVER:
            return link.person.full_name
    return None


def _tanks(tanks: QuerySet[PumpTank]) -> list[dict]:
    return [
        {
            "id": tank.id,
            "pump_name": tank.pump.name,
            "fuel_type": tank.fuel_type,
            "current_stock_litres": fmt(tank.current_stock_litres),
            "low_stock_threshold_litres": fmt(tank.low_stock_threshold_litres),
            # Null until the MTO sets the tank's size.
            "capacity_litres": None if tank.capacity_litres is None else fmt(tank.capacity_litres),
            "is_low": tank.is_low,
        }
        for tank in tanks.select_related("pump").order_by("pump__name", "pump_id", "id")
    ]
