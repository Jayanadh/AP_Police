from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction

from fleet.models import FuelType
from masters.models import District
from pumps import services
from pumps.models import Pump, PumpKind, PumpTank
from testing.factories import UnitFactory, master, police_pump, tieup_pump

pytestmark = pytest.mark.django_db


def pump_fields(**overrides):
    fields = {
        "name": "Test Pump",
        "kind": PumpKind.POLICE,
        "address": "Somewhere, Nellore",
        "district": master(District, "Sri Potti Sriramulu Nellore"),
        "latitude": Decimal("14.442600"),
        "longitude": Decimal("79.986500"),
    }
    fields.update(overrides)
    return fields


def test_create_pump_for_a_police_pump_creates_a_tank_per_fuel_sold():
    unit = UnitFactory()
    pump = services.create_pump(unit, **pump_fields())
    assert pump.unit == unit
    assert sorted(pump.tanks.values_list("fuel_type", flat=True)) == ["DIESEL", "PETROL"]
    assert set(pump.tanks.values_list("low_stock_threshold_litres", flat=True)) == {Decimal("100")}
    assert set(pump.tanks.values_list("current_stock_litres", flat=True)) == {Decimal("0")}


def test_create_pump_for_a_tie_up_bunk_creates_no_tanks():
    pump = services.create_pump(UnitFactory(), **pump_fields(kind=PumpKind.TIE_UP))
    assert pump.tanks.count() == 0


def test_ensure_tanks_uses_the_low_stock_rule(settings):
    settings.MTO_RULES = {**settings.MTO_RULES, "LOW_STOCK_LITRES": Decimal("250")}
    pump = services.create_pump(UnitFactory(), **pump_fields())
    assert set(pump.tanks.values_list("low_stock_threshold_litres", flat=True)) == {Decimal("250")}


def test_ensure_tanks_keeps_existing_tanks_and_their_stock():
    pump = police_pump(UnitFactory(), petrol=Decimal("320"), diesel=Decimal("40"))
    services.ensure_tanks(pump)
    assert pump.tanks.count() == 2
    assert pump.tanks.get(fuel_type=FuelType.PETROL).current_stock_litres == Decimal("320")
    assert pump.tanks.get(fuel_type=FuelType.DIESEL).current_stock_litres == Decimal("40")


def test_ensure_tanks_never_deletes_a_tank_when_a_fuel_is_switched_off():
    pump = police_pump(UnitFactory(), diesel=Decimal("40"))
    pump.sells_diesel = False
    pump.save()
    services.ensure_tanks(pump)
    assert pump.tanks.filter(fuel_type=FuelType.DIESEL).exists()


def test_ensure_tanks_does_nothing_for_a_tie_up_bunk():
    pump = tieup_pump(UnitFactory())
    services.ensure_tanks(pump)
    assert PumpTank.objects.count() == 0


def test_tank_is_low_below_the_threshold_only():
    pump = police_pump(UnitFactory(), petrol=Decimal("100"), diesel=Decimal("99.99"))
    assert pump.tanks.get(fuel_type=FuelType.PETROL).is_low is False
    assert pump.tanks.get(fuel_type=FuelType.DIESEL).is_low is True


def test_a_pump_must_sell_a_fuel():
    with pytest.raises(IntegrityError), transaction.atomic():
        Pump.objects.create(unit=UnitFactory(), sells_petrol=False, sells_diesel=False, **pump_fields())


def test_pump_names_are_unique_within_a_unit():
    unit = UnitFactory()
    Pump.objects.create(unit=unit, **pump_fields())
    with pytest.raises(IntegrityError), transaction.atomic():
        Pump.objects.create(unit=unit, **pump_fields())
    Pump.objects.create(unit=UnitFactory(), **pump_fields())  # another unit may reuse the name


def test_one_tank_per_fuel_per_pump():
    pump = police_pump(UnitFactory())
    with pytest.raises(IntegrityError), transaction.atomic():
        PumpTank.objects.create(pump=pump, fuel_type=FuelType.PETROL)


def test_fuel_available_needs_stock_at_a_police_pump_but_not_at_a_tie_up_bunk():
    police = police_pump(UnitFactory(), petrol=Decimal("0"), diesel=Decimal("5"))
    assert police.fuel_available(FuelType.PETROL) is False
    assert police.fuel_available(FuelType.DIESEL) is True
    tieup = tieup_pump(UnitFactory())
    assert tieup.fuel_available(FuelType.PETROL) is True
    assert tieup.fuel_available(FuelType.DIESEL) is True


def test_fuel_available_is_false_for_a_fuel_the_pump_does_not_sell():
    pump = police_pump(UnitFactory(), petrol=Decimal("500"), diesel=Decimal("500"))
    pump.sells_diesel = False
    pump.save()
    assert pump.fuel_available(FuelType.DIESEL) is False
