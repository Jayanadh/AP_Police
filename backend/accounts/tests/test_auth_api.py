import pytest
from rest_framework.test import APIClient

from accounts.models import UserStatus
from testing.factories import PASSWORD, DriverFactory, OfficerFactory, PumpStaffFactory, UnitFactory, tieup_pump

pytestmark = pytest.mark.django_db


def login(api, username, password=PASSWORD):
    return api.post("/api/auth/login/", {"username": username, "password": password})


def test_session_sets_csrf_cookie_and_reports_no_user(api):
    response = api.get("/api/auth/session/")
    assert response.status_code == 200
    assert response.json() == {"user": None}
    assert "XSRF-TOKEN" in response.cookies


def test_login_returns_profile_and_starts_a_session(api):
    driver = DriverFactory(username="ap1001", full_name="Ravi Kumar")
    response = login(api, "ap1001")
    assert response.status_code == 200
    user = response.json()["user"]
    assert user["full_name"] == "Ravi Kumar"
    assert user["role"] == "DRIVER"
    assert user["unit"] == driver.unit_id
    assert user["unit_name"] == driver.unit.name
    assert api.get("/api/auth/session/").json()["user"]["username"] == "ap1001"


def test_session_shows_the_pump_of_pump_staff_and_no_pump_for_everyone_else(api):
    unit = UnitFactory()
    bunk = tieup_pump(unit)
    staff = PumpStaffFactory(username="bunk.staff", unit=unit, pump=bunk)
    DriverFactory(username="ap1099")

    login(api, "bunk.staff")
    user = api.get("/api/auth/session/").json()["user"]
    assert user["role"] == "PUMP_OPERATOR"
    assert (user["pump"], user["pump_name"], user["pump_kind"]) == (staff.pump_id, bunk.name, "TIE_UP")

    login(api, "ap1099")
    user = api.get("/api/auth/session/").json()["user"]
    assert (user["pump"], user["pump_name"], user["pump_kind"]) == (None, None, None)


def test_login_id_is_case_insensitive(api):
    DriverFactory(username="ap1002")
    assert login(api, "  AP1002 ").status_code == 200


def test_wrong_password_is_rejected(api):
    DriverFactory(username="ap1003")
    response = login(api, "ap1003", "wrong-password")
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid username or password."}


@pytest.mark.parametrize(
    "status,message",
    [
        (UserStatus.PAUSED, "Your account is paused. Contact your MTO."),
        (UserStatus.TERMINATED, "Your account has been terminated."),
        (UserStatus.PENDING_APPROVAL, "Your account is waiting for PTO approval."),
        (UserStatus.REJECTED, "Your account request was rejected by the PTO."),
    ],
)
def test_blocked_accounts_get_a_clear_reason(api, status, message):
    OfficerFactory(username="ap2001", status=status)
    response = login(api, "ap2001")
    assert response.status_code == 400
    assert response.json() == {"detail": message}


def test_blocked_reason_is_hidden_without_the_right_password(api):
    OfficerFactory(username="ap2002", status=UserStatus.PAUSED)
    assert login(api, "ap2002", "wrong").json() == {"detail": "Invalid username or password."}


def test_pausing_a_user_ends_their_existing_session(api):
    driver = DriverFactory(username="ap1004")
    login(api, "ap1004")
    driver.status = UserStatus.PAUSED
    driver.save()
    assert api.get("/api/auth/session/").json() == {"user": None}


def test_logout_ends_the_session(api):
    DriverFactory(username="ap1005")
    login(api, "ap1005")
    assert api.post("/api/auth/logout/").status_code == 204
    assert api.get("/api/auth/session/").json() == {"user": None}


def test_change_password_clears_the_must_change_flag_and_keeps_session(api):
    driver = DriverFactory(username="ap1006", must_change_password=True)
    login(api, "ap1006")
    response = api.post(
        "/api/auth/change-password/", {"old_password": PASSWORD, "new_password": "Another-strong-77"}
    )
    assert response.status_code == 204
    driver.refresh_from_db()
    assert driver.must_change_password is False
    assert driver.check_password("Another-strong-77")
    assert api.get("/api/auth/session/").json()["user"]["username"] == "ap1006"


def test_change_password_needs_the_current_password(api):
    DriverFactory(username="ap1007")
    login(api, "ap1007")
    response = api.post(
        "/api/auth/change-password/", {"old_password": "nope", "new_password": "Another-strong-77"}
    )
    assert response.status_code == 400
    assert response.json() == {"detail": "Current password is incorrect."}


def test_change_password_rejects_weak_passwords(api):
    DriverFactory(username="ap1008")
    login(api, "ap1008")
    response = api.post("/api/auth/change-password/", {"old_password": PASSWORD, "new_password": "12345678"})
    assert response.status_code == 400
    assert "new_password" in response.json()


def test_login_is_throttled_after_ten_attempts(api):
    for _ in range(10):
        login(api, "nobody", "wrong")
    assert login(api, "nobody", "wrong").status_code == 429


def test_login_is_throttled_per_login_id_whatever_address_the_attempts_come_from():
    DriverFactory(username="ap1013")
    for attempt in range(20):
        client = APIClient(REMOTE_ADDR=f"10.0.0.{attempt}")
        assert login(client, "ap1013", "wrong").status_code == 400

    fresh_address = APIClient(REMOTE_ADDR="10.0.1.1")
    assert login(fresh_address, "AP1013", "wrong").status_code == 429  # the same login ID, typed in capitals
    assert login(fresh_address, "someone.else", "wrong").status_code == 400


def test_a_made_up_forwarded_address_does_not_dodge_the_address_throttle():
    for attempt in range(10):
        client = APIClient(HTTP_X_FORWARDED_FOR=f"203.0.113.{attempt}")
        login(client, f"nobody{attempt}", "wrong")

    assert login(APIClient(HTTP_X_FORWARDED_FOR="203.0.113.99"), "nobody99", "wrong").status_code == 429


# --- a password that must be changed first ----------------------------------------------------------------------

MUST_CHANGE = "Change your password before you continue."


@pytest.mark.parametrize(
    ("method", "url"),
    [
        ("get", "/api/dashboard/"),
        ("get", "/api/notifications/"),
        ("get", "/api/me/vehicles/"),
        ("post", "/api/fuel/requests/"),
        ("get", "/api/masters/districts/"),
    ],
)
def test_until_the_password_is_changed_the_api_answers_nothing_else(api, method, url):
    DriverFactory(username="ap1010", must_change_password=True)
    assert login(api, "ap1010").status_code == 200

    response = getattr(api, method)(url, {"litres": "10"} if method == "post" else None)

    assert response.status_code == 403
    assert response.json() == {"detail": MUST_CHANGE}


def test_someone_who_must_change_their_password_can_see_the_session_change_it_and_go_on(api):
    DriverFactory(username="ap1011", must_change_password=True)
    login(api, "ap1011")
    assert api.get("/api/auth/session/").json()["user"]["must_change_password"] is True
    assert api.get("/api/dashboard/").status_code == 403

    changed = api.post("/api/auth/change-password/", {"old_password": PASSWORD, "new_password": "Another-strong-77"})

    assert changed.status_code == 204
    assert api.get("/api/dashboard/").status_code == 200


def test_someone_who_must_change_their_password_can_log_out(api):
    DriverFactory(username="ap1012", must_change_password=True)
    login(api, "ap1012")

    assert api.post("/api/auth/logout/").status_code == 204
    assert api.get("/api/auth/session/").json() == {"user": None}


def test_login_needs_the_csrf_token_from_the_session_call():
    """Otherwise another site could log a visitor in as the attacker without them noticing (login CSRF)."""
    DriverFactory(username="ap1014")
    client = APIClient(enforce_csrf_checks=True)

    refused = login(client, "ap1014")
    assert refused.status_code == 403
    assert refused.json()["detail"].startswith("CSRF Failed")

    token = client.get("/api/auth/session/").cookies["XSRF-TOKEN"].value
    accepted = client.post(
        "/api/auth/login/", {"username": "ap1014", "password": PASSWORD}, HTTP_X_XSRF_TOKEN=token
    )
    assert accepted.status_code == 200
