from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from common.exceptions import BusinessRuleError
from fleet.models import FuelType
from notifications.models import Notification
from pumps import stock
from pumps.models import PumpTank, StockEntry, StockEntryKind
from testing.factories import MTOFactory, PumpStaffFactory, UnitFactory, police_pump, tieup_pump

pytestmark = pytest.mark.django_db


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def pump(mto):
    return police_pump(mto.unit, petrol=Decimal("500"), diesel=Decimal("300"))


@pytest.fixture
def staff(pump):
    return PumpStaffFactory(pump=pump, unit=pump.unit)


@pytest.fixture
def diesel(pump):
    return pump.tanks.get(fuel_type=FuelType.DIESEL)


def stock_of(tank):
    tank.refresh_from_db()
    return tank.current_stock_litres


def test_measurement_sets_the_stock_and_logs_before_and_after(diesel, staff):
    entry = stock.record_measurement(diesel, Decimal("280.50"), staff, note="Dip stick")

    assert stock_of(diesel) == Decimal("280.50")
    assert entry.kind == StockEntryKind.MEASUREMENT
    assert (entry.litres, entry.stock_before, entry.stock_after) == (
        Decimal("280.50"),
        Decimal("300"),
        Decimal("280.50"),
    )
    assert entry.note == "Dip stick"
    assert entry.recorded_by == staff
    assert entry.tank == diesel
    assert StockEntry.objects.get() == entry


def test_a_measurement_can_be_zero(diesel, staff):
    stock.record_measurement(diesel, Decimal("0"), staff)
    assert stock_of(diesel) == Decimal("0")


def test_a_negative_measurement_is_refused(diesel, staff):
    with pytest.raises(BusinessRuleError) as error:
        stock.record_measurement(diesel, Decimal("-1"), staff)
    assert str(error.value.detail) == "Stock can't be negative."
    assert stock_of(diesel) == Decimal("300")
    assert StockEntry.objects.count() == 0


def test_receipt_adds_to_the_stock(diesel, staff):
    entry = stock.record_receipt(diesel, Decimal("1000"), staff, note="Tanker KA-01")

    assert stock_of(diesel) == Decimal("1300")
    assert entry.kind == StockEntryKind.TANKER_RECEIPT
    assert (entry.litres, entry.stock_before, entry.stock_after) == (
        Decimal("1000"),
        Decimal("300"),
        Decimal("1300"),
    )


@pytest.mark.parametrize("litres", [Decimal("0"), Decimal("-5")])
def test_receipt_needs_a_positive_quantity(diesel, staff, litres):
    with pytest.raises(BusinessRuleError) as error:
        stock.record_receipt(diesel, litres, staff)
    assert str(error.value.detail) == "Enter the litres received."
    assert stock_of(diesel) == Decimal("300")
    assert StockEntry.objects.count() == 0


def test_dispense_subtracts_from_the_stock(diesel, staff):
    entry = stock.dispense(diesel, Decimal("45.25"), staff)

    assert stock_of(diesel) == Decimal("254.75")
    assert entry.kind == StockEntryKind.DISPENSE
    assert (entry.litres, entry.stock_before, entry.stock_after) == (
        Decimal("45.25"),
        Decimal("300"),
        Decimal("254.75"),
    )


def test_the_whole_stock_can_be_dispensed(diesel, staff):
    stock.dispense(diesel, Decimal("300"), staff)
    assert stock_of(diesel) == Decimal("0")


def test_dispensing_more_than_the_stock_is_refused_and_changes_nothing(pump, staff):
    tank = pump.tanks.get(fuel_type=FuelType.DIESEL)
    tank.current_stock_litres = Decimal("40")
    tank.save()

    with pytest.raises(BusinessRuleError) as error:
        stock.dispense(tank, Decimal("40.01"), staff)

    assert str(error.value.detail) == (
        "Only 40.00 L of diesel in stock. Record a fresh morning measurement if this is wrong."
    )
    assert stock_of(tank) == Decimal("40")
    assert StockEntry.objects.count() == 0
    assert Notification.objects.count() == 0


@pytest.mark.parametrize("litres", [Decimal("0"), Decimal("-1")])
def test_dispense_needs_a_positive_quantity(diesel, staff, litres):
    with pytest.raises(BusinessRuleError):
        stock.dispense(diesel, litres, staff)
    assert stock_of(diesel) == Decimal("300")
    assert StockEntry.objects.count() == 0


def test_the_stock_functions_work_on_the_current_stock_not_a_stale_copy(diesel, staff):
    stale = diesel
    type(diesel).objects.filter(pk=diesel.pk).update(current_stock_litres=Decimal("150"))

    stock.dispense(stale, Decimal("50"), staff)

    assert stock_of(diesel) == Decimal("100")


def test_the_callers_tank_is_left_in_step_with_the_database(diesel, staff):
    stock.dispense(diesel, Decimal("250"), staff)  # 50 L left: below the alert level
    assert diesel.current_stock_litres == Decimal("50")
    assert diesel.low_stock_alerted is True


def test_the_tank_is_locked_while_its_stock_changes(diesel, staff):
    with CaptureQueriesContext(connection) as queries:
        stock.dispense(diesel, Decimal("10"), staff)
    assert any("FOR UPDATE" in query["sql"] for query in queries)


def test_dropping_below_the_threshold_alerts_the_mto_and_the_staff_once(mto, pump, diesel, staff):
    other_staff = PumpStaffFactory(pump=pump, unit=pump.unit)
    paused_staff = PumpStaffFactory(pump=pump, unit=pump.unit, status="PAUSED")
    stock.record_measurement(diesel, Decimal("120"), staff)
    assert Notification.objects.count() == 0  # 120 is still above the 100 L alert level

    stock.dispense(diesel, Decimal("30"), staff)  # 90 L left

    diesel.refresh_from_db()
    assert diesel.low_stock_alerted is True
    title = f"Low diesel stock at {pump.name}"
    mto_alert = Notification.objects.get(recipient=mto)
    assert mto_alert.title == title
    assert mto_alert.body == "90.00 L left (alert level 100.00 L)."
    assert mto_alert.link == f"/mto/pumps/{pump.id}"
    for person in (staff, other_staff):
        alert = Notification.objects.get(recipient=person)
        assert (alert.title, alert.body, alert.link) == (title, mto_alert.body, "/pump/stock")
    assert not Notification.objects.filter(recipient=paused_staff).exists()
    assert Notification.objects.count() == 3

    stock.dispense(diesel, Decimal("20"), staff)  # still low: no second alert

    assert Notification.objects.count() == 3


def test_staff_of_another_pump_and_another_mto_are_not_alerted(mto, diesel, staff):
    elsewhere = police_pump(UnitFactory())
    PumpStaffFactory(pump=elsewhere, unit=elsewhere.unit)
    MTOFactory(unit=elsewhere.unit)

    stock.dispense(diesel, Decimal("250"), staff)

    assert {note.recipient for note in Notification.objects.all()} == {mto, staff}


def test_a_receipt_back_above_the_threshold_rearms_the_alert(mto, diesel, staff):
    stock.dispense(diesel, Decimal("250"), staff)  # 50 L: alert
    assert Notification.objects.filter(recipient=mto).count() == 1

    stock.record_receipt(diesel, Decimal("500"), staff)  # 550 L: re-armed, no alert
    diesel.refresh_from_db()
    assert diesel.low_stock_alerted is False
    assert Notification.objects.filter(recipient=mto).count() == 1

    stock.dispense(diesel, Decimal("500"), staff)  # 50 L again: alert again

    assert Notification.objects.filter(recipient=mto).count() == 2
    assert Notification.objects.filter(recipient=staff).count() == 2


def test_a_measurement_below_the_threshold_alerts_too(mto, diesel, staff):
    stock.record_measurement(diesel, Decimal("60"), staff)
    assert Notification.objects.filter(recipient=mto).count() == 1


def test_a_stock_of_exactly_the_threshold_is_not_low(mto, diesel, staff):
    stock.record_measurement(diesel, Decimal("100"), staff)
    assert Notification.objects.count() == 0
    diesel.refresh_from_db()
    assert diesel.low_stock_alerted is False


def test_petrol_and_diesel_alert_separately(mto, pump, staff):
    petrol = pump.tanks.get(fuel_type=FuelType.PETROL)
    diesel = pump.tanks.get(fuel_type=FuelType.DIESEL)
    stock.dispense(diesel, Decimal("250"), staff)
    stock.dispense(petrol, Decimal("450"), staff)
    assert sorted(Notification.objects.filter(recipient=mto).values_list("title", flat=True)) == sorted(
        [f"Low diesel stock at {pump.name}", f"Low petrol stock at {pump.name}"]
    )


def test_a_tank_already_low_with_the_flag_set_does_not_alert_again(mto, diesel, staff):
    diesel.current_stock_litres = Decimal("50")
    diesel.low_stock_alerted = True
    diesel.save()

    stock.record_receipt(diesel, Decimal("10"), staff)  # 60 L: still low, already alerted

    assert Notification.objects.count() == 0


def test_updating_the_levels_applies_them_under_the_lock_and_keeps_the_current_stock(diesel, staff):
    stale = diesel
    type(diesel).objects.filter(pk=diesel.pk).update(current_stock_litres=Decimal("150"), low_stock_alerted=True)

    with CaptureQueriesContext(connection) as queries:
        stock.update_levels(stale, low_stock_threshold_litres=Decimal("120"), capacity_litres=Decimal("2000"))

    diesel.refresh_from_db()
    assert diesel.current_stock_litres == Decimal("150")  # the stale read of 300 L was not written back
    assert diesel.low_stock_threshold_litres == Decimal("120")
    assert diesel.capacity_litres == Decimal("2000")
    assert diesel.low_stock_alerted is False  # 150 L is above the 120 L level
    assert any("FOR UPDATE" in query["sql"] for query in queries)
    update = next(query["sql"] for query in queries if query["sql"].startswith("UPDATE"))
    assert "current_stock_litres" not in update


def test_updating_the_levels_keeps_the_callers_tank_in_step(diesel):
    stock.update_levels(diesel, low_stock_threshold_litres=Decimal("400"))
    assert diesel.low_stock_threshold_litres == Decimal("400")
    assert diesel.low_stock_alerted is True  # 300 L is below 400 L


def test_the_levels_are_the_only_thing_update_levels_will_change(diesel):
    with pytest.raises(TypeError):
        stock.update_levels(diesel, current_stock_litres=Decimal("9999"))
    assert stock_of(diesel) == Decimal("300")


def test_low_tanks_are_the_ones_below_their_own_alert_level(mto):
    first = police_pump(mto.unit, petrol=Decimal("99.99"), diesel=Decimal("100"))  # exactly the level is not low
    second = police_pump(mto.unit, petrol=Decimal("0"), diesel=Decimal("5000"))
    second.tanks.filter(fuel_type=FuelType.DIESEL).update(low_stock_threshold_litres=Decimal("6000"))  # own level

    low = stock.low_tanks(stock.police_tanks())

    assert {tank.pk for tank in low} == {tank.pk for tank in first.tanks.all() | second.tanks.all() if tank.is_low}
    assert {(tank.pump_id, tank.fuel_type) for tank in low} == {
        (first.pk, FuelType.PETROL),
        (second.pk, FuelType.PETROL),
        (second.pk, FuelType.DIESEL),
    }


def test_police_tanks_leave_out_a_bunk_that_once_had_tanks(mto):
    police = police_pump(mto.unit)
    bunk = tieup_pump(mto.unit)
    PumpTank.objects.create(pump=bunk, fuel_type=FuelType.PETROL)

    assert {tank.pump_id for tank in stock.police_tanks()} == {police.pk}
