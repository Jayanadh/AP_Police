"""Scheduled live-location jobs. Each takes an aware `now`, returns how many trips it acted on and is safe to run
again."""
from datetime import datetime, timedelta

from django.conf import settings
from django.db.models import Q

from notifications.service import notify
from tracking.models import DutyTrip, LocationPoint


def end_silent_trips(now: datetime) -> int:
    """End the trips no location has come from for a long time (a phone switched off, a trip never stopped)."""
    hours = settings.MTO_RULES["TRIP_SILENT_HOURS"]
    cutoff = now - timedelta(hours=hours)
    silent = DutyTrip.objects.filter(ended_at__isnull=True).filter(
        Q(last_point_at__lt=cutoff) | Q(last_point_at__isnull=True, started_at__lt=cutoff)
    )
    ended = 0
    for trip in silent.select_related("driver", "vehicle"):
        # Claimed by the update itself, so a second run (or the driver stopping it meanwhile) is left alone.
        claimed = DutyTrip.objects.filter(pk=trip.pk, ended_at__isnull=True).update(
            ended_at=now, end_reason=f"No location for {hours} hours."
        )
        if claimed:
            notify(
                [trip.driver],
                "Live location stopped",
                f"No location came from {trip.vehicle.registration_number} for {hours} hours, so sharing stopped. "
                "Start it again when you are on duty.",
                "/driver/live",
            )
            ended += 1
    return ended


def forget_old_locations(now: datetime) -> int:
    """Delete the locations of trips that ended long ago; the trips themselves stay. Returns how many trips."""
    cutoff = now - timedelta(days=settings.MTO_RULES["LOCATION_KEEP_DAYS"])
    old = list(
        DutyTrip.objects.filter(ended_at__lt=cutoff, points__isnull=False).distinct().values_list("pk", flat=True)
    )
    LocationPoint.objects.filter(trip_id__in=old).delete()
    return len(old)
