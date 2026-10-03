import pytest

from fleet import services
from fleet.models import Vehicle, VehicleStatus
from testing.factories import (
    DriverFactory,
    MTOFactory,
    OfficerFactory,
    UnitFactory,
    VehicleFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def mto_api(api, mto):
    api.force_login(mto)
    return api


def vehicle_payload(**overrides):
    payload = {
        "registration_number": "ap 39 pa 1234",
        "vehicle_type": "JEEP",
        "make": "Mahindra",
        "model": "Bolero",
        "year_of_manufacture": 2021,
        "fuel_type": "DIESEL",
        "tank_capacity_litres": "60",
        "monthly_fuel_limit_litres": "120",
    }
    payload.update(overrides)
    return payload


def test_mto_creates_a_vehicle_in_their_own_unit(mto_api, mto):
    response = mto_api.post("/api/vehicles/", vehicle_payload())
    assert response.status_code == 201
    body = response.json()
    assert body["registration_number"] == "AP39PA1234"
    assert body["status"] == "ACTIVE"
    assert body["status_label"] == "Active"
    assert body["current_officer"] is None
    assert body["current_driver"] is None
    assert body["tank_capacity_litres"] == "60.00"
    vehicle = Vehicle.objects.get(pk=body["id"])
    assert vehicle.unit == mto.unit
    assert vehicle.status == VehicleStatus.ACTIVE


def test_create_ignores_a_status_or_unit_sent_by_the_client(mto_api, mto):
    other = UnitFactory()
    response = mto_api.post(
        "/api/vehicles/", vehicle_payload(status="TERMINATED", unit=other.id)
    )
    assert response.status_code == 201
    vehicle = Vehicle.objects.get(pk=response.json()["id"])
    assert vehicle.status == VehicleStatus.ACTIVE
    assert vehicle.unit == mto.unit


def test_same_plate_typed_differently_is_a_duplicate(mto_api):
    assert mto_api.post("/api/vehicles/", vehicle_payload(registration_number="AP-39-PA-1234")).status_code == 201
    response = mto_api.post("/api/vehicles/", vehicle_payload(registration_number="ap39 pa1234"))
    assert response.status_code == 400
    assert response.json()["registration_number"] == ["A vehicle with this registration number already exists."]


def test_duplicate_check_excludes_the_vehicle_being_edited(mto_api, mto):
    vehicle = VehicleFactory(unit=mto.unit, registration_number="AP39PA1234")
    response = mto_api.patch(f"/api/vehicles/{vehicle.id}/", {"registration_number": "ap 39 pa 1234", "make": "Tata"})
    assert response.status_code == 200
    assert response.json()["make"] == "Tata"


@pytest.mark.parametrize("value", ["AP1", "A-B-1", "AP39PA1234567"])
def test_registration_must_be_6_to_12_characters_once_normalized(mto_api, value):
    response = mto_api.post("/api/vehicles/", vehicle_payload(registration_number=value))
    assert response.status_code == 400
    assert response.json()["registration_number"] == ["Enter a valid registration number, e.g. AP39PA1234."]


def test_plate_typed_with_many_separators_is_accepted_and_normalized(mto_api):
    response = mto_api.post("/api/vehicles/", vehicle_payload(registration_number="AP - 39 - PA - 1234"))
    assert response.status_code == 201
    assert response.json()["registration_number"] == "AP39PA1234"
    assert Vehicle.objects.get(pk=response.json()["id"]).registration_number == "AP39PA1234"


def test_long_input_that_normalizes_too_long_gets_the_registration_message(mto_api):
    response = mto_api.post("/api/vehicles/", vehicle_payload(registration_number="AP - 39 - PA - 1234 - EXTRA"))
    assert response.status_code == 400
    assert response.json()["registration_number"] == ["Enter a valid registration number, e.g. AP39PA1234."]


def test_tank_capacity_must_be_more_than_zero(mto_api):
    response = mto_api.post("/api/vehicles/", vehicle_payload(tank_capacity_litres="0"))
    assert response.status_code == 400
    assert response.json()["tank_capacity_litres"] == ["Tank capacity must be more than 0."]


def test_monthly_limit_cannot_be_negative(mto_api):
    response = mto_api.post("/api/vehicles/", vehicle_payload(monthly_fuel_limit_litres="-1"))
    assert response.status_code == 400
    assert response.json()["monthly_fuel_limit_litres"] == ["The monthly limit can't be negative."]


@pytest.mark.parametrize("year", [-1, 1979, 2999, 40000])
def test_year_must_be_between_1980_and_this_year(mto_api, year):
    response = mto_api.post("/api/vehicles/", vehicle_payload(year_of_manufacture=year))
    assert response.status_code == 400
    assert response.json()["year_of_manufacture"] == ["Enter a valid year."]


@pytest.mark.parametrize("field", ["service_interval_km", "service_interval_days"])
@pytest.mark.parametrize("value", [0, -5])
def test_service_interval_of_zero_or_less_is_refused(mto_api, field, value):
    response = mto_api.post("/api/vehicles/", vehicle_payload(**{field: value}))
    assert response.status_code == 400
    assert response.json()[field] == ["Use a number greater than 0."]


def test_list_shows_only_own_unit_and_searches_the_normalized_number(mto_api, mto):
    mine = VehicleFactory(unit=mto.unit, registration_number="AP39PA1234")
    VehicleFactory(unit=mto.unit, registration_number="AP39PB9999")
    VehicleFactory(unit=UnitFactory(), registration_number="AP39PA7777")

    everything = mto_api.get("/api/vehicles/").json()
    assert len(everything) == 2

    found = mto_api.get("/api/vehicles/", {"search": "39 pa"}).json()
    assert [row["id"] for row in found] == [mine.id]


def test_list_filters_by_status(mto_api, mto):
    VehicleFactory(unit=mto.unit)
    paused = VehicleFactory(unit=mto.unit, status=VehicleStatus.PAUSED)
    rows = mto_api.get("/api/vehicles/", {"status": "PAUSED"}).json()
    assert [row["id"] for row in rows] == [paused.id]


def test_another_units_vehicle_is_not_found(mto_api):
    foreign = VehicleFactory(unit=UnitFactory())
    assert mto_api.get(f"/api/vehicles/{foreign.id}/").status_code == 404
    assert mto_api.post(f"/api/vehicles/{foreign.id}/pause/").status_code == 404
    assert mto_api.patch(f"/api/vehicles/{foreign.id}/", {"make": "Tata"}).status_code == 404


def test_pause_and_resume(mto_api, mto):
    vehicle = VehicleFactory(unit=mto.unit)

    paused = mto_api.post(f"/api/vehicles/{vehicle.id}/pause/")
    assert paused.status_code == 200
    assert paused.json()["status"] == "PAUSED"

    again = mto_api.post(f"/api/vehicles/{vehicle.id}/pause/")
    assert again.status_code == 400
    assert again.json()["detail"] == "Only active vehicles can be paused."

    resumed = mto_api.post(f"/api/vehicles/{vehicle.id}/resume/")
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "ACTIVE"

    again = mto_api.post(f"/api/vehicles/{vehicle.id}/resume/")
    assert again.status_code == 400
    assert again.json()["detail"] == "Only paused vehicles can be resumed."


def test_detail_shows_current_officer_and_driver(mto_api, mto):
    vehicle = VehicleFactory(unit=mto.unit)
    officer = OfficerFactory(unit=mto.unit, mobile="9876543210")
    driver = DriverFactory(unit=mto.unit)
    officer_link = services.assign_person(vehicle, officer, mto)
    driver_link = services.assign_person(vehicle, driver, mto)

    body = mto_api.get(f"/api/vehicles/{vehicle.id}/").json()

    assert body["current_officer"] == {
        "assignment_id": officer_link.id,
        "id": officer.id,
        "full_name": officer.full_name,
        "emp_id": officer.emp_id,
        "mobile": "9876543210",
    }
    assert body["current_driver"]["assignment_id"] == driver_link.id
    assert body["current_driver"]["id"] == driver.id

    services.end_assignment(driver_link, mto)
    body = mto_api.get(f"/api/vehicles/{vehicle.id}/").json()
    assert body["current_driver"] is None
    assert body["current_officer"]["id"] == officer.id


def test_list_shows_links_with_a_fixed_number_of_queries(mto_api, mto, django_assert_max_num_queries):
    for _ in range(4):
        vehicle = VehicleFactory(unit=mto.unit)
        services.assign_person(vehicle, OfficerFactory(unit=mto.unit), mto)
        services.assign_person(vehicle, DriverFactory(unit=mto.unit), mto)
    with django_assert_max_num_queries(6):
        response = mto_api.get("/api/vehicles/")
    assert all(row["current_officer"] and row["current_driver"] for row in response.json())


def test_service_intervals_are_optional(mto_api):
    response = mto_api.post("/api/vehicles/", vehicle_payload(service_interval_km=5000))
    assert response.status_code == 201
    body = response.json()
    assert body["service_interval_km"] == 5000
    assert body["service_interval_days"] is None


def test_driver_gets_403(api):
    api.force_login(DriverFactory())
    assert api.get("/api/vehicles/").status_code == 403


def test_anonymous_is_refused(api):
    assert api.get("/api/vehicles/").status_code in (401, 403)


def test_delete_is_not_allowed(mto_api, mto):
    vehicle = VehicleFactory(unit=mto.unit)
    assert mto_api.delete(f"/api/vehicles/{vehicle.id}/").status_code == 405
