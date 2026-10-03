"""A vehicle's fuel for one calendar month (Asia/Kolkata): limit, additional quota, litres used, emergency litres.

Fuel left = monthly limit + additional quota - litres filled that month. Emergency litres are fills beyond what was
left; they are deducted from the month's additional quota, whose balance may therefore go negative.
"""
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.db.models import Sum

from common.months import month_bounds, month_start
from fleet.models import Vehicle
from fuel.models import FuelGrant, FuelRequest, RequestStatus

ZERO = Decimal("0")


@dataclass(frozen=True)
class Quota:
    month: date
    base_litres: Decimal
    additional_litres: Decimal
    used_litres: Decimal
    emergency_used_litres: Decimal
    emergency_allowance_litres: Decimal

    @property
    def limit_litres(self) -> Decimal:
        return self.base_litres + self.additional_litres

    @property
    def remaining_litres(self) -> Decimal:
        """Fuel left this month. Negative once emergency litres have been drawn."""
        return self.limit_litres - self.used_litres

    @property
    def emergency_remaining_litres(self) -> Decimal:
        return max(ZERO, self.emergency_allowance_litres - self.emergency_used_litres)

    @property
    def additional_balance_litres(self) -> Decimal:
        """Additional quota left after litres beyond the base limit are taken from it. May be negative."""
        return self.additional_litres - max(ZERO, self.used_litres - self.base_litres)


def quota_for(vehicle: Vehicle, month: date) -> Quota:
    """The quota of `vehicle` for the calendar month containing `month`."""
    return quotas_for([vehicle], month)[vehicle.pk]


def quotas_for(vehicles: Iterable[Vehicle], month: date) -> dict[int, Quota]:
    """The quotas of many vehicles for the calendar month containing `month`, keyed by vehicle id, in two queries."""
    vehicles = list(vehicles)
    if not vehicles:
        return {}
    month = month_start(month)
    start, end = month_bounds(month)
    ids = [vehicle.pk for vehicle in vehicles]
    additional = dict(
        FuelGrant.objects.filter(vehicle__in=ids, month=month)
        .order_by()
        .values_list("vehicle")
        .annotate(total=Sum("litres"))
    )
    fills = {
        row["vehicle"]: row
        for row in FuelRequest.objects.filter(
            vehicle__in=ids, status=RequestStatus.FILLED, filled_at__gte=start, filled_at__lt=end
        )
        .order_by()
        .values("vehicle")
        .annotate(litres=Sum("litres_filled"), emergency=Sum("emergency_litres"))
    }
    allowance = settings.MTO_RULES["EMERGENCY_LITRES_PER_MONTH"]
    quotas = {}
    for vehicle in vehicles:
        fill = fills.get(vehicle.pk, {})
        quotas[vehicle.pk] = Quota(
            month=month,
            base_litres=Decimal(vehicle.monthly_fuel_limit_litres),
            additional_litres=additional.get(vehicle.pk) or ZERO,
            used_litres=fill.get("litres") or ZERO,
            emergency_used_litres=fill.get("emergency") or ZERO,
            emergency_allowance_litres=allowance,
        )
    return quotas


def fmt(value: Decimal) -> str:
    """Litres as shown in the API and in alerts: two decimals, e.g. "5.00"."""
    return f"{value:.2f}"
