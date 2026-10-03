from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from fleet.models import FuelType
from masters.models import District
from pumps.models import Pump, PumpKind, PumpTank
from testing.factories import (
    DriverFactory,
    MTOFactory,
    PumpFactory,
    PumpStaffFactory,
    UnitFactory,
    police_pump,
    tieup_pump,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def mto_api(api, mto):
    api.force_login(mto)
    return api


def pump_payload(**overrides):
    payload = {
        "name": "Nellore DPO Police Pump",
        "kind": "POLICE",
        "address": "DPO Campus, Nellore",
        "district": District.objects.get(name="Sri Potti Sriramulu Nellore").id,
        "latitude": "14.442600",
        "longitude": "79.986500",
        "opening_hours": "6 AM - 10 PM",
        "sells_petrol": True,
        "sells_diesel": True,
    }
    payload.update(overrides)
    return payload


def test_creating_a_police_pump_creates_petrol_and_diesel_tanks_at_100_litres(mto_api, mto):
    response = mto_api.post("/api/pumps/", pump_payload())
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Nellore DPO Police Pump"
    assert body["kind"] == "POLICE"
    assert body["kind_label"] == "Police pump"
    assert body["district_name"] == "Sri Potti Sriramulu Nellore"
    assert body["opening_hours"] == "6 AM - 10 PM"
    assert body["is_active"] is True
    assert body["staff_count"] == 0
    assert [tank["fuel_type"] for tank in body["tanks"]] == ["PETROL", "DIESEL"]
    for tank in body["tanks"]:
        assert tank["current_stock_litres"] == "0.00"
        assert tank["low_stock_threshold_litres"] == "100.00"
        assert tank["capacity_litres"] is None
        assert tank["is_low"] is True
    pump = Pump.objects.get(pk=body["id"])
    assert pump.unit == mto.unit
    assert set(pump.tanks.values_list("fuel_type", "low_stock_threshold_litres")) == {
        ("PETROL", Decimal("100")),
        ("DIESEL", Decimal("100")),
    }


def test_a_tie_up_bunk_has_no_tanks(mto_api):
    response = mto_api.post(
        "/api/pumps/", pump_payload(name="Sri Venkateswara Fuels", kind="TIE_UP", opening_hours="24/7")
    )
    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "TIE_UP"
    assert body["kind_label"] == "Tie-up bunk"
    assert body["tanks"] == []
    assert PumpTank.objects.count() == 0


def test_opening_hours_default_to_24_7(mto_api):
    payload = pump_payload()
    del payload["opening_hours"]
    assert mto_api.post("/api/pumps/", payload).json()["opening_hours"] == "24/7"


def test_a_petrol_only_police_pump_gets_only_a_petrol_tank(mto_api):
    body = mto_api.post("/api/pumps/", pump_payload(sells_diesel=False)).json()
    assert [tank["fuel_type"] for tank in body["tanks"]] == ["PETROL"]


def test_enabling_diesel_on_a_petrol_only_police_pump_adds_a_diesel_tank(mto_api, mto):
    pump = police_pump(mto.unit, petrol=Decimal("250"))
    Pump.objects.filter(pk=pump.pk).update(sells_diesel=False)
    pump.tanks.filter(fuel_type=FuelType.DIESEL).delete()

    response = mto_api.patch(f"/api/pumps/{pump.id}/", {"sells_diesel": True})

    assert response.status_code == 200
    tanks = {tank["fuel_type"]: tank for tank in response.json()["tanks"]}
    assert set(tanks) == {"PETROL", "DIESEL"}
    assert tanks["DIESEL"]["low_stock_threshold_litres"] == "100.00"
    assert tanks["PETROL"]["current_stock_litres"] == "250.00"  # the existing tank is untouched
    assert pump.tanks.count() == 2


def test_patch_updates_the_pump_details(mto_api, mto):
    pump = tieup_pump(mto.unit)
    response = mto_api.patch(
        f"/api/pumps/{pump.id}/", {"name": "Renamed Fuels", "address": "New Road", "opening_hours": "5 AM - 11 PM"}
    )
    assert response.status_code == 200
    pump.refresh_from_db()
    assert (pump.name, pump.address, pump.opening_hours) == ("Renamed Fuels", "New Road", "5 AM - 11 PM")


def test_creating_with_no_fuel_is_refused(mto_api):
    response = mto_api.post("/api/pumps/", pump_payload(sells_petrol=False, sells_diesel=False))
    assert response.status_code == 400
    assert "Choose at least one fuel." in str(response.json())
    assert Pump.objects.count() == 0


def test_patching_away_the_last_fuel_is_refused(mto_api, mto):
    pump = PumpFactory(unit=mto.unit, kind=PumpKind.TIE_UP, sells_petrol=True, sells_diesel=False)
    response = mto_api.patch(f"/api/pumps/{pump.id}/", {"sells_petrol": False})
    assert response.status_code == 400
    assert "Choose at least one fuel." in str(response.json())
    pump.refresh_from_db()
    assert pump.sells_petrol is True


@pytest.mark.parametrize(
    "location",
    [
        {"latitude": "12.400000"},
        {"latitude": "19.600000"},
        {"longitude": "76.400000"},
        {"longitude": "85.000000"},
        {"latitude": "28.613900", "longitude": "77.209000"},  # Delhi
    ],
)
def test_a_location_outside_andhra_pradesh_is_refused(mto_api, location):
    response = mto_api.post("/api/pumps/", pump_payload(**location))
    assert response.status_code == 400
    assert "Pick a location inside Andhra Pradesh." in str(response.json())
    assert Pump.objects.count() == 0


def test_the_edges_of_andhra_pradesh_are_accepted(mto_api):
    response = mto_api.post("/api/pumps/", pump_payload(latitude="12.500000", longitude="84.900000"))
    assert response.status_code == 201


def test_a_pump_name_is_unique_within_the_unit(mto_api, mto):
    police_pump(mto.unit)
    existing = Pump.objects.get(unit=mto.unit)
    response = mto_api.post("/api/pumps/", pump_payload(name=existing.name))
    assert response.status_code == 400
    assert "name" in response.json()


def test_two_units_may_use_the_same_pump_name(mto_api):
    PumpFactory(name="Highway Fuels", unit=UnitFactory())
    assert mto_api.post("/api/pumps/", pump_payload(name="Highway Fuels")).status_code == 201


def test_renaming_a_pump_to_its_own_name_is_not_a_clash(mto_api, mto):
    pump = tieup_pump(mto.unit)
    assert mto_api.patch(f"/api/pumps/{pump.id}/", {"name": pump.name}).status_code == 200


def test_client_cannot_set_unit_or_active_flag(mto_api, mto):
    other = UnitFactory()
    response = mto_api.post("/api/pumps/", pump_payload(unit=other.id, is_active=False))
    assert response.status_code == 201
    pump = Pump.objects.get(pk=response.json()["id"])
    assert pump.unit == mto.unit
    assert pump.is_active is True


def test_list_shows_only_the_mtos_own_pumps_with_staff_counts(mto_api, mto):
    mine = tieup_pump(mto.unit)
    PumpStaffFactory(unit=mto.unit, pump=mine)
    PumpStaffFactory(unit=mto.unit, pump=mine)
    terminated = PumpStaffFactory(unit=mto.unit, pump=mine)
    terminated.status = "TERMINATED"
    terminated.save()
    tieup_pump(UnitFactory())

    body = mto_api.get("/api/pumps/").json()

    assert [pump["id"] for pump in body] == [mine.id]
    assert body[0]["staff_count"] == 2


def test_listing_does_not_query_per_pump(mto_api, mto):
    police_pump(mto.unit)
    with CaptureQueriesContext(connection) as one:
        mto_api.get("/api/pumps/")
    for _ in range(3):
        PumpStaffFactory(unit=mto.unit, pump=police_pump(mto.unit))
    with CaptureQueriesContext(connection) as four:
        response = mto_api.get("/api/pumps/")
    assert len(response.json()) == 4
    assert len(four) == len(one)


def test_another_units_pump_is_not_found(mto_api):
    foreign = police_pump(UnitFactory())
    assert mto_api.get(f"/api/pumps/{foreign.id}/").status_code == 404
    assert mto_api.patch(f"/api/pumps/{foreign.id}/", {"name": "Mine now"}).status_code == 404
    assert mto_api.post(f"/api/pumps/{foreign.id}/deactivate/").status_code == 404
    assert mto_api.post(f"/api/pumps/{foreign.id}/activate/").status_code == 404
    foreign.refresh_from_db()
    assert foreign.name != "Mine now"
    assert foreign.is_active is True


def test_detail_shows_tanks_with_low_stock_flags(mto_api, mto):
    pump = police_pump(mto.unit, petrol=Decimal("500"), diesel=Decimal("90"))
    tanks = {tank["fuel_type"]: tank for tank in mto_api.get(f"/api/pumps/{pump.id}/").json()["tanks"]}
    assert tanks["PETROL"]["current_stock_litres"] == "500.00"
    assert tanks["PETROL"]["is_low"] is False
    assert tanks["DIESEL"]["current_stock_litres"] == "90.00"
    assert tanks["DIESEL"]["is_low"] is True
    assert set(tanks["DIESEL"]) == {
        "id", "fuel_type", "current_stock_litres", "low_stock_threshold_litres", "capacity_litres", "is_low",
    }


def test_deactivate_and_activate(mto_api, mto):
    pump = tieup_pump(mto.unit)
    deactivated = mto_api.post(f"/api/pumps/{pump.id}/deactivate/")
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False
    pump.refresh_from_db()
    assert pump.is_active is False

    activated = mto_api.post(f"/api/pumps/{pump.id}/activate/")
    assert activated.status_code == 200
    assert activated.json()["is_active"] is True
    pump.refresh_from_db()
    assert pump.is_active is True


def test_inactive_pumps_stay_in_the_mtos_list(mto_api, mto):
    pump = tieup_pump(mto.unit)
    mto_api.post(f"/api/pumps/{pump.id}/deactivate/")
    assert [row["id"] for row in mto_api.get("/api/pumps/").json()] == [pump.id]


def test_only_an_mto_can_manage_pumps(api):
    driver = DriverFactory()
    api.force_login(driver)
    assert api.get("/api/pumps/").status_code == 403
    assert api.post("/api/pumps/", pump_payload()).status_code == 403


def test_pumps_cannot_be_deleted_or_replaced_through_the_api(mto_api, mto):
    pump = tieup_pump(mto.unit)
    assert mto_api.delete(f"/api/pumps/{pump.id}/").status_code == 405
    assert mto_api.put(f"/api/pumps/{pump.id}/", pump_payload()).status_code == 405
