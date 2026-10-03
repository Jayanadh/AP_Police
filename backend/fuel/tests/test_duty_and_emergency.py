from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from common.exceptions import BusinessRuleError
from fleet import services
from fuel import requests
from fuel.models import EmergencyStatus, FuelRequest, RequestStatus
from fuel.requests import duty_overdue
from fuel.serializers import FuelRequestSerializer
from notifications.models import Notification
from testing.factories import (
    DriverFactory,
    FuelGrantFactory,
    FuelRequestFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    PumpStaffFactory,
    UnitFactory,
    VehicleFactory,
    filled_request,
    unit_mto,
)

pytestmark = pytest.mark.django_db

URL = "/api/fuel/requests/"
NOT_FILLED = "Duty particulars can be entered only after the fuel is filled."
ALREADY_SUBMITTED = "Duty particulars were already submitted."
BLANK = "Enter the duty particulars."
ALREADY_REVIEWED = "This emergency fill has already been reviewed."


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(
        unit=mto.unit,
        registration_number="AP39PA1234",
        tank_capacity_litres=Decimal("60"),
        monthly_fuel_limit_litres=Decimal("100"),
    )


@pytest.fixture
def driver(mto, vehicle):
    person = DriverFactory(unit=mto.unit, full_name="Ravi Kumar")
    services.assign_person(vehicle, person, mto)
    return person


@pytest.fixture
def officer(mto, vehicle):
    person = OfficerFactory(unit=mto.unit)
    services.assign_person(vehicle, person, mto)
    return person


@pytest.fixture
def filled(vehicle, driver):
    """A normal fill the driver has not yet written duty particulars for."""
    return filled_request(vehicle, Decimal("10"), timezone.now() - timedelta(hours=3), driver=driver)


@pytest.fixture
def emergency(vehicle, driver):
    """The month's limit used up, then an emergency fill of 5 L that waits for the MTO.

    Fill times are anchored inside the current month to ensure quota assertions work
    even when this fixture runs between 00:00 and 05:00 IST on the 1st of a month.
    """
    from common.months import month_bounds, current_month

    now = timezone.now()
    month_start_dt, _ = month_bounds(current_month())

    # First fill: anchor it at least 5 hours before now, but inside current month
    base = max(now - timedelta(hours=5), month_start_dt + timedelta(minutes=1))
    first_fill_time = base

    # Emergency fill: strictly after first fill and not in the future
    emergency_fill_time = min(first_fill_time + timedelta(hours=4), now)

    filled_request(vehicle, Decimal("100"), first_fill_time)
    return filled_request(
        vehicle, Decimal("5"), emergency_fill_time, driver=driver, emergency_litres=Decimal("5")
    )


def duty_url(request_id):
    return f"{URL}{request_id}/duty/"


def allow_url(request_id):
    return f"{URL}{request_id}/allow-emergency/"


def submit(api, request_id, text="Escort duty to Kavali"):
    return api.post(duty_url(request_id), {"duty_particulars": text})


def ids(response):
    return {row["id"] for row in response.json()}


def refusal_of(call, *args) -> str:
    with pytest.raises(BusinessRuleError) as error:
        call(*args)
    return str(error.value.detail)


# --- duty particulars --------------------------------------------------------------------------


def test_the_driver_submits_duty_particulars_for_a_filled_request(api, driver, filled):
    api.force_login(driver)
    before = timezone.now()

    response = submit(api, filled.id, "Escort duty to Kavali")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == filled.id
    assert body["duty_particulars"] == "Escort duty to Kavali"
    assert before <= parse_datetime(body["duty_submitted_at"]) <= timezone.now()
    assert body["duty_overdue"] is False
    assert body["status"] == "FILLED"
    filled.refresh_from_db()
    assert filled.duty_particulars == "Escort duty to Kavali"
    assert before <= filled.duty_submitted_at <= timezone.now()


def test_the_particulars_are_trimmed(api, driver, filled):
    api.force_login(driver)

    response = submit(api, filled.id, "  Night patrol, Nellore \n")

    assert response.status_code == 200
    assert response.json()["duty_particulars"] == "Night patrol, Nellore"
    filled.refresh_from_db()
    assert filled.duty_particulars == "Night patrol, Nellore"


def test_late_particulars_are_accepted_and_then_no_longer_overdue(api, vehicle, driver):
    late = filled_request(vehicle, Decimal("10"), timezone.now() - timedelta(hours=60), driver=driver)
    api.force_login(driver)
    assert api.get(URL).json()[0]["duty_overdue"] is True

    response = submit(api, late.id)

    assert response.status_code == 200
    assert response.json()["duty_overdue"] is False
    late.refresh_from_db()
    assert late.duty_submitted_at is not None


def test_submitting_twice_is_refused_and_keeps_the_first_text(api, driver, filled):
    api.force_login(driver)
    assert submit(api, filled.id, "First").status_code == 200
    first_at = FuelRequest.objects.get(pk=filled.pk).duty_submitted_at

    response = submit(api, filled.id, "Second")

    assert response.status_code == 400
    assert response.json() == {"detail": ALREADY_SUBMITTED}
    filled.refresh_from_db()
    assert filled.duty_particulars == "First"
    assert filled.duty_submitted_at == first_at


@pytest.mark.parametrize("state", [RequestStatus.ISSUED, RequestStatus.CANCELLED, RequestStatus.EXPIRED])
def test_particulars_before_the_fuel_is_filled_are_refused(api, vehicle, driver, state):
    unfilled = FuelRequestFactory(vehicle=vehicle, driver=driver, status=state)
    api.force_login(driver)

    response = submit(api, unfilled.id)

    assert response.status_code == 400
    assert response.json() == {"detail": NOT_FILLED}
    unfilled.refresh_from_db()
    assert unfilled.duty_particulars == ""
    assert unfilled.duty_submitted_at is None


@pytest.mark.parametrize("body", [{"duty_particulars": ""}, {"duty_particulars": "  \n "}, {}])
def test_blank_particulars_are_refused(api, driver, filled, body):
    api.force_login(driver)

    response = api.post(duty_url(filled.id), body)

    assert response.status_code == 400
    assert response.json() == {"detail": BLANK}
    filled.refresh_from_db()
    assert filled.duty_particulars == ""
    assert filled.duty_submitted_at is None


def test_particulars_that_are_not_text_are_refused(api, driver, filled):
    api.force_login(driver)

    response = api.post(duty_url(filled.id), {"duty_particulars": ["a", "b"]}, format="json")

    assert response.status_code == 400
    assert set(response.json()) == {"duty_particulars"}
    filled.refresh_from_db()
    assert filled.duty_submitted_at is None


def test_the_blank_message_is_not_given_for_a_request_that_is_not_filled(api, vehicle, driver):
    unfilled = FuelRequestFactory(vehicle=vehicle, driver=driver)
    api.force_login(driver)

    assert api.post(duty_url(unfilled.id), {"duty_particulars": ""}).json() == {"detail": NOT_FILLED}


def test_another_driver_cannot_submit_particulars(api, mto, filled):
    api.force_login(DriverFactory(unit=mto.unit))

    response = submit(api, filled.id)

    assert response.status_code == 404
    filled.refresh_from_db()
    assert filled.duty_submitted_at is None


@pytest.mark.parametrize(
    "person",
    [
        lambda unit: OfficerFactory(unit=unit),
        lambda unit: unit_mto(unit),
        lambda unit: PumpStaffFactory(unit=unit),
        lambda unit: PTOFactory(),
    ],
    ids=["officer", "mto", "pump-operator", "pto"],
)
def test_other_roles_cannot_submit_a_drivers_particulars(api, vehicle, filled, person):
    api.force_login(person(vehicle.unit))

    assert submit(api, filled.id).status_code == 404
    filled.refresh_from_db()
    assert filled.duty_submitted_at is None


def test_particulars_need_a_signed_in_user(api, filled):
    assert submit(api, filled.id).status_code == 403


def test_particulars_for_a_request_that_does_not_exist_are_404(api, driver):
    api.force_login(driver)

    assert submit(api, 999999).status_code == 404


def test_the_duty_endpoint_is_post_only(api, driver, filled):
    api.force_login(driver)

    assert api.get(duty_url(filled.id)).status_code == 405


def test_the_officer_and_mto_then_see_the_particulars(api, mto, officer, driver, filled):
    api.force_login(driver)
    submit(api, filled.id, "Escort duty to Kavali")

    for person in (officer, mto):
        api.force_login(person)
        row = api.get(URL).json()[0]
        assert row["duty_particulars"] == "Escort duty to Kavali"
        assert row["duty_submitted_at"] is not None


def test_submit_duty_returns_the_request_with_the_particulars_set(driver, filled):
    returned = requests.submit_duty(filled, driver, "Escort duty")

    assert returned is filled
    assert (filled.duty_particulars, filled.duty_submitted_at is not None) == ("Escort duty", True)
    assert FuelRequest.objects.get(pk=filled.pk).duty_particulars == "Escort duty"


def test_submit_duty_refuses_anyone_but_the_driver_who_raised_the_request(mto, filled):
    other = DriverFactory(unit=mto.unit)

    message = refusal_of(requests.submit_duty, filled, other, "Escort duty")

    assert message == "Only the driver who raised a request can enter its duty particulars."
    assert FuelRequest.objects.get(pk=filled.pk).duty_submitted_at is None


def test_submit_duty_works_on_the_stored_request_not_a_stale_copy(driver, filled):
    stale = FuelRequest.objects.get(pk=filled.pk)
    requests.submit_duty(filled, driver, "First")

    assert refusal_of(requests.submit_duty, stale, driver, "Second") == ALREADY_SUBMITTED
    assert FuelRequest.objects.get(pk=filled.pk).duty_particulars == "First"


def test_submit_duty_locks_the_request_row(driver, filled):
    with CaptureQueriesContext(connection) as queries:
        requests.submit_duty(filled, driver, "Escort duty")

    assert any("FOR UPDATE" in query["sql"] for query in queries)


# --- allowing an emergency fill ----------------------------------------------------------------


def test_the_mto_allows_a_pending_emergency(api, mto, emergency):
    api.force_login(mto)
    before = timezone.now()

    response = api.post(allow_url(emergency.id))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == emergency.id
    assert body["emergency_status"] == "ALLOWED"
    assert body["emergency_status_label"] == "Allowed — counted against additional quota"
    assert body["emergency_litres"] == "5.00"
    assert body["pin"] is None
    emergency.refresh_from_db()
    assert emergency.emergency_status == EmergencyStatus.ALLOWED
    assert emergency.emergency_reviewed_by == mto
    assert before <= emergency.emergency_reviewed_at <= timezone.now()


def test_allowing_notifies_the_driver_and_the_current_officer(api, mto, officer, driver, emergency):
    api.force_login(mto)

    api.post(allow_url(emergency.id))

    to_driver = Notification.objects.get(recipient=driver)
    assert to_driver.title == "Emergency fill allowed"
    assert to_driver.body == "5.00 L counted against this month's additional quota."
    assert to_driver.link == "/driver/fuel"
    to_officer = Notification.objects.get(recipient=officer)
    assert to_officer.title == "Emergency fill allowed"
    assert to_officer.body == "5.00 L counted against this month's additional quota."
    assert to_officer.link == "/officer"
    assert Notification.objects.count() == 2


def test_a_vehicle_without_an_officer_just_notifies_the_driver(api, mto, driver, emergency):
    api.force_login(mto)

    assert api.post(allow_url(emergency.id)).status_code == 200

    assert [alert.recipient for alert in Notification.objects.all()] == [driver]


def test_the_officer_told_is_the_one_on_the_vehicle_now(api, mto, vehicle, officer, driver, emergency):
    services.end_assignment(officer.vehicle_assignments.get(ended_at__isnull=True), mto)
    new_officer = OfficerFactory(unit=mto.unit)
    services.assign_person(vehicle, new_officer, mto)
    api.force_login(mto)

    api.post(allow_url(emergency.id))

    assert {alert.recipient for alert in Notification.objects.all()} == {driver, new_officer}


def test_the_driver_who_raised_it_is_told_even_after_leaving_the_vehicle(api, mto, driver, emergency):
    services.end_assignment(driver.vehicle_assignments.get(ended_at__isnull=True), mto)
    api.force_login(mto)

    api.post(allow_url(emergency.id))

    assert Notification.objects.get(recipient=driver).title == "Emergency fill allowed"


def test_allowing_twice_is_refused_and_tells_nobody_again(api, mto, driver, emergency):
    api.force_login(mto)
    assert api.post(allow_url(emergency.id)).status_code == 200
    first_review = FuelRequest.objects.get(pk=emergency.pk).emergency_reviewed_at

    response = api.post(allow_url(emergency.id))

    assert response.status_code == 400
    assert response.json() == {"detail": ALREADY_REVIEWED}
    assert Notification.objects.filter(recipient=driver).count() == 1
    assert FuelRequest.objects.get(pk=emergency.pk).emergency_reviewed_at == first_review


def test_a_fill_that_was_not_an_emergency_cannot_be_allowed(api, mto, filled):
    api.force_login(mto)

    response = api.post(allow_url(filled.id))

    assert response.status_code == 400
    assert response.json() == {"detail": ALREADY_REVIEWED}
    filled.refresh_from_db()
    assert filled.emergency_status == EmergencyStatus.NONE
    assert filled.emergency_reviewed_by is None
    assert Notification.objects.count() == 0


def test_another_units_mto_cannot_allow_it(api, emergency):
    api.force_login(MTOFactory())

    response = api.post(allow_url(emergency.id))

    assert response.status_code == 404
    emergency.refresh_from_db()
    assert emergency.emergency_status == EmergencyStatus.PENDING
    assert emergency.emergency_reviewed_by is None
    assert Notification.objects.count() == 0


@pytest.mark.parametrize(
    "person",
    [
        lambda unit, driver: driver,
        lambda unit, driver: OfficerFactory(unit=unit),
        lambda unit, driver: PumpStaffFactory(unit=unit),
        lambda unit, driver: PTOFactory(),
    ],
    ids=["driver", "officer", "pump-operator", "pto"],
)
def test_only_the_mto_can_allow_an_emergency(api, vehicle, driver, emergency, person):
    api.force_login(person(vehicle.unit, driver))

    assert api.post(allow_url(emergency.id)).status_code == 403
    emergency.refresh_from_db()
    assert emergency.emergency_status == EmergencyStatus.PENDING
    assert Notification.objects.count() == 0


def test_allowing_needs_a_signed_in_user(api, emergency):
    assert api.post(allow_url(emergency.id)).status_code == 403


def test_allowing_a_request_that_does_not_exist_is_404(api, mto):
    api.force_login(mto)

    assert api.post(allow_url(999999)).status_code == 404


def test_the_allow_endpoint_is_post_only(api, mto, emergency):
    api.force_login(mto)

    assert api.get(allow_url(emergency.id)).status_code == 405


def test_allow_emergency_returns_the_request_allowed(mto, emergency):
    returned = requests.allow_emergency(emergency, mto)

    assert returned is emergency
    assert emergency.emergency_status == EmergencyStatus.ALLOWED
    assert emergency.emergency_reviewed_by == mto
    assert emergency.emergency_reviewed_at is not None
    assert FuelRequestSerializer(emergency).data["emergency_status_label"].startswith("Allowed")


def test_allow_emergency_refuses_a_user_who_is_not_the_mto_of_the_vehicles_office(mto, driver, emergency):
    for person in (MTOFactory(), PTOFactory(), driver):
        assert refusal_of(requests.allow_emergency, emergency, person) == (
            "Only the MTO of the vehicle's office can review an emergency fill."
        )
    emergency.refresh_from_db()
    assert emergency.emergency_status == EmergencyStatus.PENDING


def test_allow_emergency_works_on_the_stored_request_not_a_stale_copy(mto, emergency):
    stale = FuelRequest.objects.get(pk=emergency.pk)
    requests.allow_emergency(emergency, mto)

    assert refusal_of(requests.allow_emergency, stale, mto) == ALREADY_REVIEWED


def test_a_failure_while_telling_people_leaves_the_emergency_pending(mto, emergency, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("alerts are down")

    monkeypatch.setattr(requests, "notify", fail)

    with pytest.raises(RuntimeError):
        requests.allow_emergency(emergency, mto)

    stored = FuelRequest.objects.get(pk=emergency.pk)
    assert stored.emergency_status == EmergencyStatus.PENDING
    assert stored.emergency_reviewed_by is None


def test_allow_emergency_locks_the_request_row(mto, emergency):
    with CaptureQueriesContext(connection) as queries:
        requests.allow_emergency(emergency, mto)

    assert any("FOR UPDATE" in query["sql"] for query in queries)


def test_after_allowing_the_additional_balance_is_negative_when_the_month_had_no_grant(
    api, mto, vehicle, emergency
):
    api.force_login(mto)
    api.post(allow_url(emergency.id))

    quota = api.get(f"/api/fuel/vehicles/{vehicle.id}/quota/").json()

    assert quota["additional_litres"] == "0.00"
    assert quota["used_litres"] == "105.00"
    assert quota["emergency_used_litres"] == "5.00"
    assert quota["additional_balance_litres"] == "-5.00"


def test_after_allowing_the_emergency_litres_come_out_of_the_months_additional_quota(
    api, mto, vehicle, emergency
):
    FuelGrantFactory(vehicle=vehicle, litres=Decimal("30"))
    api.force_login(mto)
    api.post(allow_url(emergency.id))

    quota = api.get(f"/api/fuel/vehicles/{vehicle.id}/quota/").json()

    assert quota["additional_balance_litres"] == "25.00"


# --- the emergency filter ----------------------------------------------------------------------


def test_emergency_pending_lists_only_the_pending_ones(api, mto, vehicle, driver, emergency):
    allowed = filled_request(
        vehicle, Decimal("4"), timezone.now(), emergency_litres=Decimal("4"),
        emergency_status=EmergencyStatus.ALLOWED,
    )
    normal = filled_request(vehicle, Decimal("2"), timezone.now())
    open_request = FuelRequestFactory(vehicle=vehicle, driver=driver)
    api.force_login(mto)

    assert ids(api.get(URL, {"emergency": "pending"})) == {emergency.id}
    assert {emergency.id, allowed.id, normal.id, open_request.id} <= ids(api.get(URL))  # unfiltered, all of them


def test_emergency_allowed_lists_only_the_allowed_ones(api, mto, vehicle, emergency):
    allowed = filled_request(
        vehicle, Decimal("4"), timezone.now(), emergency_litres=Decimal("4"),
        emergency_status=EmergencyStatus.ALLOWED,
    )
    filled_request(vehicle, Decimal("2"), timezone.now())
    api.force_login(mto)

    assert ids(api.get(URL, {"emergency": "allowed"})) == {allowed.id}


def test_the_emergency_filter_covers_only_the_callers_own_scope(api, mto, vehicle, emergency):
    other_vehicle = VehicleFactory(unit=UnitFactory())
    elsewhere = filled_request(other_vehicle, Decimal("4"), timezone.now(), emergency_litres=Decimal("4"))
    api.force_login(mto)

    assert ids(api.get(URL, {"emergency": "pending"})) == {emergency.id}

    api.force_login(PTOFactory())
    assert ids(api.get(URL, {"emergency": "pending"})) == {emergency.id, elsewhere.id}


def test_an_allowed_emergency_moves_from_the_pending_list_to_the_allowed_list(api, mto, emergency):
    api.force_login(mto)
    assert ids(api.get(URL, {"emergency": "pending"})) == {emergency.id}

    api.post(allow_url(emergency.id))

    assert ids(api.get(URL, {"emergency": "pending"})) == set()
    assert ids(api.get(URL, {"emergency": "allowed"})) == {emergency.id}


def test_the_emergency_filter_works_for_the_driver_too(api, driver, emergency):
    filled_request(emergency.vehicle, Decimal("3"), timezone.now(), emergency_litres=Decimal("3"))  # another driver's
    api.force_login(driver)

    assert ids(api.get(URL, {"emergency": "pending"})) == {emergency.id}


def test_a_blank_emergency_filter_means_no_filter(api, mto, filled, emergency):
    api.force_login(mto)

    everything = ids(api.get(URL))

    assert {filled.id, emergency.id} <= everything
    assert ids(api.get(URL, {"emergency": ""})) == everything


@pytest.mark.parametrize("value", ["none", "PENDING", "yes", "reviewed"])
def test_an_unknown_emergency_filter_is_refused(api, mto, value):
    api.force_login(mto)

    response = api.get(URL, {"emergency": value})

    assert response.status_code == 400
    assert response.json() == {"detail": "Use emergency=pending or emergency=allowed."}


def test_overdue_duty_is_filled_requests_without_particulars_from_48_hours_after_the_fill(vehicle, driver):
    now = timezone.now()
    almost = filled_request(vehicle, Decimal("5"), now - timedelta(hours=47, minutes=59), driver=driver)
    exactly = filled_request(vehicle, Decimal("5"), now - timedelta(hours=48), driver=driver)
    late = filled_request(vehicle, Decimal("5"), now - timedelta(hours=48, minutes=1), driver=driver)
    written = filled_request(
        vehicle, Decimal("5"), now - timedelta(hours=96), driver=driver, duty_submitted_at=now, duty_particulars="x"
    )
    FuelRequestFactory(vehicle=vehicle, driver=driver, filled_at=now - timedelta(hours=96))  # never filled: still open

    overdue = requests.overdue_duty(now)

    assert set(overdue) == {exactly, late}  # two days have passed: the 48th hour itself is overdue
    for fuel_request in (almost, exactly, late, written):
        assert (fuel_request in overdue) == duty_overdue(fuel_request, now)  # the same rule, as the API shows it


def test_duty_overdue_starts_at_the_moment_it_is_due(vehicle, driver):
    filled = filled_request(vehicle, Decimal("5"), timezone.now() - timedelta(hours=1), driver=driver)
    due = filled.filled_at + timedelta(hours=48)

    assert duty_overdue(filled, due - timedelta(microseconds=1)) is False
    assert duty_overdue(filled, due) is True
    assert duty_overdue(filled, due + timedelta(microseconds=1)) is True


def test_duty_overdue_is_judged_at_the_moment_it_is_asked_for(vehicle, driver):
    filled = filled_request(vehicle, Decimal("5"), timezone.now() - timedelta(hours=1), driver=driver)

    assert duty_overdue(filled) is False
    assert duty_overdue(filled, timezone.now() + timedelta(hours=48)) is True
