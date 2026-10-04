import pytest
from django.db import IntegrityError, transaction

from accounts.models import UserStatus
from approvals import services
from approvals.models import ApprovalKind, ApprovalRequest, ApprovalStatus
from common.exceptions import BusinessRuleError
from fleet import services as fleet_services
from fleet.models import VehicleStatus
from notifications.models import Notification
from testing.factories import (
    DriverFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    VehicleFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def pto():
    return PTOFactory()


@pytest.fixture
def pending_officer(mto):
    return OfficerFactory(unit=mto.unit, status=UserStatus.PENDING_APPROVAL, full_name="Ravi Kumar", emp_id="EMP7001")


def notes_for(user):
    return list(Notification.objects.filter(recipient=user))


# --- new officers -------------------------------------------------------------------------------


def test_requesting_officer_approval_creates_a_pending_row_and_alerts_the_ptos(mto, pto, pending_officer):
    other_pto = PTOFactory()
    paused_pto = PTOFactory(status=UserStatus.PAUSED)

    approval = services.request_officer_approval(pending_officer, mto, note="Joined this week")

    assert approval.kind == ApprovalKind.OFFICER_CREATE
    assert approval.status == ApprovalStatus.PENDING
    assert approval.officer == pending_officer
    assert approval.vehicle is None
    assert approval.unit == mto.unit
    assert approval.requested_by == mto
    assert approval.request_note == "Joined this week"
    assert approval.decided_by is None and approval.decided_at is None

    for recipient in (pto, other_pto):
        (note,) = notes_for(recipient)
        assert note.title == "New officer waiting for approval"
        assert note.body == f"Ravi Kumar (EMP7001) — {mto.unit.name}"
        assert note.link == "/pto/approvals"
    assert notes_for(paused_pto) == []
    assert notes_for(mto) == []


def test_approving_an_officer_makes_them_active_and_able_to_log_in(mto, pto, pending_officer):
    approval = services.request_officer_approval(pending_officer, mto)
    pending_officer.refresh_from_db()
    assert pending_officer.is_active is False

    result = services.decide(approval, pto, approve=True, note="Verified")

    pending_officer.refresh_from_db()
    assert pending_officer.status == UserStatus.ACTIVE
    assert pending_officer.is_active is True
    assert result.status == ApprovalStatus.APPROVED
    assert result.decided_by == pto
    assert result.decided_at is not None
    assert result.decision_note == "Verified"
    approval.refresh_from_db()
    assert approval.status == ApprovalStatus.APPROVED


def test_rejecting_an_officer_marks_them_rejected(mto, pto, pending_officer):
    approval = services.request_officer_approval(pending_officer, mto)

    result = services.decide(approval, pto, approve=False, note="Emp ID does not match")

    pending_officer.refresh_from_db()
    assert pending_officer.status == UserStatus.REJECTED
    assert pending_officer.is_active is False
    assert result.status == ApprovalStatus.REJECTED
    assert result.decision_note == "Emp ID does not match"


def test_the_mto_is_alerted_when_an_officer_is_approved_or_rejected(mto, pto, pending_officer):
    other_mto = MTOFactory()
    approved = services.request_officer_approval(pending_officer, mto)
    services.decide(approved, pto, approve=True, note="Verified")
    rejected_officer = OfficerFactory(
        unit=mto.unit, status=UserStatus.PENDING_APPROVAL, full_name="Sita Devi", emp_id="EMP7002"
    )
    rejected = services.request_officer_approval(rejected_officer, mto)
    services.decide(rejected, pto, approve=False, note="Wrong cadre")

    first, second = sorted(notes_for(mto), key=lambda n: n.id)
    assert (first.title, first.body, first.link) == (
        "Officer approved", "Ravi Kumar (EMP7001): Verified", "/mto/officers"
    )
    assert (second.title, second.body, second.link) == (
        "Officer rejected", "Sita Devi (EMP7002): Wrong cadre", "/mto/officers"
    )
    assert notes_for(other_mto) == []
    assert [n.title for n in notes_for(pto)] == ["New officer waiting for approval"] * 2  # nothing for the decisions


def test_an_officer_decision_without_a_note_alerts_with_just_the_name(mto, pto, pending_officer):
    services.decide(services.request_officer_approval(pending_officer, mto), pto, approve=True)
    (note,) = notes_for(mto)
    assert note.body == "Ravi Kumar (EMP7001)"


def test_one_pending_request_per_officer_is_enforced_by_the_database(mto, pending_officer):
    services.request_officer_approval(pending_officer, mto)
    with pytest.raises(IntegrityError), transaction.atomic():
        services.request_officer_approval(pending_officer, mto)


# --- vehicle termination ------------------------------------------------------------------------


def test_termination_request_parks_the_vehicle_and_alerts_the_ptos(mto, pto):
    vehicle = VehicleFactory(unit=mto.unit, registration_number="AP39PA1234")

    approval = services.request_vehicle_termination(vehicle, mto, "Accident write-off")

    vehicle.refresh_from_db()
    assert vehicle.status == VehicleStatus.TERMINATION_PENDING
    assert approval.kind == ApprovalKind.VEHICLE_TERMINATE
    assert approval.status == ApprovalStatus.PENDING
    assert approval.vehicle == vehicle
    assert approval.officer is None
    assert approval.unit == mto.unit
    assert approval.previous_status == VehicleStatus.ACTIVE
    assert approval.request_note == "Accident write-off"
    assert approval.requested_by == mto
    (note,) = notes_for(pto)
    assert note.title == "Vehicle termination waiting for approval"
    assert note.body == f"AP39PA1234 — {mto.unit.name}: Accident write-off"
    assert note.link == "/pto/approvals"


def test_the_in_memory_vehicle_reflects_the_new_status(mto, pto):
    vehicle = VehicleFactory(unit=mto.unit)
    services.request_vehicle_termination(vehicle, mto, "Beyond repair")
    assert vehicle.status == VehicleStatus.TERMINATION_PENDING


def test_approving_a_termination_ends_every_link_and_terminates_the_vehicle(mto, pto):
    vehicle = VehicleFactory(unit=mto.unit)
    officer_link = fleet_services.assign_person(vehicle, OfficerFactory(unit=mto.unit), mto)
    driver_link = fleet_services.assign_person(vehicle, DriverFactory(unit=mto.unit), mto)
    approval = services.request_vehicle_termination(vehicle, mto, "Beyond repair")

    result = services.decide(approval, pto, approve=True, note="Auction ordered")

    vehicle.refresh_from_db()
    assert vehicle.status == VehicleStatus.TERMINATED
    assert result.status == ApprovalStatus.APPROVED
    assert result.decided_by == pto
    assert result.decision_note == "Auction ordered"
    for link in (officer_link, driver_link):
        link.refresh_from_db()
        assert link.ended_at is not None
        assert link.ended_by == pto
    assert list(fleet_services.current_links(vehicle)) == []


@pytest.mark.parametrize("previous", [VehicleStatus.ACTIVE, VehicleStatus.PAUSED])
def test_rejecting_a_termination_puts_the_vehicle_back_as_it_was(mto, pto, previous):
    vehicle = VehicleFactory(unit=mto.unit, status=previous)
    link = fleet_services.assign_person(vehicle, DriverFactory(unit=mto.unit), mto)
    approval = services.request_vehicle_termination(vehicle, mto, "Beyond repair")

    result = services.decide(approval, pto, approve=False, note="Repairable")

    vehicle.refresh_from_db()
    assert vehicle.status == previous
    assert result.status == ApprovalStatus.REJECTED
    link.refresh_from_db()
    assert link.ended_at is None


def test_the_mto_is_alerted_when_a_termination_is_decided(mto, pto):
    other_mto = MTOFactory()
    first = VehicleFactory(unit=mto.unit, registration_number="AP39PA1111")
    second = VehicleFactory(unit=mto.unit, registration_number="AP39PA2222")
    services.decide(services.request_vehicle_termination(first, mto, "Old"), pto, approve=True, note="Go ahead")
    services.decide(services.request_vehicle_termination(second, mto, "Old"), pto, approve=False, note="Keep it")

    approved, rejected = sorted(notes_for(mto), key=lambda n: n.id)
    assert approved.title == "Vehicle termination approved"
    assert approved.body == "AP39PA1111: Go ahead"
    assert approved.link == f"/mto/vehicles/{first.id}"
    assert rejected.title == "Vehicle termination rejected"
    assert rejected.body == "AP39PA2222: Keep it"
    assert rejected.link == f"/mto/vehicles/{second.id}"
    assert notes_for(other_mto) == []


@pytest.mark.parametrize("status", [VehicleStatus.TERMINATION_PENDING, VehicleStatus.TERMINATED])
def test_only_active_or_paused_vehicles_can_be_sent_for_termination(mto, pto, status):
    vehicle = VehicleFactory(unit=mto.unit, status=status)
    with pytest.raises(BusinessRuleError) as error:
        services.request_vehicle_termination(vehicle, mto, "Again")
    assert str(error.value.detail) == "Only active or paused vehicles can be sent for termination."
    assert ApprovalRequest.objects.count() == 0
    assert notes_for(pto) == []


def test_a_vehicle_cannot_be_sent_twice(mto, pto):
    vehicle = VehicleFactory(unit=mto.unit)
    services.request_vehicle_termination(vehicle, mto, "First")
    with pytest.raises(BusinessRuleError, match="Only active or paused vehicles"):
        services.request_vehicle_termination(vehicle, mto, "Second")
    assert ApprovalRequest.objects.filter(vehicle=vehicle).count() == 1


# --- deciding twice -----------------------------------------------------------------------------


def test_deciding_twice_is_refused_and_applies_nothing_again(mto, pto):
    vehicle = VehicleFactory(unit=mto.unit, status=VehicleStatus.PAUSED)
    approval = services.request_vehicle_termination(vehicle, mto, "Beyond repair")
    services.decide(approval, pto, approve=True, note="Approved")
    other_pto = PTOFactory()
    alerts_before = Notification.objects.count()

    # `approval` is a stale in-memory copy: the decision is re-checked under a lock.
    with pytest.raises(BusinessRuleError) as error:
        services.decide(approval, other_pto, approve=False, note="Changed my mind")

    assert str(error.value.detail) == "This request has already been decided."
    vehicle.refresh_from_db()
    assert vehicle.status == VehicleStatus.TERMINATED
    approval.refresh_from_db()
    assert approval.status == ApprovalStatus.APPROVED
    assert approval.decided_by == pto
    assert approval.decision_note == "Approved"
    assert Notification.objects.count() == alerts_before


def test_deciding_an_already_rejected_officer_request_does_not_activate_them(mto, pto, pending_officer):
    approval = services.request_officer_approval(pending_officer, mto)
    services.decide(approval, pto, approve=False, note="No")
    with pytest.raises(BusinessRuleError, match="already been decided"):
        services.decide(approval, pto, approve=True)
    pending_officer.refresh_from_db()
    assert pending_officer.status == UserStatus.REJECTED
