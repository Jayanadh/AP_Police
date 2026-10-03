import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from accounts import transfers
from accounts.models import OfficerTransfer, TransferStatus, User, UserStatus
from common.exceptions import BusinessRuleError
from fleet import services as fleet_services
from fleet.models import AssignmentKind
from notifications.models import Notification
from testing.factories import (
    DriverFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    UnitFactory,
    VehicleFactory,
)

pytestmark = pytest.mark.django_db

LOOKUP_URL = "/api/officers/lookup/"
TRANSFERS_URL = "/api/transfers/"
NOT_FOUND = {"detail": "No officer with this Emp ID in another MTO office."}
CLOSED = {"detail": "This transfer has already been closed."}
NOT_OLD_OFFICE = {"detail": "Only the officer's current MTO office can accept or reject this transfer."}
NOT_SENDER = {"detail": "Only the MTO office that sent this request can cancel it."}


def client_for(user):
    client = APIClient()
    client.force_login(user)
    return client


@pytest.fixture
def old_mto():
    return MTOFactory(full_name="Sri Old Chair")


@pytest.fixture
def new_mto():
    return MTOFactory(full_name="Sri New Chair")


@pytest.fixture
def officer(old_mto):
    return OfficerFactory(unit=old_mto.unit, full_name="Insp. K. Rao", emp_id="AP7001")


@pytest.fixture
def old_api(old_mto):
    return client_for(old_mto)


@pytest.fixture
def new_api(new_mto):
    return client_for(new_mto)


@pytest.fixture
def pending(new_mto, officer):
    """A transfer the new office has asked for and the old office has not yet decided."""
    return transfers.request_transfer(officer, new_mto.unit, new_mto, note="Posted to our range")


def action_url(transfer, name):
    return f"{TRANSFERS_URL}{transfer.id}/{name}/"


# --- looking an officer up by Emp ID -------------------------------------------------------


def test_lookup_finds_an_officer_of_another_unit(new_api, officer, old_mto):
    response = new_api.get(LOOKUP_URL, {"emp_id": "AP7001"})
    assert response.status_code == 200
    assert response.json() == {
        "id": officer.id,
        "full_name": "Insp. K. Rao",
        "emp_id": "AP7001",
        "designation_name": "Inspector of Police",
        "unit": old_mto.unit.id,
        "unit_name": old_mto.unit.name,
    }


def test_lookup_ignores_case_and_surrounding_spaces(new_api, officer):
    response = new_api.get(LOOKUP_URL, {"emp_id": "  ap7001 "})
    assert response.status_code == 200
    assert response.json()["id"] == officer.id


def test_lookup_finds_a_paused_officer(new_api, officer):
    officer.status = UserStatus.PAUSED
    officer.save(update_fields=["status"])
    assert new_api.get(LOOKUP_URL, {"emp_id": "AP7001"}).status_code == 200


def test_lookup_of_an_officer_in_the_callers_own_unit_is_not_found(old_api, officer):
    response = old_api.get(LOOKUP_URL, {"emp_id": "AP7001"})
    assert response.status_code == 404
    assert response.json() == NOT_FOUND


@pytest.mark.parametrize("params", [{"emp_id": "AP9999"}, {"emp_id": "AP700"}, {"emp_id": ""}, {}])
def test_lookup_needs_an_exact_emp_id(new_api, officer, params):
    response = new_api.get(LOOKUP_URL, params)
    assert response.status_code == 404
    assert response.json() == NOT_FOUND


@pytest.mark.parametrize(
    "status", [UserStatus.TERMINATED, UserStatus.PENDING_APPROVAL, UserStatus.REJECTED]
)
def test_lookup_skips_officers_who_cannot_be_transferred(new_api, officer, status):
    officer.status = status
    officer.save(update_fields=["status"])
    assert new_api.get(LOOKUP_URL, {"emp_id": "AP7001"}).status_code == 404


def test_lookup_skips_a_driver_with_that_emp_id(new_api, old_mto):
    DriverFactory(unit=old_mto.unit, emp_id="AP7002")
    assert new_api.get(LOOKUP_URL, {"emp_id": "AP7002"}).status_code == 404


def test_only_an_mto_may_look_officers_up(officer):
    assert client_for(OfficerFactory()).get(LOOKUP_URL, {"emp_id": "AP7001"}).status_code == 403
    assert client_for(PTOFactory()).get(LOOKUP_URL, {"emp_id": "AP7001"}).status_code == 403
    assert APIClient().get(LOOKUP_URL, {"emp_id": "AP7001"}).status_code in (401, 403)


# --- the new office asks for an officer -----------------------------------------------------


def test_the_new_mto_requests_an_officer_and_the_old_mto_is_alerted(new_api, new_mto, old_mto, officer):
    response = new_api.post(TRANSFERS_URL, {"officer": officer.id, "note": "Posted to our range"})

    assert response.status_code == 201
    body = response.json()
    assert body == {
        "id": body["id"],
        "officer": officer.id,
        "officer_name": "Insp. K. Rao",
        "officer_emp_id": "AP7001",
        "from_unit": old_mto.unit.id,
        "from_unit_name": old_mto.unit.name,
        "to_unit": new_mto.unit.id,
        "to_unit_name": new_mto.unit.name,
        "note": "Posted to our range",
        "status": "PENDING",
        "requested_at": body["requested_at"],
        "decided_at": None,
    }
    transfer = OfficerTransfer.objects.get(pk=body["id"])
    assert transfer.from_unit == old_mto.unit
    assert transfer.to_unit == new_mto.unit
    assert transfer.requested_by == new_mto
    assert transfer.decided_by is None

    officer.refresh_from_db()
    assert officer.unit == old_mto.unit  # nothing moves until the old office accepts

    alert = Notification.objects.get(recipient=old_mto)
    assert alert.title == "Transfer request for Insp. K. Rao"
    assert alert.body == f"{new_mto.unit.name} asks for Insp. K. Rao (AP7001)."
    assert alert.link == "/mto/transfers"
    assert not Notification.objects.filter(recipient=new_mto).exists()


def test_the_note_is_optional(new_api, officer):
    response = new_api.post(TRANSFERS_URL, {"officer": officer.id})
    assert response.status_code == 201
    assert response.json()["note"] == ""


def test_a_paused_officer_can_be_requested(new_api, officer):
    officer.status = UserStatus.PAUSED
    officer.save(update_fields=["status"])
    assert new_api.post(TRANSFERS_URL, {"officer": officer.id}).status_code == 201


def test_requesting_an_officer_already_in_the_callers_unit_is_refused(old_api, officer):
    response = old_api.post(TRANSFERS_URL, {"officer": officer.id})
    assert response.status_code == 400
    assert response.json() == {"detail": "This officer is already in your MTO office."}
    assert not OfficerTransfer.objects.exists()


def test_a_second_pending_request_for_the_same_officer_is_refused(new_api, officer, pending):
    response = new_api.post(TRANSFERS_URL, {"officer": officer.id})
    assert response.status_code == 400
    assert response.json() == {"detail": "This officer already has a pending transfer."}
    assert OfficerTransfer.objects.count() == 1


def test_another_office_cannot_request_an_officer_who_already_has_a_pending_transfer(officer, pending):
    other_api = client_for(MTOFactory())
    response = other_api.post(TRANSFERS_URL, {"officer": officer.id})
    assert response.status_code == 400
    assert response.json() == {"detail": "This officer already has a pending transfer."}


@pytest.mark.parametrize(
    "status", [UserStatus.TERMINATED, UserStatus.PENDING_APPROVAL, UserStatus.REJECTED]
)
def test_an_officer_who_is_not_active_or_paused_cannot_be_requested(new_api, officer, status):
    officer.status = status
    officer.save(update_fields=["status"])
    response = new_api.post(TRANSFERS_URL, {"officer": officer.id})
    assert response.status_code == 400
    assert response.json() == {"detail": "Only active or paused officers can be transferred."}
    assert not OfficerTransfer.objects.exists()


def test_only_officers_can_be_requested(new_api, old_mto):
    driver = DriverFactory(unit=old_mto.unit)
    assert new_api.post(TRANSFERS_URL, {"officer": driver.id}).status_code == 400
    assert new_api.post(TRANSFERS_URL, {"officer": 999999}).status_code == 400
    assert new_api.post(TRANSFERS_URL, {}).status_code == 400
    assert not OfficerTransfer.objects.exists()


def test_a_closed_request_does_not_block_a_new_one(new_api, old_api, officer, pending):
    old_api.post(action_url(pending, "reject"))
    assert new_api.post(TRANSFERS_URL, {"officer": officer.id}).status_code == 201
    assert OfficerTransfer.objects.filter(officer=officer, status=TransferStatus.PENDING).count() == 1


def test_the_database_allows_one_pending_transfer_per_officer(new_mto, officer, pending):
    with pytest.raises(IntegrityError), transaction.atomic():
        OfficerTransfer.objects.create(
            officer=officer, from_unit=officer.unit, to_unit=new_mto.unit, requested_by=new_mto
        )


def test_only_an_mto_may_use_the_transfer_endpoints(officer, pending):
    for user in (OfficerFactory(), PTOFactory()):
        client = client_for(user)
        assert client.get(TRANSFERS_URL).status_code == 403
        assert client.post(TRANSFERS_URL, {"officer": officer.id}).status_code == 403
        assert client.post(action_url(pending, "accept")).status_code == 403


# --- listing -------------------------------------------------------------------------------


def test_the_old_mto_sees_it_under_outgoing_and_the_new_mto_under_incoming(old_api, new_api, pending):
    assert [row["id"] for row in old_api.get(TRANSFERS_URL, {"direction": "outgoing"}).json()] == [pending.id]
    assert old_api.get(TRANSFERS_URL, {"direction": "incoming"}).json() == []
    assert [row["id"] for row in new_api.get(TRANSFERS_URL, {"direction": "incoming"}).json()] == [pending.id]
    assert new_api.get(TRANSFERS_URL, {"direction": "outgoing"}).json() == []


def test_without_a_direction_both_offices_see_their_transfers_newest_first(
    old_api, new_api, old_mto, new_mto, officer, pending
):
    coming_in = OfficerFactory(unit=UnitFactory())
    newer = transfers.request_transfer(coming_in, old_mto.unit, old_mto)

    assert [row["id"] for row in old_api.get(TRANSFERS_URL).json()] == [newer.id, pending.id]
    assert [row["id"] for row in new_api.get(TRANSFERS_URL).json()] == [pending.id]
    assert [row["id"] for row in old_api.get(TRANSFERS_URL, {"direction": "incoming"}).json()] == [newer.id]


def test_a_third_office_sees_nothing_and_cannot_act(pending):
    third_api = client_for(MTOFactory())
    assert third_api.get(TRANSFERS_URL).json() == []
    assert third_api.get(TRANSFERS_URL, {"direction": "incoming"}).json() == []
    assert third_api.get(TRANSFERS_URL, {"direction": "outgoing"}).json() == []
    for name in ("accept", "reject", "cancel"):
        assert third_api.post(action_url(pending, name)).status_code == 404
    pending.refresh_from_db()
    assert pending.status == TransferStatus.PENDING


# --- the old office decides -----------------------------------------------------------------


def test_the_new_mto_cannot_accept_or_reject(new_api, officer, pending):
    for name in ("accept", "reject"):
        response = new_api.post(action_url(pending, name))
        assert response.status_code == 400
        assert response.json() == NOT_OLD_OFFICE
    pending.refresh_from_db()
    officer.refresh_from_db()
    assert pending.status == TransferStatus.PENDING
    assert officer.unit == pending.from_unit


def test_the_old_mto_accepts_and_the_officer_moves(old_api, old_mto, new_mto, officer, pending):
    first_vehicle = VehicleFactory(unit=old_mto.unit)
    second_vehicle = VehicleFactory(unit=old_mto.unit)
    driver = DriverFactory(unit=old_mto.unit)
    for vehicle in (first_vehicle, second_vehicle):
        fleet_services.assign_person(vehicle, officer, assigned_by=old_mto)
    fleet_services.assign_person(first_vehicle, driver, assigned_by=old_mto)

    response = old_api.post(action_url(pending, "accept"))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == pending.id
    assert body["status"] == "ACCEPTED"
    assert body["decided_at"] is not None

    officer.refresh_from_db()
    assert officer.unit == new_mto.unit
    assert officer.status == UserStatus.ACTIVE
    assert not officer.vehicle_assignments.filter(ended_at__isnull=True).exists()
    for link in officer.vehicle_assignments.all():
        assert link.ended_by == old_mto  # the links are kept as history

    # the vehicle keeps its driver
    driver_link = driver.vehicle_assignments.get()
    assert driver_link.ended_at is None
    assert driver_link.kind == AssignmentKind.DRIVER
    assert driver_link.vehicle == first_vehicle

    pending.refresh_from_db()
    assert pending.status == TransferStatus.ACCEPTED
    assert pending.decided_by == old_mto
    assert pending.decided_at is not None

    alert = Notification.objects.get(recipient=new_mto)
    assert alert.title == "Transfer accepted"
    assert alert.link == "/mto/transfers"
    assert not Notification.objects.filter(recipient=old_mto, title="Transfer accepted").exists()


def test_an_accepted_officer_belongs_to_the_new_office(old_api, new_api, officer, pending):
    old_api.post(action_url(pending, "accept"))
    assert [row["id"] for row in new_api.get("/api/officers/").json()] == [officer.id]
    assert old_api.get("/api/officers/").json() == []
    assert old_api.get(f"/api/officers/{officer.id}/").status_code == 404


def test_a_paused_officer_moves_and_stays_paused(old_api, new_mto, officer, pending):
    officer.status = UserStatus.PAUSED
    officer.save(update_fields=["status"])
    assert old_api.post(action_url(pending, "accept")).status_code == 200
    officer.refresh_from_db()
    assert officer.unit == new_mto.unit
    assert officer.status == UserStatus.PAUSED


def test_an_officer_who_was_terminated_meanwhile_cannot_be_moved(old_api, old_mto, officer, pending):
    officer.status = UserStatus.TERMINATED
    officer.save(update_fields=["status"])
    response = old_api.post(action_url(pending, "accept"))
    assert response.status_code == 400
    assert response.json() == {"detail": "Only active or paused officers can be transferred."}
    officer.refresh_from_db()
    pending.refresh_from_db()
    assert officer.unit == old_mto.unit
    assert pending.status == TransferStatus.PENDING
    # the old office can still turn the request down
    assert old_api.post(action_url(pending, "reject")).status_code == 200


def test_the_old_mto_rejects_and_the_officer_stays_put(old_api, old_mto, new_mto, officer, pending):
    vehicle = VehicleFactory(unit=old_mto.unit)
    link = fleet_services.assign_person(vehicle, officer, assigned_by=old_mto)

    response = old_api.post(action_url(pending, "reject"))

    assert response.status_code == 200
    assert response.json()["status"] == "REJECTED"
    officer.refresh_from_db()
    link.refresh_from_db()
    pending.refresh_from_db()
    assert officer.unit == old_mto.unit
    assert link.ended_at is None
    assert pending.status == TransferStatus.REJECTED
    assert pending.decided_by == old_mto
    assert pending.decided_at is not None

    alert = Notification.objects.get(recipient=new_mto)
    assert alert.title == "Transfer rejected"
    assert alert.link == "/mto/transfers"


# --- the new office takes its request back --------------------------------------------------


def test_the_new_mto_cancels_its_request(new_api, old_mto, new_mto, officer, pending):
    response = new_api.post(action_url(pending, "cancel"))

    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"
    officer.refresh_from_db()
    pending.refresh_from_db()
    assert officer.unit == old_mto.unit
    assert pending.status == TransferStatus.CANCELLED
    assert pending.decided_by == new_mto
    assert pending.decided_at is not None
    assert not Notification.objects.filter(title__in=["Transfer accepted", "Transfer rejected"]).exists()


def test_the_old_mto_cannot_cancel(old_api, pending):
    response = old_api.post(action_url(pending, "cancel"))
    assert response.status_code == 400
    assert response.json() == NOT_SENDER
    pending.refresh_from_db()
    assert pending.status == TransferStatus.PENDING


# --- a closed transfer stays closed ---------------------------------------------------------


@pytest.mark.parametrize("first", ["accept", "reject", "cancel"])
@pytest.mark.parametrize("second", ["accept", "reject", "cancel"])
def test_a_closed_transfer_cannot_be_decided_again(old_api, new_api, officer, pending, first, second):
    clients = {"accept": old_api, "reject": old_api, "cancel": new_api}
    assert clients[first].post(action_url(pending, first)).status_code == 200
    unit_after_first = User.objects.get(pk=officer.pk).unit_id

    response = clients[second].post(action_url(pending, second))

    assert response.status_code == 400
    assert response.json() == CLOSED
    assert User.objects.get(pk=officer.pk).unit_id == unit_after_first


def test_accepting_a_closed_transfer_is_refused_even_from_a_stale_copy(old_mto, pending):
    stale = OfficerTransfer.objects.get(pk=pending.pk)
    transfers.accept_transfer(pending, old_mto)
    with pytest.raises(BusinessRuleError, match="already been closed"):
        transfers.accept_transfer(stale, old_mto)


def test_close_transfer_only_rejects_or_cancels(old_mto, pending):
    with pytest.raises(ValueError):
        transfers.close_transfer(pending, old_mto, TransferStatus.ACCEPTED)
    pending.refresh_from_db()
    assert pending.status == TransferStatus.PENDING


def test_a_moved_officer_can_be_requested_back(old_api, new_api, old_mto, officer, pending):
    old_api.post(action_url(pending, "accept"))
    response = old_api.post(TRANSFERS_URL, {"officer": officer.id})
    assert response.status_code == 201
    assert response.json()["from_unit"] == pending.to_unit_id
    assert response.json()["to_unit"] == old_mto.unit.id
