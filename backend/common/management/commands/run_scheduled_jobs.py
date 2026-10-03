"""Run every scheduled alert job once. Meant for cron, e.g. every hour; each job is safe to run again.

A job that raises does not stop the others: it is reported on stderr and the command exits with an error at the end.
"""
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from fleet.jobs import alert_missing_odometer, alert_service_due
from fuel.jobs import expire_unused_pins, remind_overdue_duty

JOBS = (expire_unused_pins, remind_overdue_duty, alert_missing_odometer, alert_service_due)


class Command(BaseCommand):
    help = "Expire unused PINs, then send the overdue duty, missing odometer and service due alerts."

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
