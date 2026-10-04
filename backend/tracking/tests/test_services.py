from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from common.exceptions import BusinessRuleError
from fleet import services as fleet_services
from fleet.models import VehicleStatus
from testing.factories import DriverFactory, MTOFactory, UnitFactory, VehicleFactory, driver_on
from tracking import services
from tracking.models import DutyTrip, LocationPoint

pytestmark = pytest.mark.django_db

DUTY = "Night patrol, Nellore town"


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(unit=mto.unit, registration_number="AP39PA1001")


@pytest.fixture
def driver(vehicle):
    return driver_on(vehicle)


@pytest.fixture
def trip(driver):
    return services.start_trip(driver, DUTY)


def point(minutes_ago=0.0, lat=14.4426, lng=79.9865, **extra):
    return {"latitude": lat, "longitude": lng, "recorded_at": timezone.now() - timedelta(minutes=minutes_ago), **extra}


def refusal(call, *args) -> str:
    with pytest.raises(BusinessRuleError) as error:
        call(*args)
    return str(error.value.detail)


# --- starting -------------------------------------------------------------------------------------------------------


def test_a_driver_starts_sharing_with_the_duty_particulars(driver, vehicle):
    before = timezone.now()

    trip = services.start_trip(driver, f"  {DUTY}  ")

    assert (trip.driver, trip.vehicle, trip.unit) == (driver, vehicle, vehicle.unit)
    assert trip.duty_particulars == DUTY
    assert before <= trip.started_at <= timezone.now()
    assert trip.ended_at is None
    assert trip.last_point_at is None


def test_the_duty_particulars_are_required(driver):
    assert refusal(services.start_trip, driver, "   ") == "Enter the duty particulars."


def test_a_driver_with_no_vehicle_cannot_share(mto):
    loose = DriverFactory(unit=mto.unit)
    assert refusal(services.start_trip, loose, DUTY) == "You are not linked to a vehicle. Contact your MTO."


def test_a_paused_vehicle_cannot_go_on_duty(driver, vehicle):
    vehicle.status = VehicleStatus.PAUSED
    vehicle.save()
    assert refusal(services.start_trip, driver, DUTY) == "This vehicle is paused or terminated."


def test_one_trip_at_a_time(trip, driver):
    assert refusal(services.start_trip, driver, DUTY) == "You are already sharing your live location. Stop it first."


def test_a_new_trip_can_start_once_the_last_one_stopped(trip, driver):
    services.stop_trip(trip)

    assert services.start_trip(driver, "Court duty").pk != trip.pk


# --- locations ------------------------------------------------------------------------------------------------------


def test_locations_are_kept_and_the_trip_knows_its_newest(trip):
    accepted = services.record_points(trip, [point(2), point(1, lat=14.45, lng=79.99, accuracy=12.5, speed=8.0)])

    assert accepted == 2
    assert LocationPoint.objects.filter(trip=trip).count() == 2
    trip.refresh_from_db()
    assert (trip.last_latitude, trip.last_longitude) == (Decimal("14.450000"), Decimal("79.990000"))
    assert trip.last_accuracy_m == 12.5
    newest = LocationPoint.objects.filter(trip=trip).order_by("-recorded_at").first()
    assert trip.last_point_at == newest.recorded_at
    assert newest.speed_mps == 8.0


def test_a_late_batch_of_older_locations_does_not_move_the_trip_back(trip):
    DutyTrip.objects.filter(pk=trip.pk).update(started_at=timezone.now() - timedelta(minutes=30))
    services.record_points(trip, [point(1, lat=15.0)])
    services.record_points(trip, [point(5, lat=14.0)])  # sent late, after the phone was back online

    trip.refresh_from_db()
    assert trip.last_latitude == Decimal("15.000000")
    assert LocationPoint.objects.filter(trip=trip).count() == 2


def test_a_location_sent_twice_is_kept_once(trip):
    same = point(1)
    assert services.record_points(trip, [same]) == 1
    assert services.record_points(trip, [same, point(0.5)]) == 1
    assert LocationPoint.objects.filter(trip=trip).count() == 2


@pytest.mark.parametrize("minutes_ago", [60 * 24, -10])
def test_a_location_from_outside_the_trip_is_refused(trip, minutes_ago):
    """From long before the start, or minutes in the future: a wrong clock, not a place the vehicle was."""
    message = refusal(services.record_points, trip, [point(1), point(minutes_ago)])

    assert message == "A location's time is outside this trip. Check the phone's clock."
    assert not LocationPoint.objects.exists()


def test_an_ended_trip_takes_no_more_locations(trip):
    services.stop_trip(trip)
    assert refusal(services.record_points, trip, [point()]) == "This trip has ended. Stopped by the driver."


def test_a_trip_ends_once_its_driver_is_unlinked_from_the_vehicle(mto, driver, trip):
    """However the link ended (unlinked, the driver removed, the vehicle terminated), the next batch ends the trip:
    the locations no longer belong to that vehicle."""
    fleet_services.end_assignment(driver.vehicle_assignments.get(ended_at__isnull=True), mto)

    message = refusal(services.record_points, trip, [point()])

    assert message == "This trip has ended. The driver is no longer linked to AP39PA1001."
    trip.refresh_from_db()
    assert trip.ended_at is not None
    assert not LocationPoint.objects.exists()


# --- stopping -------------------------------------------------------------------------------------------------------


def test_the_driver_stops_sharing(trip):
    stopped = services.stop_trip(trip)

    assert stopped.ended_at is not None
    assert stopped.end_reason == "Stopped by the driver."


def test_a_trip_stops_only_once(trip):
    services.stop_trip(trip)
    assert refusal(services.stop_trip, trip) == "This trip has already ended."


# --- what the MTO sees ----------------------------------------------------------------------------------------------


def test_the_board_lists_every_driver_of_the_office_those_on_duty_first(mto, vehicle, driver, trip):
    services.record_points(trip, [point()])
    idle_vehicle = VehicleFactory(unit=mto.unit, registration_number="AP39PA1002")
    idle = driver_on(idle_vehicle)
    unlinked = DriverFactory(unit=mto.unit)
    elsewhere = driver_on(VehicleFactory(unit=UnitFactory()))
    services.start_trip(elsewhere, "Not this office")
    DriverFactory(unit=mto.unit, status="TERMINATED")

    rows = services.live_board(mto)

    assert [row.driver for row in rows][:1] == [driver]
    assert {row.driver for row in rows} == {driver, idle, unlinked}
    on_duty = rows[0]
    assert (on_duty.vehicle, on_duty.trip) == (vehicle, trip)
    by_driver = {row.driver: row for row in rows}
    assert (by_driver[idle].vehicle, by_driver[idle].trip) == (idle_vehicle, None)
    assert (by_driver[unlinked].vehicle, by_driver[unlinked].trip) == (None, None)


def test_the_board_ignores_a_vehicle_link_that_ended(mto, vehicle, driver):
    link = driver.vehicle_assignments.get(ended_at__isnull=True)
    fleet_services.end_assignment(link, mto)

    [row] = services.live_board(mto)

    assert (row.driver, row.vehicle, row.trip) == (driver, None, None)
