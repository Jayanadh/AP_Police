from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from common.management.commands import run_scheduled_jobs
from fleet.jobs import alert_service_due
from fuel.jobs import expire_unused_pins
from fuel.models import RequestStatus
from testing.factories import FuelRequestFactory

pytestmark = pytest.mark.django_db


def test_the_command_runs_the_seven_jobs_in_order_and_prints_what_each_did():
    stale = FuelRequestFactory(expires_at=timezone.now() - timedelta(hours=1))
    out = StringIO()

    call_command("run_scheduled_jobs", stdout=out)

    assert out.getvalue().splitlines() == [
        "expire_unused_pins: 1",
        "remind_overdue_duty: 0",
        "alert_missing_odometer: 0",
        "alert_service_due: 0",
        "end_silent_trips: 0",
        "forget_old_locations: 0",
        "delete_expired_device_tokens: 0",
    ]
    stale.refresh_from_db()
    assert stale.status == RequestStatus.EXPIRED


def test_a_failing_job_does_not_stop_the_others_and_the_command_exits_with_an_error(monkeypatch):
    def failing_job(now):
        raise RuntimeError("the database went away")

    monkeypatch.setattr(run_scheduled_jobs, "JOBS", (failing_job, expire_unused_pins, alert_service_due))
    stale = FuelRequestFactory(expires_at=timezone.now() - timedelta(hours=1))
    out, err = StringIO(), StringIO()

    with pytest.raises(CommandError) as error:
        call_command("run_scheduled_jobs", stdout=out, stderr=err)

    assert err.getvalue().splitlines() == ["failing_job: failed (RuntimeError: the database went away)"]
    assert out.getvalue().splitlines() == ["expire_unused_pins: 1", "alert_service_due: 0"]
    assert str(error.value) == "1 of 3 scheduled jobs failed."
    stale.refresh_from_db()
    assert stale.status == RequestStatus.EXPIRED


def test_when_every_job_succeeds_nothing_is_written_to_stderr():
    err = StringIO()

    call_command("run_scheduled_jobs", stdout=StringIO(), stderr=err)

    assert err.getvalue() == ""
