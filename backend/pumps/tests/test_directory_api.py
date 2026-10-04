from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from fleet.models import FuelType
from masters.models import District
from pumps.models import PumpKind
from testing.factories import (
    DriverFactory,
    MTOFactory,
    PumpFactory,
    UnitFactory,
    master,
    police_pump,
    tieup_pump,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def driver_api(api):
    api.force_login(DriverFactory())
    return api


def names(response):
    return [pump["name"] for pump in response.json()]


def test_directory_needs_a_login(api):
    assert api.get("/api/pump-directory/").status_code == 403


def test_directory_lists_active_pumps_of_every_unit_to_a_driver(driver_api):
    nellore = police_pump(UnitFactory(name="Nellore MTO"), petrol=Decimal("500"), diesel=Decimal("0"))
    guntur_district = master(District, "Guntur")
    guntur = PumpFactory(
        unit=UnitFactory(name="Guntur MTO"),
        name="Krishna Fuel Point",
        kind=PumpKind.TIE_UP,
        district=guntur_district,
        sells_diesel=False,
        latitude=Decimal("16.310000"),
        longitude=Decimal("80.440000"),
    )

    response = driver_api.get("/api/pump-directory/")

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()}
    assert set(rows) == {nellore.id, guntur.id}
    assert set(rows[guntur.id]) == {
        "id", "name", "kind", "kind_label", "address", "district_name", "unit_name", "latitude", "longitude",
        "opening_hours", "sells_petrol", "sells_diesel", "petrol_available", "diesel_available",
    }
    assert rows[guntur.id]["district_name"] == "Guntur"
    assert rows[guntur.id]["unit_name"] == "Guntur MTO"
    assert rows[guntur.id]["kind"] == "TIE_UP"
    assert rows[guntur.id]["kind_label"] == "Tie-up bunk"
    assert rows[guntur.id]["latitude"] == "16.310000"
    assert rows[guntur.id]["opening_hours"] == "24/7"


def test_petrol_is_unavailable_at_a_police_pump_with_no_petrol_stock(driver_api):
    pump = police_pump(UnitFactory(), petrol=Decimal("0"), diesel=Decimal("120"))
    row = driver_api.get("/api/pump-directory/").json()[0]
    assert row["id"] == pump.id
    assert row["sells_petrol"] is True
    assert row["petrol_available"] is False
    assert row["diesel_available"] is True


def test_a_tie_up_bunk_is_available_for_the_fuels_it_sells(driver_api):
    PumpFactory(unit=UnitFactory(), kind=PumpKind.TIE_UP, sells_diesel=False)
    row = driver_api.get("/api/pump-directory/").json()[0]
    assert row["petrol_available"] is True
    assert row["diesel_available"] is False  # not sold


def test_deactivating_a_pump_hides_it_from_the_directory(api):
    mto = MTOFactory()
    pump = tieup_pump(mto.unit)
    api.force_login(mto)
    assert names(api.get("/api/pump-directory/")) == [pump.name]

    api.post(f"/api/pumps/{pump.id}/deactivate/")
    assert api.get("/api/pump-directory/").json() == []

    api.post(f"/api/pumps/{pump.id}/activate/")
    assert names(api.get("/api/pump-directory/")) == [pump.name]


def test_fuel_filter_keeps_only_bunks_that_sell_that_fuel(driver_api):
    PumpFactory(name="Petrol Only", unit=UnitFactory(), kind=PumpKind.TIE_UP, sells_diesel=False)
    PumpFactory(name="Both Fuels", unit=UnitFactory(), kind=PumpKind.TIE_UP)
    PumpFactory(name="Diesel Only", unit=UnitFactory(), kind=PumpKind.TIE_UP, sells_petrol=False)

    assert names(driver_api.get("/api/pump-directory/?fuel=DIESEL")) == ["Both Fuels", "Diesel Only"]
    assert names(driver_api.get("/api/pump-directory/?fuel=PETROL")) == ["Both Fuels", "Petrol Only"]
    assert len(driver_api.get("/api/pump-directory/").json()) == 3


def test_fuel_filter_leaves_out_a_police_pump_without_that_fuel_in_stock(driver_api):
    """A driver is shown only the pumps that can fill their vehicle now."""
    dry = police_pump(UnitFactory(), petrol=Decimal("10"), diesel=Decimal("0"))
    dry.name = "Dry Diesel"
    dry.save()
    stocked = police_pump(UnitFactory(), petrol=Decimal("0"), diesel=Decimal("50"))
    stocked.name = "Has Diesel"
    stocked.save()

    assert names(driver_api.get(f"/api/pump-directory/?fuel={FuelType.DIESEL}")) == ["Has Diesel"]
    assert names(driver_api.get(f"/api/pump-directory/?fuel={FuelType.PETROL}")) == ["Dry Diesel"]
    assert names(driver_api.get("/api/pump-directory/")) == ["Dry Diesel", "Has Diesel"]


def test_search_matches_name_address_or_district(driver_api):
    PumpFactory(name="Alpha Fuels", address="Main Road", unit=UnitFactory(), kind=PumpKind.TIE_UP)
    PumpFactory(name="Bravo Bunk", address="Station Road, Tenali", unit=UnitFactory(), kind=PumpKind.TIE_UP)
    PumpFactory(
        name="Charlie Point", address="Ring Road", unit=UnitFactory(), kind=PumpKind.TIE_UP,
        district=master(District, "Guntur"),
    )

    assert names(driver_api.get("/api/pump-directory/?search=alpha")) == ["Alpha Fuels"]
    assert names(driver_api.get("/api/pump-directory/?search=tenali")) == ["Bravo Bunk"]
    assert names(driver_api.get("/api/pump-directory/?search=GUNTUR")) == ["Charlie Point"]
    assert names(driver_api.get("/api/pump-directory/?search=nothing-here")) == []


def test_directory_is_ordered_by_name(driver_api):
    for name in ["Zeta Fuels", "Alpha Bunk", "Mid Point"]:
        PumpFactory(name=name, unit=UnitFactory(), kind=PumpKind.TIE_UP)
    assert names(driver_api.get("/api/pump-directory/")) == ["Alpha Bunk", "Mid Point", "Zeta Fuels"]


def test_directory_does_not_query_per_pump(driver_api):
    police_pump(UnitFactory(), petrol=Decimal("10"))
    with CaptureQueriesContext(connection) as one:
        driver_api.get("/api/pump-directory/")
    for _ in range(3):
        police_pump(UnitFactory(), petrol=Decimal("10"))
    with CaptureQueriesContext(connection) as four:
        response = driver_api.get("/api/pump-directory/")
    assert len(response.json()) == 4
    assert len(four) == len(one)
