from django.conf import settings
from django.db import transaction

from accounts.models import Unit
from fleet.models import FuelType
from pumps.models import Pump, PumpKind, PumpTank


def ensure_tanks(pump: Pump) -> None:
    """Give a police pump a tank for each fuel it sells. Tanks are never deleted, so stock history survives."""
    if pump.kind != PumpKind.POLICE:
        return
    threshold = settings.MTO_RULES["LOW_STOCK_LITRES"]
    for fuel_type in FuelType:
        if pump.sells(fuel_type):
            PumpTank.objects.get_or_create(
                pump=pump, fuel_type=fuel_type, defaults={"low_stock_threshold_litres": threshold}
            )


def create_pump(unit: Unit, **fields) -> Pump:
    with transaction.atomic():
        pump = Pump.objects.create(unit=unit, **fields)
        ensure_tanks(pump)
    return pump
