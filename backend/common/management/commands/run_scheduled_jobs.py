"""Run every scheduled alert job once. Meant for cron, e.g. every hour; each job is safe to run again.

A job that raises does not stop the others: it is reported on stderr and the command exits with an error at the end.
"""
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from accounts.jobs import delete_expired_device_tokens
from fleet.jobs import alert_missing_odometer, alert_service_due
from fuel.jobs import expire_unused_pins, remind_overdue_duty
from tracking.jobs import end_silent_trips, forget_old_locations

JOBS = (
    expire_unused_pins,
    remind_overdue_duty,
    alert_missing_odometer,
    alert_service_due,
    end_silent_trips,
    forget_old_locations,
    delete_expired_device_tokens,
)


class Command(BaseCommand):
    help = (
        "Expire unused PINs, send the overdue duty, missing odometer and service due alerts, end live location "
        "trips that went silent, forget old trips' locations and delete expired phone app sign-ins."
    )

    def handle(self, *args, **options):
        now = timezone.now()
        failed = 0
        for job in JOBS:
            try:
                done = job(now)
            except Exception as error:  # whatever one job raises, the rest must still run
                failed += 1
                self.stderr.write(f"{job.__name__}: failed ({type(error).__name__}: {error})")
            else:
                self.stdout.write(f"{job.__name__}: {done}")
        if failed:
            raise CommandError(f"{failed} of {len(JOBS)} scheduled jobs failed.")
