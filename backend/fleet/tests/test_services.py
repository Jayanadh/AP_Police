import pytest

from accounts.models import UserStatus
from common.exceptions import BusinessRuleError
from fleet import services
from fleet.models import AssignmentKind, VehicleStatus
from testing.factories import (
    DriverFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    UnitFactory,
    VehicleFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup():
    vehicle = VehicleFactory()
    unit = vehicle.unit
    return vehicle, unit, MTOFactory(unit=unit)


def test_officer_and_driver_can_both_be_linked(setup):
    vehicle, unit, mto = setup
    officer = OfficerFactory(unit=unit)
    driver = DriverFactory(unit=unit)

    officer_link = services.assign_person(vehicle, officer, mto)
    driver_link = services.assign_person(vehicle, driver, mto)

    assert officer_link.kind == AssignmentKind.OFFICER
    assert driver_link.kind == AssignmentKind.DRIVER
    assert officer_link.assigned_by == mto
    assert officer_link.ended_at is None
    assert set(services.current_links(vehicle)) == {officer_link, driver_link}


def test_second_officer_is_refused(setup):
    vehicle, unit, mto = setup
    services.assign_person(vehicle, OfficerFactory(unit=unit), mto)
    with pytest.raises(BusinessRuleError) as error:
        services.assign_person(vehicle, OfficerFactory(unit=unit), mto)
    assert str(error.value.detail) == "This vehicle already has an officer. End that link first."


def test_second_driver_on_the_same_vehicle_is_refused(setup):
    vehicle, unit, mto = setup
    services.assign_person(vehicle, DriverFactory(unit=unit), mto)
    with pytest.raises(BusinessRuleError) as error:
        services.assign_person(vehicle, DriverFactory(unit=unit), mto)
    assert str(error.value.detail) == "This vehicle already has a driver. End that link first."


def test_driver_already_on_another_vehicle_is_refused(setup):
    vehicle, unit, mto = setup
    other = VehicleFactory(unit=unit)
    driver = DriverFactory(unit=unit)
    services.assign_person(other, driver, mto)
    with pytest.raises(BusinessRuleError) as error:
        services.assign_person(vehicle, driver, mto)
    assert str(error.value.detail) == "This driver is already linked to another vehicle."


def test_officer_can_have_two_vehicles(setup):
    vehicle, unit, mto = setup
    other = VehicleFactory(unit=unit)
    officer = OfficerFactory(unit=unit)
    services.assign_person(vehicle, officer, mto)
    services.assign_person(other, officer, mto)
    assert officer.vehicle_assignments.filter(ended_at__isnull=True).count() == 2


def test_person_from_another_unit_is_refused(setup):
    vehicle, _unit, mto = setup
    stranger = OfficerFactory(unit=UnitFactory())
    with pytest.raises(BusinessRuleError) as error:
        services.assign_person(vehicle, stranger, mto)
    assert str(error.value.detail) == "This person belongs to a different MTO office."


def test_paused_person_is_refused(setup):
    vehicle, unit, mto = setup
    driver = DriverFactory(unit=unit, status=UserStatus.PAUSED)
    with pytest.raises(BusinessRuleError) as error:
        services.assign_person(vehicle, driver, mto)
    assert str(error.value.detail) == "Only active officers and drivers can be linked."


def test_terminated_vehicle_is_refused(setup):
    vehicle, unit, mto = setup
    vehicle.status = VehicleStatus.TERMINATED
    vehicle.save()
    with pytest.raises(BusinessRuleError) as error:
        services.assign_person(vehicle, DriverFactory(unit=unit), mto)
    assert str(error.value.detail) == "Only active or paused vehicles can be linked."


def test_paused_vehicle_can_still_be_linked(setup):
    vehicle, unit, mto = setup
    vehicle.status = VehicleStatus.PAUSED
    vehicle.save()
    link = services.assign_person(vehicle, DriverFactory(unit=unit), mto)
    assert link.kind == AssignmentKind.DRIVER


def test_pto_user_is_refused_with_the_role_message(setup):
    vehicle, _unit, mto = setup
    with pytest.raises(BusinessRuleError) as error:
        services.assign_person(vehicle, PTOFactory(), mto)
    assert str(error.value.detail) == "Only officers and drivers can be linked to vehicles."


def test_end_assignment_sets_ended_fields_and_cannot_repeat(setup):
    vehicle, unit, mto = setup
    link = services.assign_person(vehicle, DriverFactory(unit=unit), mto)

    ended = services.end_assignment(link, mto)

    link.refresh_from_db()
    assert ended.ended_at is not None
    assert link.ended_at == ended.ended_at
    assert link.ended_by == mto
    assert list(services.current_links(vehicle)) == []
    with pytest.raises(BusinessRuleError) as error:
        services.end_assignment(link, mto)
    assert str(error.value.detail) == "This link has already ended."


def test_driver_can_be_linked_again_after_the_link_ends(setup):
    vehicle, unit, mto = setup
    other = VehicleFactory(unit=unit)
    driver = DriverFactory(unit=unit)
    services.end_assignment(services.assign_person(vehicle, driver, mto), mto)
    assert services.assign_person(other, driver, mto).vehicle == other


def test_end_all_for_person_returns_how_many_links_ended(setup):
    vehicle, unit, mto = setup
    other = VehicleFactory(unit=unit)
    officer = OfficerFactory(unit=unit)
    services.assign_person(vehicle, officer, mto)
    services.assign_person(other, officer, mto)
    ended_before = services.assign_person(VehicleFactory(unit=unit), officer, mto)
    services.end_assignment(ended_before, mto)

    assert services.end_all_for_person(officer, mto) == 2
    assert officer.vehicle_assignments.filter(ended_at__isnull=True).count() == 0
    assert services.end_all_for_person(officer, mto) == 0


def test_end_all_for_vehicle_ends_officer_and_driver_links(setup):
    vehicle, unit, mto = setup
    services.assign_person(vehicle, OfficerFactory(unit=unit), mto)
    services.assign_person(vehicle, DriverFactory(unit=unit), mto)
    assert services.end_all_for_vehicle(vehicle, mto) == 2
    assert list(services.current_links(vehicle)) == []
    assert vehicle.assignments.filter(ended_by=mto).count() == 2


def test_current_vehicle_for_driver_and_officer(setup):
    vehicle, unit, mto = setup
    driver = DriverFactory(unit=unit)
    officer = OfficerFactory(unit=unit)
    assert services.current_vehicle_for(driver) is None
    services.assign_person(vehicle, driver, mto)
    services.assign_person(vehicle, officer, mto)
    assert services.current_vehicle_for(driver) == vehicle
    assert services.current_vehicle_for(officer) == vehicle
    services.end_all_for_person(driver, mto)
    assert services.current_vehicle_for(driver) is None


def test_current_vehicle_for_officer_is_the_first_of_their_vehicles(setup):
    vehicle, unit, mto = setup
    other = VehicleFactory(unit=unit)
    officer = OfficerFactory(unit=unit)
    services.assign_person(vehicle, officer, mto)
    services.assign_person(other, officer, mto)
    # "First" = earliest current link.
    assert services.current_vehicle_for(officer) == vehicle
