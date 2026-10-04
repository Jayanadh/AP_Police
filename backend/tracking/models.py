"""A driver's live location while on duty. The driver starts a trip with the duty particulars, the phone sends where
it is until the driver stops the trip, and the MTO of the vehicle's office watches it. Nobody is tracked otherwise."""
from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from accounts.models import Unit
from fleet.models import Vehicle


class DutyTrip(models.Model):
    driver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="duty_trips")
    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="duty_trips")
    # The vehicle's office when the trip started: its MTO watches the trip.
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="duty_trips")
    duty_particulars = models.TextField()
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    end_reason = models.CharField(max_length=120, blank=True)
    # The newest location received, so the live board needs no look through the points.
    last_point_at = models.DateTimeField(null=True, blank=True)
    last_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    last_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    last_accuracy_m = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["driver"], condition=Q(ended_at__isnull=True), name="one_open_trip_per_driver"
            ),
        ]
        indexes = [models.Index(fields=["unit", "ended_at"], name="trip_unit_open")]

    def __str__(self) -> str:
        return f"{self.driver} in {self.vehicle} from {self.started_at:%Y-%m-%d %H:%M}"

    @property
    def is_open(self) -> bool:
        return self.ended_at is None


class LocationPoint(models.Model):
    """Where the phone was at `recorded_at` (the phone's own time, so a point sent late keeps its moment)."""

    trip = models.ForeignKey(DutyTrip, on_delete=models.CASCADE, related_name="points")
    recorded_at = models.DateTimeField()
    received_at = models.DateTimeField(auto_now_add=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    accuracy_m = models.FloatField(null=True, blank=True)
    speed_mps = models.FloatField(null=True, blank=True)
    heading_deg = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ["recorded_at", "id"]
        constraints = [models.UniqueConstraint(fields=["trip", "recorded_at"], name="one_point_per_moment")]

    def __str__(self) -> str:
        return f"{self.latitude},{self.longitude} at {self.recorded_at:%H:%M:%S}"
