from django.conf import settings
from django.db import models
from django.db.models import Q

from fleet.models import FuelType, Vehicle


class RequestStatus(models.TextChoices):
    ISSUED = "ISSUED", "PIN issued"
    FILLED = "FILLED", "Filled"
    CANCELLED = "CANCELLED", "Cancelled"
    EXPIRED = "EXPIRED", "Expired"


class EmergencyStatus(models.TextChoices):
    NONE = "NONE", "Not an emergency"
    PENDING = "PENDING", "Waiting for MTO"
    ALLOWED = "ALLOWED", "Allowed — counted against additional quota"


class FuelGrant(models.Model):
    """Additional quota the MTO adds to one vehicle for one month, backed by an approval letter."""

    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="grants")
    month = models.DateField(help_text="The first day of the month the extra fuel is for.")
    litres = models.DecimalField(max_digits=7, decimal_places=2)
    approved_by = models.CharField(max_length=120)
    letter = models.FileField(upload_to="letters/%Y/%m/")
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.vehicle} +{self.litres} L for {self.month:%Y-%m}"


class FuelRequest(models.Model):
    """A driver's request for fuel: raised with a PIN, then filled at a pump, cancelled or expired."""

    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="fuel_requests")
    driver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="fuel_requests")
    fuel_type = models.CharField(max_length=10, choices=FuelType.choices)
    litres_requested = models.DecimalField(max_digits=6, decimal_places=2)
    is_emergency = models.BooleanField(default=False)
    emergency_reason = models.TextField(blank=True)

    pin = models.CharField(max_length=6)
    status = models.CharField(max_length=10, choices=RequestStatus.choices, default=RequestStatus.ISSUED)
    issued_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    failed_pin_attempts = models.PositiveSmallIntegerField(default=0)
    cancel_reason = models.CharField(max_length=200, blank=True)

    pump = models.ForeignKey("pumps.Pump", null=True, blank=True, on_delete=models.PROTECT, related_name="fills")
    filled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    filled_at = models.DateTimeField(null=True, blank=True)
    litres_filled = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    stock_entry = models.OneToOneField(
        "pumps.StockEntry", null=True, blank=True, on_delete=models.PROTECT, related_name="fuel_request"
    )

    emergency_litres = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    emergency_status = models.CharField(
        max_length=10, choices=EmergencyStatus.choices, default=EmergencyStatus.NONE
    )
    emergency_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    emergency_reviewed_at = models.DateTimeField(null=True, blank=True)

    duty_particulars = models.TextField(blank=True)
    duty_submitted_at = models.DateTimeField(null=True, blank=True)
    duty_overdue_notified = models.BooleanField(default=False)

    class Meta:
        ordering = ["-issued_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=Q(status=RequestStatus.ISSUED),
                name="one_open_request_per_vehicle",
            ),
        ]
        indexes = [models.Index(fields=["vehicle", "status", "filled_at"], name="fuelreq_vehicle_status_filled")]

    def __str__(self) -> str:
        return f"Request #{self.pk} {self.vehicle} {self.litres_requested} L ({self.status})"
