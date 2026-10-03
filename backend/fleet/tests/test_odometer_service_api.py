from datetime import timedelta

import pytest

from common.months import today_ist
from fleet import services
from fleet.models import ServiceRecord, Vehicle, VehicleStatus
from fleet.odometer import week_of
from testing.factories import (
    DriverFactory,
    MTOFactory,
    OdometerReadingFactory,
    OfficerFactory,
    ServiceRecordFactory,
    UnitFactory,
    VehicleFactory,
    driver_on,
)

pytestmark = pytest.mark.django_db

NOT_LINKED = "You are not linked to a vehicle. Contact your MTO."


def this_week():
    return week_of(today_ist())


def weeks_ago(count):
    return this_week() - timedelta(weeks=count)


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def mto_api(api, mto):
    api.force_login(mto)
    return api


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(unit=mto.unit, odometer_at_onboarding_km=10000, service_interval_km=5000)


@pytest.fixture
def driver(vehicle):
    return driver_on(vehicle)


@pytest.fixture
def driver_api(api, driver):
    api.force_login(driver)
    return api


def services_url(vehicle):
    return f"/api/vehicles/{vehicle.id}/services/"


def status_url(vehicle):
    return f"/api/vehicles/{vehicle.id}/service-status/"


# --- the driver records the Sunday reading --------------------------------------------------------


def test_driver_records_this_weeks_reading(driver_api, driver, vehicle):
    OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, week_of=weeks_ago(1), reading_km=10200)

    response = driver_api.post("/api/odometer/", {"reading_km": 10450})

    assert response.status_code == 201
    body = response.json()
    assert body == {
        "id": body["id"],
        "vehicle": vehicle.id,
        "registration_number": vehicle.registration_number,
        "week_of": this_week().isoformat(),
        "reading_km": 10450,
        "km_since_previous": 250,
        "recorded_by_name": driver.full_name,
        "created_at": body["created_at"],
    }
    assert vehicle.odometer_readings.get(week_of=this_week()).recorded_by == driver


def test_the_first_reading_has_no_previous_one_to_compare_with(driver_api):
    response = driver_api.post("/api/odometer/", {"reading_km": 10450})

    assert response.status_code == 201
    assert response.json()["km_since_previous"] is None


def test_a_second_reading_in_the_same_week_is_refused(driver_api, vehicle):
    driver_api.post("/api/odometer/", {"reading_km": 10450})

    response = driver_api.post("/api/odometer/", {"reading_km": 10600})

    assert response.status_code == 400
    assert response.json() == {"detail": "This week's reading is already recorded."}
    assert vehicle.odometer_readings.count() == 1


def test_a_lower_reading_is_refused_with_the_last_number(driver_api, driver, vehicle):
    OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, week_of=weeks_ago(1), reading_km=12000)

    response = driver_api.post("/api/odometer/", {"reading_km": 11000})

    assert response.status_code == 400
    assert response.json() == {"detail": "The reading can't be lower than the last reading (12000 km)."}
    assert vehicle.odometer_readings.count() == 1


def test_a_driver_without_a_vehicle_is_refused(api):
    api.force_login(DriverFactory())

    response = api.post("/api/odometer/", {"reading_km": 5000})

    assert response.status_code == 400
    assert response.json() == {"detail": NOT_LINKED}


@pytest.mark.parametrize("reading", [None, "", "abc", -5, 1.5, 10**12])
def test_the_reading_must_be_a_sensible_whole_number(driver_api, vehicle, reading):
    payload = {} if reading is None else {"reading_km": reading}

    response = driver_api.post("/api/odometer/", payload)

    assert response.status_code == 400
    assert "reading_km" in response.json()
    assert vehicle.odometer_readings.count() == 0


def test_only_drivers_record_readings(api, mto, vehicle):
    officer = OfficerFactory(unit=mto.unit)
    services.assign_person(vehicle, officer, mto)

    for person in (mto, officer):
        api.force_login(person)
        assert api.post("/api/odometer/", {"reading_km": 12000}).status_code == 403
    api.logout()
    assert api.post("/api/odometer/", {"reading_km": 12000}).status_code in (401, 403)
    assert vehicle.odometer_readings.count() == 0


# --- listing readings -----------------------------------------------------------------------------


def test_mto_lists_a_vehicles_readings_newest_first_with_the_km_since_the_previous(mto_api, driver, vehicle):
    for weeks, km in ((3, 10200), (2, 10500), (1, 10900)):
        OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, week_of=weeks_ago(weeks), reading_km=km)

    response = mto_api.get("/api/odometer/", {"vehicle": vehicle.id})

    assert response.status_code == 200
    assert [(r["week_of"], r["reading_km"], r["km_since_previous"]) for r in response.json()] == [
        (weeks_ago(1).isoformat(), 10900, 400),
        (weeks_ago(2).isoformat(), 10500, 300),
        (weeks_ago(3).isoformat(), 10200, None),
    ]
    first = response.json()[0]
    assert first["vehicle"] == vehicle.id
    assert first["registration_number"] == vehicle.registration_number
    assert first["recorded_by_name"] == driver.full_name


def test_km_since_previous_is_measured_within_each_vehicle(mto_api, mto, driver, vehicle):
    other = VehicleFactory(unit=mto.unit)
    OdometerReadingFactory(vehicle=other, week_of=weeks_ago(2), reading_km=500)
    OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, week_of=weeks_ago(1), reading_km=10300)

    response = mto_api.get("/api/odometer/")

    assert {r["registration_number"]: r["km_since_previous"] for r in response.json()} == {
        vehicle.registration_number: None,
        other.registration_number: None,
    }


def test_mto_without_a_filter_lists_only_the_unit_s_readings(mto_api, driver, vehicle):
    OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, reading_km=10300)
    OdometerReadingFactory(vehicle=VehicleFactory(unit=UnitFactory()), reading_km=777)

    response = mto_api.get("/api/odometer/")

    assert [r["reading_km"] for r in response.json()] == [10300]


def test_another_units_vehicle_is_invisible(mto_api):
    foreign = VehicleFactory(unit=UnitFactory())
    OdometerReadingFactory(vehicle=foreign)

    assert mto_api.get("/api/odometer/", {"vehicle": foreign.id}).status_code == 404


def test_the_vehicle_filter_must_be_an_id(mto_api):
    response = mto_api.get("/api/odometer/", {"vehicle": "abc"})

    assert response.status_code == 400
    assert response.json() == {"detail": "Use the vehicle's id."}


def test_driver_reads_the_readings_of_the_vehicle_they_are_linked_to(driver_api, driver, vehicle):
    OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, reading_km=10300)
    OdometerReadingFactory(vehicle=VehicleFactory(unit=vehicle.unit), reading_km=555)

    listed = driver_api.get("/api/odometer/", {"vehicle": vehicle.id})
    everything = driver_api.get("/api/odometer/")

    assert [r["reading_km"] for r in listed.json()] == [10300]
    assert [r["reading_km"] for r in everything.json()] == [10300]


def test_driver_cannot_read_a_vehicle_they_are_not_linked_to(driver_api, vehicle):
    unlinked = VehicleFactory(unit=vehicle.unit)

    assert driver_api.get("/api/odometer/", {"vehicle": unlinked.id}).status_code == 404


def test_officer_reads_the_readings_of_their_linked_vehicles(api, mto, driver, vehicle):
    officer = OfficerFactory(unit=mto.unit)
    services.assign_person(vehicle, officer, mto)
    OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, reading_km=10300)
    api.force_login(officer)

    response = api.get("/api/odometer/", {"vehicle": vehicle.id})

    assert response.status_code == 200
    assert [r["reading_km"] for r in response.json()] == [10300]


def test_a_driver_loses_sight_of_a_vehicle_when_the_link_ends(driver_api, mto, driver, vehicle):
    services.end_assignment(vehicle.assignments.get(person=driver), ended_by=mto)

    assert driver_api.get("/api/odometer/", {"vehicle": vehicle.id}).status_code == 404
    assert driver_api.get("/api/odometer/").json() == []


# --- readings still missing this week ---------------------------------------------------------------


def test_missing_lists_active_vehicles_with_a_driver_and_no_reading_this_week(mto_api, mto, driver, vehicle):
    other_driver = driver_on(VehicleFactory(unit=mto.unit))
    done = other_driver.vehicle_assignments.get().vehicle
    OdometerReadingFactory(vehicle=done, recorded_by=other_driver)
    VehicleFactory(unit=mto.unit)  # no driver
    paused = VehicleFactory(unit=mto.unit, status=VehicleStatus.PAUSED)
    driver_on(paused)
    driver_on(VehicleFactory(unit=UnitFactory()))  # another office

    response = mto_api.get("/api/odometer/missing/")

    assert response.status_code == 200
    assert response.json() == [
        {
            "vehicle": vehicle.id,
            "registration_number": vehicle.registration_number,
            "driver_name": driver.full_name,
            "week_of": this_week().isoformat(),
        }
    ]


def test_a_reading_of_an_earlier_week_does_not_count_as_this_weeks(mto_api, driver, vehicle):
    OdometerReadingFactory(vehicle=vehicle, recorded_by=driver, week_of=weeks_ago(1))

    assert [row["vehicle"] for row in mto_api.get("/api/odometer/missing/").json()] == [vehicle.id]


def test_recording_the_reading_takes_the_vehicle_off_the_missing_list(api, mto, driver, vehicle):
    api.force_login(mto)
    assert [row["vehicle"] for row in api.get("/api/odometer/missing/").json()] == [vehicle.id]

    api.force_login(driver)
    assert api.post("/api/odometer/", {"reading_km": 10500}).status_code == 201

    api.force_login(mto)
    assert api.get("/api/odometer/missing/").json() == []


def test_only_the_mto_sees_the_missing_list(api, driver, vehicle):
    api.force_login(driver)

    assert api.get("/api/odometer/missing/").status_code == 403


# --- service records ---------------------------------------------------------------------------------


def test_mto_adds_a_service_record(mto_api, mto, vehicle):
    response = mto_api.post(
        services_url(vehicle),
        {"service_date": "2026-09-20", "odometer_km": 12000, "notes": "Oil and filters changed."},
    )

    assert response.status_code == 201
    body = response.json()
    assert body == {
        "id": body["id"],
        "vehicle": vehicle.id,
        "service_date": "2026-09-20",
        "odometer_km": 12000,
        "notes": "Oil and filters changed.",
        "recorded_by_name": mto.full_name,
        "created_at": body["created_at"],
    }
    assert vehicle.service_records.get().recorded_by == mto


def test_notes_are_optional(mto_api, vehicle):
    response = mto_api.post(services_url(vehicle), {"service_date": "2026-09-20", "odometer_km": 12000})

    assert response.status_code == 201
    assert response.json()["notes"] == ""


def test_adding_a_service_resets_the_alert_flag(mto_api, vehicle):
    Vehicle.objects.filter(pk=vehicle.pk).update(service_due_alerted=True)

    mto_api.post(services_url(vehicle), {"service_date": today_ist().isoformat(), "odometer_km": 12000})

    vehicle.refresh_from_db()
    assert vehicle.service_due_alerted is False


def test_a_future_service_date_is_refused(mto_api, vehicle):
    tomorrow = today_ist() + timedelta(days=1)

    response = mto_api.post(services_url(vehicle), {"service_date": tomorrow.isoformat(), "odometer_km": 12000})

    assert response.status_code == 400
    assert response.json() == {"detail": "The service date can't be in the future."}
    assert ServiceRecord.objects.count() == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"odometer_km": 12000},
        {"service_date": "2026-09-20"},
        {"service_date": "not a date", "odometer_km": 12000},
        {"service_date": "2026-09-20", "odometer_km": -1},
        {"service_date": "2026-09-20", "odometer_km": 10**12},
    ],
)
def test_a_service_record_needs_a_date_and_a_sensible_odometer(mto_api, vehicle, payload):
    response = mto_api.post(services_url(vehicle), payload)

    assert response.status_code == 400
    assert ServiceRecord.objects.count() == 0


def test_mto_lists_the_service_records_newest_first(mto_api, vehicle):
    older = ServiceRecordFactory(vehicle=vehicle, service_date=today_ist() - timedelta(days=60), odometer_km=11000)
    newer = ServiceRecordFactory(vehicle=vehicle, service_date=today_ist() - timedelta(days=5), odometer_km=14000)
    ServiceRecordFactory(vehicle=VehicleFactory(unit=vehicle.unit))

    response = mto_api.get(services_url(vehicle))

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [newer.id, older.id]


def test_another_offices_vehicle_services_are_invisible(mto_api):
    foreign = VehicleFactory(unit=UnitFactory())
    ServiceRecordFactory(vehicle=foreign)

    assert mto_api.get(services_url(foreign)).status_code == 404
    assert mto_api.post(services_url(foreign), {"service_date": "2026-09-20", "odometer_km": 100}).status_code == 404
    assert mto_api.get(status_url(foreign)).status_code == 404
    assert foreign.service_records.count() == 1


def test_a_status_filter_does_not_hide_the_vehicle_s_own_service_pages(mto_api, vehicle):
    assert mto_api.get(services_url(vehicle), {"status": "PAUSED"}).status_code == 200


def test_only_the_mto_reaches_the_service_pages(api, driver, vehicle):
    api.force_login(driver)

    assert api.get(services_url(vehicle)).status_code == 403
    assert api.post(services_url(vehicle), {"service_date": "2026-09-20", "odometer_km": 100}).status_code == 403
    assert api.get(status_url(vehicle)).status_code == 403
    assert api.get("/api/service-due/").status_code == 403


# --- service status and the due list ------------------------------------------------------------------


def test_service_status_of_a_vehicle_that_has_never_been_serviced(mto_api, vehicle):
    OdometerReadingFactory(vehicle=vehicle, reading_km=15000)

    response = mto_api.get(status_url(vehicle))

    assert response.status_code == 200
    assert response.json() == {
        "due": True,
        "last_service_date": today_ist().isoformat(),  # the day the vehicle was added
        "last_service_km": 10000,
        "km_since": 5000,
        "days_since": 0,
        "next_due_km": 15000,
        "next_due_date": None,
    }


def test_service_status_after_a_service(mto_api, vehicle):
    ServiceRecordFactory(vehicle=vehicle, service_date=today_ist() - timedelta(days=10), odometer_km=15000)
    OdometerReadingFactory(vehicle=vehicle, reading_km=16000)

    body = mto_api.get(status_url(vehicle)).json()

    assert body["due"] is False
    assert body["last_service_date"] == (today_ist() - timedelta(days=10)).isoformat()
    assert body["last_service_km"] == 15000
    assert body["km_since"] == 1000
    assert body["days_since"] == 10
    assert body["next_due_km"] == 20000


def test_service_due_lists_only_due_vehicles_of_the_unit(mto_api, mto):
    def vehicle_at(km, **fields):
        fields.setdefault("service_interval_km", 5000)
        vehicle = VehicleFactory(unit=mto.unit, odometer_at_onboarding_km=0, **fields)
        OdometerReadingFactory(vehicle=vehicle, reading_km=km)
        return vehicle

    due = vehicle_at(6000)
    paused_due = vehicle_at(7000, status=VehicleStatus.PAUSED)
    vehicle_at(4000)  # not due yet
    vehicle_at(900000, service_interval_km=None)  # no interval: never due
    vehicle_at(6000, status=VehicleStatus.TERMINATION_PENDING)
    vehicle_at(6000, status=VehicleStatus.TERMINATED)
    foreign = VehicleFactory(unit=UnitFactory(), odometer_at_onboarding_km=0, service_interval_km=5000)
    OdometerReadingFactory(vehicle=foreign, reading_km=6000)

    response = mto_api.get("/api/service-due/")

    assert response.status_code == 200
    rows = response.json()
    assert [row["registration_number"] for row in rows] == sorted(
        [due.registration_number, paused_due.registration_number]
    )
    row = next(r for r in rows if r["vehicle"] == due.id)
    assert row == {
        "vehicle": due.id,
        "registration_number": due.registration_number,
        "due": True,
        "last_service_date": today_ist().isoformat(),
        "last_service_km": 0,
        "km_since": 6000,
        "days_since": 0,
        "next_due_km": 5000,
        "next_due_date": None,
    }


def test_a_vehicle_due_by_days_is_listed(mto_api, mto):
    vehicle = VehicleFactory(unit=mto.unit, service_interval_days=90)
    ServiceRecordFactory(vehicle=vehicle, service_date=today_ist() - timedelta(days=91), odometer_km=0)

    rows = mto_api.get("/api/service-due/").json()

    assert [row["vehicle"] for row in rows] == [vehicle.id]
    assert rows[0]["days_since"] == 91
