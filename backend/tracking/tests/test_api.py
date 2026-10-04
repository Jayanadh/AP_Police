"""/api/tracking/: the driver's trips and their locations, and the MTO's live board."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.throttling import ScopedRateThrottle

from testing.factories import (
    DriverFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    PumpStaffFactory,
    UnitFactory,
    VehicleFactory,
    driver_on,
)
from tracking import services
from tracking.models import DutyTrip

pytestmark = pytest.mark.django_db

TRIPS = "/api/tracking/trips/"
LIVE = "/api/tracking/live/"
TRIP_FIELDS = {
    "id", "driver", "driver_name", "vehicle", "registration_number", "duty_particulars", "started_at", "ended_at",
    "end_reason", "last_point_at", "latitude", "longitude", "accuracy_m", "is_open",
}


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(unit=mto.unit, registration_number="AP39PA1001", make="Mahindra", model="Bolero")


@pytest.fixture
def driver(vehicle):
    person = driver_on(vehicle)
    person.full_name, person.mobile = "Ravi Kumar", "9876543210"
    person.save()
    return person


@pytest.fixture
def trip(driver):
    trip = services.start_trip(driver, "Night patrol")
    DutyTrip.objects.filter(pk=trip.pk).update(started_at=timezone.now() - timedelta(minutes=30))
    trip.refresh_from_db()
    return trip


def iso(minutes_ago):
    return (timezone.now() - timedelta(minutes=minutes_ago)).isoformat()


def located(lat=14.4426, lng=79.9865, minutes_ago=1.0, **extra):
    return {"latitude": lat, "longitude": lng, "recorded_at": iso(minutes_ago), **extra}


# --- the driver's trip ----------------------------------------------------------------------------------------------


def test_the_driver_starts_sharing_with_the_duty_particulars(api, driver, vehicle):
    api.force_login(driver)

    response = api.post(TRIPS, {"duty_particulars": "Night patrol, Kavali highway"})

    assert response.status_code == 201
    body = response.json()
    assert set(body) == TRIP_FIELDS
    assert (body["driver"], body["driver_name"]) == (driver.id, "Ravi Kumar")
    assert (body["vehicle"], body["registration_number"]) == (vehicle.id, "AP39PA1001")
    assert body["duty_particulars"] == "Night patrol, Kavali highway"
    assert body["is_open"] is True
    assert (body["latitude"], body["longitude"], body["last_point_at"]) == (None, None, None)


def test_the_duty_particulars_are_required(api, driver):
    api.force_login(driver)
    response = api.post(TRIPS, {"duty_particulars": " "})
    assert response.status_code == 400
    assert response.json() == {"detail": "Enter the duty particulars."}


@pytest.mark.parametrize("maker", [MTOFactory, OfficerFactory, PTOFactory, PumpStaffFactory])
def test_only_drivers_share_their_location(api, maker):
    api.force_login(maker())
    assert api.post(TRIPS, {"duty_particulars": "x"}).status_code == 403


def test_the_driver_reads_the_trip_still_open(api, driver):
    api.force_login(driver)
    assert api.get(f"{TRIPS}current/").json() == {"trip": None}

    started = api.post(TRIPS, {"duty_particulars": "Night patrol"}).json()

    assert api.get(f"{TRIPS}current/").json() == {"trip": started}


def test_the_phone_sends_a_batch_of_locations(api, driver, trip):
    api.force_login(driver)

    response = api.post(
        f"{TRIPS}{trip.id}/points/",
        {"points": [located(minutes_ago=2), located(14.45, 79.99, minutes_ago=1, accuracy=9.5, speed=7, heading=90)]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] == 2
    assert (body["trip"]["latitude"], body["trip"]["longitude"], body["trip"]["accuracy_m"]) == (14.45, 79.99, 9.5)
    assert body["trip"] == api.get(f"{TRIPS}current/").json()["trip"]


def test_a_batch_sent_twice_is_kept_once(api, driver, trip):
    """The phone sends again when it never heard back; the second time nothing new is kept."""
    api.force_login(driver)
    batch = {"points": [located(minutes_ago=2), located(minutes_ago=1)]}

    api.post(f"{TRIPS}{trip.id}/points/", batch)
    again = api.post(f"{TRIPS}{trip.id}/points/", batch)

    assert again.status_code == 200
    assert again.json()["accepted"] == 0
    assert trip.points.count() == 2


@pytest.mark.parametrize(
    "points, field",
    [
        ([], "points"),
        ([{"latitude": 14.4, "longitude": 79.9, "recorded_at": "2026-10-04T10:00:00+05:30", "speed": -1}], "points"),
        ([{"latitude": 91, "longitude": 79.9, "recorded_at": "2026-10-04T10:00:00+05:30"}], "points"),
        ([{"latitude": 14.4, "longitude": 181, "recorded_at": "2026-10-04T10:00:00+05:30"}], "points"),
        ([{"latitude": 14.4, "longitude": 79.9}], "points"),
        ([{"latitude": 14.4, "longitude": 79.9, "recorded_at": "yesterday"}], "points"),
        ([{"latitude": "nan", "longitude": 79.9, "recorded_at": "2026-10-04T10:00:00+05:30"}], "points"),
        ("not a list", "points"),
    ],
)
def test_bad_locations_are_refused_and_nothing_is_kept(api, driver, trip, points, field):
    api.force_login(driver)

    response = api.post(f"{TRIPS}{trip.id}/points/", {"points": points})

    assert response.status_code == 400
    assert field in response.json()
    assert not trip.points.exists()


def test_a_batch_has_a_size_limit(api, driver, trip, settings):
    settings.MTO_RULES = {**settings.MTO_RULES, "MAX_POINTS_PER_BATCH": 2}
    api.force_login(driver)

    response = api.post(f"{TRIPS}{trip.id}/points/", {"points": [located(minutes_ago=m) for m in (3, 2, 1)]})

    assert response.status_code == 400
    assert response.json() == {"points": ["Send at most 2 locations at a time."]}


def test_a_location_from_before_the_trip_is_refused(api, driver, trip):
    api.force_login(driver)

    response = api.post(f"{TRIPS}{trip.id}/points/", {"points": [located(minutes_ago=60 * 24)]})

    assert response.status_code == 400
    assert response.json() == {"detail": "A location's time is outside this trip. Check the phone's clock."}


def test_location_batches_are_rate_limited_per_driver(api, driver, trip, monkeypatch):
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"location": "2/min"})
    api.force_login(driver)
    sends = [api.post(f"{TRIPS}{trip.id}/points/", {"points": [located(minutes_ago=m)]}) for m in (3, 2, 1)]

    assert [response.status_code for response in sends] == [200, 200, 429]


def test_a_driver_cannot_send_or_stop_another_drivers_trip(api, trip, vehicle):
    api.force_login(driver_on(VehicleFactory(unit=vehicle.unit)))

    assert api.post(f"{TRIPS}{trip.id}/points/", {"points": [located()]}).status_code == 404
    assert api.post(f"{TRIPS}{trip.id}/stop/").status_code == 404


def test_the_driver_stops_sharing(api, driver, trip):
    api.force_login(driver)

    response = api.post(f"{TRIPS}{trip.id}/stop/")

    assert response.status_code == 200
    assert (response.json()["is_open"], response.json()["end_reason"]) == (False, "Stopped by the driver.")
    assert api.get(f"{TRIPS}current/").json() == {"trip": None}
    late = api.post(f"{TRIPS}{trip.id}/points/", {"points": [located()]})
    assert late.json() == {"detail": "This trip has ended. Stopped by the driver."}


# --- the MTO's live board -------------------------------------------------------------------------------------------


def test_the_mto_sees_the_offices_drivers_with_where_those_on_duty_are(api, mto, driver, trip, vehicle):
    services.record_points(trip, [{"latitude": 14.45, "longitude": 79.99, "recorded_at": timezone.now()}])
    idle = DriverFactory(unit=mto.unit, full_name="Shaik Imran")
    api.force_login(mto)

    rows = api.get(LIVE).json()

    assert [row["driver"]["full_name"] for row in rows] == ["Ravi Kumar", "Shaik Imran"]
    on_duty, off_duty = rows
    assert on_duty["driver"] == {
        "id": driver.id, "full_name": "Ravi Kumar", "emp_id": driver.emp_id, "mobile": "9876543210",
    }
    assert on_duty["vehicle"] == {
        "id": vehicle.id, "registration_number": "AP39PA1001", "vehicle_name": "Mahindra Bolero",
    }
    assert (on_duty["trip"]["id"], on_duty["trip"]["latitude"], on_duty["trip"]["longitude"]) == (trip.id, 14.45, 79.99)
    assert on_duty["trip"]["duty_particulars"] == "Night patrol"
    assert (off_duty["driver"]["id"], off_duty["vehicle"], off_duty["trip"]) == (idle.id, None, None)


def test_the_board_reads_the_office_in_a_fixed_number_of_queries(api, mto, django_assert_max_num_queries):
    for _ in range(4):
        trip = services.start_trip(driver_on(VehicleFactory(unit=mto.unit)), "Patrol")
        services.record_points(trip, [{"latitude": 14.45, "longitude": 79.99, "recorded_at": timezone.now()}])
    api.force_login(mto)

    with django_assert_max_num_queries(8):
        assert len(api.get(LIVE).json()) == 4


def test_another_offices_drivers_are_not_on_the_board(api, trip):
    api.force_login(MTOFactory(unit=UnitFactory()))
    assert api.get(LIVE).json() == []


@pytest.mark.parametrize("maker", [DriverFactory, OfficerFactory, PTOFactory, PumpStaffFactory])
def test_only_the_mto_reads_the_live_board(api, maker):
    api.force_login(maker())
    assert api.get(LIVE).status_code == 403


# --- a trip's route -------------------------------------------------------------------------------------------------


def places(body):
    return [(point["latitude"], point["longitude"]) for point in body["points"]]


def at(lat, minutes_ago):
    return {"latitude": lat, "longitude": 79.99, "recorded_at": timezone.now() - timedelta(minutes=minutes_ago)}


def test_the_mto_reads_a_trips_route_and_then_only_what_is_new(api, mto, trip):
    services.record_points(trip, [at(14.42, 3), at(14.43, 2)])
    api.force_login(mto)

    first = api.get(f"{TRIPS}{trip.id}/path/").json()

    assert first["trip"]["id"] == trip.id
    assert places(first) == [(14.42, 79.99), (14.43, 79.99)]
    assert first["more"] is False
    assert api.get(f"{TRIPS}{trip.id}/path/", {"after": first["cursor"]}).json()["points"] == []

    # A batch the phone kept while offline arrives late: what is new includes it, in time order.
    services.record_points(trip, [at(14.44, 1), at(14.415, 25)])
    newer = api.get(f"{TRIPS}{trip.id}/path/", {"after": first["cursor"]}).json()
    assert places(newer) == [(14.415, 79.99), (14.44, 79.99)]
    assert newer["cursor"] > first["cursor"]


def test_a_long_route_comes_a_page_at_a_time(api, mto, trip, monkeypatch):
    monkeypatch.setattr("tracking.views.PATH_PAGE", 2)
    services.record_points(trip, [at(14.41 + n / 100, 10 - n) for n in range(5)])
    api.force_login(mto)

    pages, after = [], 0
    while True:
        body = api.get(f"{TRIPS}{trip.id}/path/", {"after": after}).json()
        pages.append(places(body))
        after = body["cursor"]
        if not body["more"]:
            break

    assert [len(page) for page in pages] == [2, 2, 1]
    assert sum(pages, []) == [(14.41 + n / 100, 79.99) for n in range(5)]


def test_the_driver_reads_their_own_route(api, driver, trip):
    api.force_login(driver)
    assert api.get(f"{TRIPS}{trip.id}/path/").status_code == 200


def test_another_offices_mto_or_another_driver_cannot_read_the_route(api, trip, vehicle):
    api.force_login(MTOFactory(unit=UnitFactory()))
    assert api.get(f"{TRIPS}{trip.id}/path/").status_code == 404
    api.force_login(driver_on(VehicleFactory(unit=vehicle.unit)))
    assert api.get(f"{TRIPS}{trip.id}/path/").status_code == 404


def test_a_bad_cursor_is_refused(api, mto, trip):
    api.force_login(mto)
    response = api.get(f"{TRIPS}{trip.id}/path/", {"after": "yesterday"})
    assert response.status_code == 400
    assert response.json() == {"detail": "Use the cursor from the last answer."}
