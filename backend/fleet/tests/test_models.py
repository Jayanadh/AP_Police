import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from fleet.models import AssignmentKind, VehicleAssignment, normalize_registration
from testing.factories import DriverFactory, OfficerFactory, PTOFactory, VehicleFactory

pytestmark = pytest.mark.django_db


def test_normalize_registration_keeps_only_uppercase_letters_and_digits():
    assert normalize_registration("ap 39-pa 1234") == "AP39PA1234"


def test_registration_is_normalized_on_save():
    vehicle = VehicleFactory(registration_number="ap 39-pa 1234")
    vehicle.refresh_from_db()
    assert vehicle.registration_number == "AP39PA1234"


def test_registration_number_is_unique():
    VehicleFactory(registration_number="AP39PA1234")
    with pytest.raises(IntegrityError), transaction.atomic():
        VehicleFactory(registration_number="ap-39-pa-1234")


def link(vehicle, person, kind, *, ended=False):
    return VehicleAssignment.objects.create(
        vehicle=vehicle,
        person=person,
        kind=kind,
        assigned_by=PTOFactory(),
        ended_at=timezone.now() if ended else None,
    )


def test_database_enforces_one_current_officer_per_vehicle():
    vehicle = VehicleFactory()
    link(vehicle, OfficerFactory(unit=vehicle.unit), AssignmentKind.OFFICER)
    with pytest.raises(IntegrityError), transaction.atomic():
        link(vehicle, OfficerFactory(unit=vehicle.unit), AssignmentKind.OFFICER)


def test_database_enforces_one_current_driver_per_vehicle():
    vehicle = VehicleFactory()
    link(vehicle, DriverFactory(unit=vehicle.unit), AssignmentKind.DRIVER)
    with pytest.raises(IntegrityError), transaction.atomic():
        link(vehicle, DriverFactory(unit=vehicle.unit), AssignmentKind.DRIVER)


def test_database_enforces_one_vehicle_at_a_time_per_driver():
    vehicle = VehicleFactory()
    driver = DriverFactory(unit=vehicle.unit)
    link(vehicle, driver, AssignmentKind.DRIVER)
    with pytest.raises(IntegrityError), transaction.atomic():
        link(VehicleFactory(unit=vehicle.unit), driver, AssignmentKind.DRIVER)


def test_database_enforces_no_duplicate_current_link():
    vehicle = VehicleFactory()
    officer = OfficerFactory(unit=vehicle.unit)
    link(vehicle, officer, AssignmentKind.OFFICER)
    with pytest.raises(IntegrityError), transaction.atomic():
        link(vehicle, officer, AssignmentKind.OFFICER)


def test_ended_links_do_not_count_against_the_limits():
    vehicle = VehicleFactory()
    officer = OfficerFactory(unit=vehicle.unit)
    driver = DriverFactory(unit=vehicle.unit)
    link(vehicle, officer, AssignmentKind.OFFICER, ended=True)
    link(vehicle, officer, AssignmentKind.OFFICER, ended=True)
    link(vehicle, officer, AssignmentKind.OFFICER)
    link(vehicle, driver, AssignmentKind.DRIVER, ended=True)
    link(vehicle, DriverFactory(unit=vehicle.unit), AssignmentKind.DRIVER)
    link(VehicleFactory(unit=vehicle.unit), driver, AssignmentKind.DRIVER)


def test_an_officer_can_be_current_on_two_vehicles():
    officer = OfficerFactory()
    link(VehicleFactory(unit=officer.unit), officer, AssignmentKind.OFFICER)
    link(VehicleFactory(unit=officer.unit), officer, AssignmentKind.OFFICER)
