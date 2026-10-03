"""GET /api/fuel/statement/: what was filled in a period, as each role sees it."""
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

import pytest

from common.months import IST
from fleet import services
from fleet.models import FuelType
from fuel.models import RequestStatus
from pumps.models import StockEntry, StockEntryKind
from testing.factories import (
    DriverFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    PumpStaffFactory,
    UnitFactory,
    VehicleFactory,
    filled_request,
    police_pump,
    tieup_pump,
)

pytestmark = pytest.mark.django_db

URL = "/api/fuel/statement/"
WEEK = {"from": "2026-10-01", "to": "2026-10-07"}
KEYS = {
    "from", "to", "label", "litres", "fills", "petrol_litres", "diesel_litres", "emergency_litres", "by_unit",
    "by_vehicle", "by_pump", "stock",
}


def on(day: int, hour: int = 12) -> datetime:
    return datetime(2026, 10, day, hour, 0, tzinfo=IST)


@pytest.fixture
def world():
    """Two offices. In the week of 1–7 Oct: Nellore's petrol car fills 20 L at the police pump and 10 L (4 L of it an
    emergency) at the bunk, its diesel jeep 30 L at the bunk, and Guntur's jeep 15 L at Nellore's police pump. Fills
    outside the week, a cancelled request and another office's fill elsewhere must not count."""
    nellore = UnitFactory(name="Nellore MTO")
    guntur = UnitFactory(name="Guntur MTO")
    UnitFactory(name="Kurnool MTO")  # no fills at all
    mto = MTOFactory(unit=nellore)
    pump = police_pump(nellore)
    pump.name = "Nellore Police Pump"
    pump.save(update_fields=["name"])
    bunk = tieup_pump(nellore)
    bunk.name = "Trunk Road Bunk"
    bunk.save(update_fields=["name"])
    car = VehicleFactory(unit=nellore, registration_number="AP39PA0001", fuel_type=FuelType.PETROL)
    jeep = VehicleFactory(unit=nellore, registration_number="AP39PA0002", fuel_type=FuelType.DIESEL)
    visitor = VehicleFactory(unit=guntur, registration_number="AP07PB0001", fuel_type=FuelType.DIESEL)
    driver = DriverFactory(unit=nellore)
    services.assign_person(car, driver, mto)
    officer = OfficerFactory(unit=nellore)
    services.assign_person(car, officer, mto)

    filled_request(car, Decimal("20"), on(2), driver=driver, pump=pump)
    filled_request(car, Decimal("10"), on(5), driver=driver, pump=bunk, emergency_litres=Decimal("4"))
    filled_request(jeep, Decimal("30"), on(6), pump=bunk)
    filled_request(visitor, Decimal("15"), on(3), pump=pump)
    filled_request(car, Decimal("50"), on(8), driver=driver, pump=pump)  # the day after the week
    filled_request(car, Decimal("40"), datetime(2026, 9, 30, 23, 59, tzinfo=IST), driver=driver, pump=pump)
    filled_request(jeep, Decimal("9"), on(4), pump=bunk, status=RequestStatus.CANCELLED, litres_filled=None)
    filled_request(VehicleFactory(unit=guntur), Decimal("7"), on(4))  # Guntur, at a Guntur pump
    return SimpleNamespace(
        nellore=nellore, guntur=guntur, mto=mto, pump=pump, bunk=bunk, car=car, jeep=jeep, visitor=visitor,
        driver=driver, officer=officer,
    )


def get(api, user, **params):
    api.force_login(user)
    response = api.get(URL, {**WEEK, **params})
    assert response.status_code == 200, response.content
    return response.json()


def test_the_mto_sees_their_vehicles_fills_with_totals_by_vehicle_and_by_pump(api, world):
    body = get(api, world.mto)

    assert set(body) == KEYS
    assert body["from"] == "2026-10-01" and body["to"] == "2026-10-07"
    assert body["label"] == "01 Oct – 07 Oct 2026"
    assert body["litres"] == "60.00"
    assert body["fills"] == 3
    assert body["petrol_litres"] == "30.00"
    assert body["diesel_litres"] == "30.00"
    assert body["emergency_litres"] == "4.00"
    assert body["by_vehicle"] == [
        {
            "vehicle": world.car.pk, "registration_number": "AP39PA0001", "fuel_type": "PETROL",
            "unit_name": "Nellore MTO", "fills": 2, "litres": "30.00", "emergency_litres": "4.00",
        },
        {
            "vehicle": world.jeep.pk, "registration_number": "AP39PA0002", "fuel_type": "DIESEL",
            "unit_name": "Nellore MTO", "fills": 1, "litres": "30.00", "emergency_litres": "0.00",
        },
    ]
    assert body["by_pump"] == [
        {"pump": world.bunk.pk, "pump_name": "Trunk Road Bunk", "pump_kind": "TIE_UP", "fills": 2, "litres": "40.00"},
        {"pump": world.pump.pk, "pump_name": "Nellore Police Pump", "pump_kind": "POLICE", "fills": 1, "litres": "20.00"},
    ]
    assert body["by_unit"] is None
    assert body["stock"] is None


def test_the_pto_sees_every_office_and_pump_but_no_vehicle_list_until_an_office_is_picked(api, world):
    body = get(api, PTOFactory())

    assert body["litres"] == "82.00"
    assert body["fills"] == 5
    assert body["by_unit"] == [
        {
            "unit": world.guntur.pk, "unit_name": "Guntur MTO", "fills": 2, "litres": "22.00",
            "petrol_litres": "0.00", "diesel_litres": "22.00", "emergency_litres": "0.00",
        },
        {
            "unit": mock.ANY, "unit_name": "Kurnool MTO", "fills": 0, "litres": "0.00",
            "petrol_litres": "0.00", "diesel_litres": "0.00", "emergency_litres": "0.00",
        },
        {
            "unit": world.nellore.pk, "unit_name": "Nellore MTO", "fills": 3, "litres": "60.00",
            "petrol_litres": "30.00", "diesel_litres": "30.00", "emergency_litres": "4.00",
        },
    ]
    assert body["by_vehicle"] is None
    assert [(row["pump_name"], row["litres"]) for row in body["by_pump"]][:2] == [
        ("Trunk Road Bunk", "40.00"),
        ("Nellore Police Pump", "35.00"),
    ]


def test_the_pto_can_pick_one_office(api, world):
    body = get(api, PTOFactory(), unit=str(world.guntur.pk))

    assert body["litres"] == "22.00"
    assert [row["registration_number"] for row in body["by_vehicle"]][0] == "AP07PB0001"
    assert len(body["by_vehicle"]) == 2
    assert len(body["by_unit"]) == 3  # the offices table stays whole


def test_the_pto_office_filter_must_be_an_id(api, world):
    api.force_login(PTOFactory())

    response = api.get(URL, {**WEEK, "unit": "Guntur"})

    assert response.status_code == 400
    assert response.json() == {"detail": "Use the office's id."}


def test_an_officer_sees_the_vehicles_linked_to_them(api, world):
    body = get(api, world.officer)

    assert body["litres"] == "30.00"
    assert [row["registration_number"] for row in body["by_vehicle"]] == ["AP39PA0001"]
    assert body["by_unit"] is None


def test_a_driver_sees_their_own_fills(api, world):
    other_driver = DriverFactory(unit=world.nellore)
    filled_request(world.car, Decimal("5"), on(7), driver=other_driver, pump=world.pump)

    body = get(api, world.driver)

    assert body["litres"] == "30.00"
    assert body["fills"] == 2
    assert get(api, other_driver)["litres"] == "5.00"


def test_police_pump_staff_see_every_fill_at_their_pump_and_the_stock(api, world):
    staff = PumpStaffFactory(pump=world.pump, unit=world.nellore)

    body = get(api, staff)

    assert body["litres"] == "35.00"  # Nellore's car and Guntur's jeep
    assert [row["registration_number"] for row in body["by_vehicle"]] == ["AP39PA0001", "AP07PB0001"]
    assert body["by_pump"] is None
    assert [row["fuel_type"] for row in body["stock"]] == ["PETROL", "DIESEL"]


def test_bunk_staff_see_the_fills_at_their_bunk_and_no_stock(api, world):
    body = get(api, PumpStaffFactory(pump=world.bunk, unit=world.nellore))

    assert body["litres"] == "40.00"
    assert body["stock"] is None


def entry(tank, kind, litres, before, after, when):
    created = StockEntry.objects.create(
        tank=tank, kind=kind, litres=Decimal(litres), stock_before=Decimal(before), stock_after=Decimal(after),
        recorded_by=PumpStaffFactory(pump=tank.pump, unit=tank.pump.unit),
    )
    StockEntry.objects.filter(pk=created.pk).update(recorded_at=when)
    return created


def test_the_stock_of_each_tank_over_the_period(api, world):
    petrol = world.pump.tanks.get(fuel_type=FuelType.PETROL)
    diesel = world.pump.tanks.get(fuel_type=FuelType.DIESEL)
    entry(petrol, StockEntryKind.MEASUREMENT, "500", "0", "500", datetime(2026, 9, 30, 7, tzinfo=IST))
    entry(petrol, StockEntryKind.TANKER_RECEIPT, "300", "500", "800", on(2, 9))
    entry(petrol, StockEntryKind.DISPENSE, "20", "800", "780", on(2, 12))
    entry(petrol, StockEntryKind.MEASUREMENT, "770", "780", "770", on(4, 7))
    entry(petrol, StockEntryKind.DISPENSE, "70", "770", "700", on(8, 9))  # after the week
    entry(diesel, StockEntryKind.MEASUREMENT, "400", "0", "400", datetime(2026, 9, 30, 7, tzinfo=IST))

    stock = get(api, PumpStaffFactory(pump=world.pump, unit=world.nellore))["stock"]

    assert stock == [
        {
            "fuel_type": "PETROL", "opening_litres": "500.00", "received_litres": "300.00",
            "dispensed_litres": "20.00", "measured_change_litres": "-10.00", "closing_litres": "770.00",
        },
        {
            "fuel_type": "DIESEL", "opening_litres": "400.00", "received_litres": "0.00",
            "dispensed_litres": "0.00", "measured_change_litres": "0.00", "closing_litres": "400.00",
        },
    ]


def test_a_tank_whose_first_entry_comes_after_the_period_opened_with_that_entrys_stock_before(api, world):
    petrol = world.pump.tanks.get(fuel_type=FuelType.PETROL)
    entry(petrol, StockEntryKind.MEASUREMENT, "250", "0", "250", on(20, 7))

    stock = get(api, PumpStaffFactory(pump=world.pump, unit=world.nellore))["stock"]

    assert stock[0]["opening_litres"] == "0.00" and stock[0]["closing_litres"] == "0.00"


def test_without_dates_the_statement_is_for_the_current_month(api, world):
    api.force_login(world.mto)

    with mock.patch("common.periods.today_ist", return_value=date(2026, 10, 15)):
        body = api.get(URL).json()

    assert (body["from"], body["to"], body["label"]) == ("2026-10-01", "2026-10-31", "October 2026")
    assert body["litres"] == "110.00"  # the week, plus the 50 L on the 8th


def test_a_bad_period_is_refused(api, world):
    api.force_login(world.mto)

    response = api.get(URL, {"from": "2026-10-07", "to": "2026-10-01"})

    assert response.status_code == 400
    assert response.json() == {"detail": "The first day must be on or before the last day."}


def test_an_empty_period_is_all_zero(api, world):
    body = get(api, world.mto, **{"from": "2026-11-01", "to": "2026-11-30"})

    assert (body["litres"], body["fills"], body["by_vehicle"], body["by_pump"]) == ("0.00", 0, [], [])


def test_signing_in_is_required(api):
    assert api.get(URL, WEEK).status_code == 403
