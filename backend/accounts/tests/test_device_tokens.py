"""Device tokens: how the Android and iOS apps sign in. The app keeps a token and sends it as `Authorization: Bearer`
on every call, with no cookies and no CSRF token; the server keeps only the token's SHA-256."""
from datetime import timedelta
from hashlib import sha256

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.jobs import delete_expired_device_tokens
from accounts.models import DeviceToken, UserStatus
from testing.factories import PASSWORD, MTOFactory, VehicleFactory, driver_on, unit_mto

pytestmark = pytest.mark.django_db

TOKEN = "/api/auth/token/"
SIGN_IN_AGAIN = {"detail": "Sign in again."}


@pytest.fixture
def driver():
    person = driver_on(VehicleFactory(unit=MTOFactory().unit))
    person.username = "ap2001"
    person.save()
    return person


def sign_in(username="ap2001", password=PASSWORD, **extra):
    return APIClient(enforce_csrf_checks=True).post(TOKEN, {"username": username, "password": password, **extra})


def app(token):
    """A client like the phone app: the token on every call, CSRF enforced as for a browser, no cookies."""
    client = APIClient(enforce_csrf_checks=True)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


def test_the_app_signs_in_and_gets_a_token_that_is_stored_only_as_a_hash(driver):
    before = timezone.now()

    response = sign_in(device_name="Ravi's phone")

    assert response.status_code == 201
    body = response.json()
    assert body["user"]["username"] == "ap2001"
    assert body["user"]["role"] == "DRIVER"
    token = body["token"]
    assert len(token) >= 40
    stored = DeviceToken.objects.get(user=driver)
    assert stored.key_hash == sha256(token.encode()).hexdigest()
    assert token not in {stored.key_hash, stored.name}
    assert stored.name == "Ravi's phone"
    assert before + timedelta(days=30) <= stored.expires_at <= timezone.now() + timedelta(days=30)
    assert "sessionid" not in response.cookies


def test_the_token_signs_each_call_in_without_a_session_or_csrf_token(driver):
    phone = app(sign_in().json()["token"])

    assert phone.get("/api/auth/session/").json()["user"]["username"] == "ap2001"
    started = phone.post("/api/tracking/trips/", {"duty_particulars": "Night patrol"})

    assert started.status_code == 201
    assert phone.cookies.get("sessionid") is None


def test_a_wrong_password_is_refused_as_on_the_login_page(driver):
    response = sign_in(password="wrong-password")
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid username or password."}
    assert not DeviceToken.objects.exists()


def test_a_blocked_account_is_explained_to_someone_who_knows_its_password(driver):
    driver.status = UserStatus.PAUSED
    driver.save()
    assert sign_in().json() == {"detail": "Your account is paused. Contact your MTO."}


def test_signing_in_for_a_token_is_throttled_like_the_login_page():
    for _ in range(10):
        sign_in("nobody", "wrong")
    assert sign_in("nobody", "wrong").status_code == 429


@pytest.mark.parametrize("header", ["Bearer made-up-token", "Bearer", "Bearer two parts"])
def test_an_unknown_or_malformed_token_is_refused(header):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=header)

    response = client.get("/api/tracking/trips/current/")

    assert response.status_code == 403
    assert response.json() == SIGN_IN_AGAIN


def test_an_expired_token_is_refused(driver):
    token = sign_in().json()["token"]
    DeviceToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))

    assert app(token).get("/api/tracking/trips/current/").json() == SIGN_IN_AGAIN


def test_a_paused_drivers_token_stops_working(driver):
    phone = app(sign_in().json()["token"])
    driver.status = UserStatus.PAUSED
    driver.save()

    assert phone.get("/api/tracking/trips/current/").json() == SIGN_IN_AGAIN


def test_changing_the_password_ends_the_other_devices_but_not_this_one(driver):
    this_phone, other_phone = app(sign_in().json()["token"]), app(sign_in().json()["token"])

    changed = this_phone.post(
        "/api/auth/change-password/", {"old_password": PASSWORD, "new_password": "Fresh-secret-2026"}
    )

    assert changed.status_code == 204
    assert this_phone.get("/api/tracking/trips/current/").status_code == 200
    assert other_phone.get("/api/tracking/trips/current/").json() == SIGN_IN_AGAIN


def test_a_password_reset_by_the_mto_ends_every_device(driver):
    phone = app(sign_in().json()["token"])
    office = APIClient()
    office.force_login(unit_mto(driver.unit))

    office.post(f"/api/drivers/{driver.id}/reset-password/", {"password": "Reset-by-mto-2026"})

    assert phone.get("/api/tracking/trips/current/").json() == SIGN_IN_AGAIN


def test_until_the_password_is_changed_a_token_opens_only_what_is_needed_to_change_it(driver):
    driver.must_change_password = True
    driver.save()
    phone = app(sign_in().json()["token"])

    assert phone.get("/api/tracking/trips/current/").json() == {"detail": "Change your password before you continue."}
    assert phone.get("/api/auth/session/").status_code == 200
    changed = phone.post("/api/auth/change-password/", {"old_password": PASSWORD, "new_password": "Fresh-secret-2026"})
    assert changed.status_code == 204
    assert phone.get("/api/tracking/trips/current/").status_code == 200


def test_signing_out_ends_the_token(driver):
    phone = app(sign_in().json()["token"])

    assert phone.post("/api/auth/logout/").status_code == 204

    assert phone.get("/api/tracking/trips/current/").json() == SIGN_IN_AGAIN
    assert not DeviceToken.objects.exists()


def test_a_person_keeps_at_most_five_devices_signed_in(driver):
    tokens = [sign_in().json()["token"] for _ in range(6)]

    assert DeviceToken.objects.filter(user=driver).count() == 5
    assert app(tokens[0]).get("/api/tracking/trips/current/").json() == SIGN_IN_AGAIN
    assert app(tokens[-1]).get("/api/tracking/trips/current/").status_code == 200


def test_the_last_use_is_noted(driver):
    token = sign_in().json()["token"]
    assert DeviceToken.objects.get().last_used_at is None

    app(token).get("/api/tracking/trips/current/")

    assert DeviceToken.objects.get().last_used_at is not None


def test_expired_tokens_are_deleted_by_the_scheduled_job(driver):
    sign_in(), sign_in()
    DeviceToken.objects.filter(pk=DeviceToken.objects.first().pk).update(expires_at=timezone.now())

    assert delete_expired_device_tokens(timezone.now() + timedelta(seconds=1)) == 1
    assert DeviceToken.objects.count() == 1
