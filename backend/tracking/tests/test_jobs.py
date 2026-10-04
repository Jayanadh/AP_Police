from datetime import timedelta

import pytest
from django.utils import timezone

from notifications.models import Notification
from testing.factories import MTOFactory, VehicleFactory, driver_on
from tracking import jobs, services
from tracking.models import DutyTrip, LocationPoint

pytestmark = pytest.mark.django_db


@pytest.fixture
def trip():
    vehicle = VehicleFactory(unit=MTOFactory().unit, registration_number="AP39PA1001")
    return services.start_trip(driver_on(vehicle), "Night patrol, Nellore town")


def point():
    return {"latitude": 14.4426, "longitude": 79.9865, "recorded_at": timezone.now()}


def test_a_trip_silent_for_twelve_hours_is_ended_and_the_driver_told(trip):
    sending = services.start_trip(driver_on(VehicleFactory(unit=trip.unit)), "Still sending")
    services.record_points(sending, [point()])
    DutyTrip.objects.filter(pk__in=[trip.pk, sending.pk]).update(started_at=timezone.now() - timedelta(hours=13))
    now = timezone.now()

    assert jobs.end_silent_trips(now) == 1

    trip.refresh_from_db()
    sending.refresh_from_db()
    assert trip.ended_at == now
    assert trip.end_reason == "No location for 12 hours."
    assert sending.ended_at is None
    alert = Notification.objects.get(recipient=trip.driver)
    assert alert.title == "Live location stopped"
    assert alert.link == "/driver/live"


def test_old_locations_are_forgotten_but_the_trip_is_kept(trip):
    services.record_points(trip, [point()])
    services.stop_trip(trip)
    recent = services.start_trip(driver_on(VehicleFactory(unit=trip.unit)), "Recent")
    services.record_points(recent, [point()])
    services.stop_trip(recent)
    DutyTrip.objects.filter(pk=trip.pk).update(ended_at=timezone.now() - timedelta(days=91))

    assert jobs.forget_old_locations(timezone.now()) == 1

    assert not LocationPoint.objects.filter(trip=trip).exists()
    assert LocationPoint.objects.filter(trip=recent).count() == 1
    trip.refresh_from_db()
    assert trip.last_latitude is not None  # the trip itself, and where it last was, stay
