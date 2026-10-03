"""`manage.py create_pto`: the first login on a new server, made without the demo data."""
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from accounts.models import Role, User, UserStatus
from testing.factories import PTOFactory

pytestmark = pytest.mark.django_db

STRONG = "Kavali-Range-2026"


def run(monkeypatch, *answers, **options):
    """Run the command, answering its password prompts with `answers` in turn."""
    replies = iter(answers)
    monkeypatch.setattr("accounts.management.commands.create_pto.getpass", lambda prompt: next(replies))
    out = StringIO()
    call_command("create_pto", stdout=out, **options)
    return out.getvalue()


def test_it_creates_an_active_pto_with_the_password_typed_twice(monkeypatch):
    output = run(monkeypatch, STRONG, STRONG, username="State.PTO", full_name="State PTO")

    pto = User.objects.get()
    assert pto.username == "state.pto"  # login IDs are kept in lower case, as everywhere
    assert (pto.full_name, pto.role, pto.status, pto.unit) == ("State PTO", Role.PTO, UserStatus.ACTIVE, None)
    assert pto.check_password(STRONG)
    assert not pto.must_change_password
    assert output.strip() == "PTO login state.pto is ready."


def test_the_pto_gets_no_django_superuser_or_staff_rights(monkeypatch):
    run(monkeypatch, STRONG, STRONG, username="pto", full_name="State PTO")

    pto = User.objects.get()
    assert not pto.is_superuser
    assert not pto.is_staff


def test_the_two_passwords_must_match(monkeypatch):
    with pytest.raises(CommandError, match="The two passwords do not match."):
        run(monkeypatch, STRONG, STRONG + "x", username="pto", full_name="State PTO")

    assert not User.objects.exists()


def test_a_weak_password_is_refused_with_the_reasons(monkeypatch):
    with pytest.raises(CommandError, match="This password is too common"):
        run(monkeypatch, "password123", "password123", username="pto", full_name="State PTO")

    assert not User.objects.exists()


def test_a_login_id_already_in_use_is_refused(monkeypatch):
    PTOFactory(username="pto")

    with pytest.raises(CommandError, match="The login ID pto is already in use."):
        run(monkeypatch, STRONG, STRONG, username="PTO", full_name="State PTO")


def test_the_name_and_login_id_are_required(monkeypatch):
    with pytest.raises(CommandError):
        run(monkeypatch, STRONG, STRONG, username=" ", full_name="State PTO")
    with pytest.raises(CommandError):
        run(monkeypatch, STRONG, STRONG, username="pto", full_name=" ")

    assert not User.objects.exists()
