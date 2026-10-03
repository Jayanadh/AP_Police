from django.conf import settings
from django.db import models
from django.db.models import Q


class ApprovalKind(models.TextChoices):
    OFFICER_CREATE = "OFFICER_CREATE", "New officer"
    VEHICLE_TERMINATE = "VEHICLE_TERMINATE", "Vehicle termination"


class ApprovalStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"


class ApprovalRequest(models.Model):
    """A request waiting for the PTO: a new officer, or the termination of a vehicle.

    For a vehicle termination, `previous_status` remembers the vehicle's status before it was
    parked as TERMINATION_PENDING, so a rejection can put it back exactly as it was.
    """

    kind = models.CharField(max_length=20, choices=ApprovalKind.choices)
    unit = models.ForeignKey("accounts.Unit", on_delete=models.PROTECT, related_name="approval_requests")
    officer = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="approval_requests"
    )
    vehicle = models.ForeignKey(
        "fleet.Vehicle", null=True, blank=True, on_delete=models.PROTECT, related_name="approval_requests"
    )
    previous_status = models.CharField(max_length=20, blank=True)
    request_note = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=ApprovalStatus.choices, default=ApprovalStatus.PENDING)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)

    class Meta:
        ordering = ["-requested_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["officer"],
                condition=Q(status=ApprovalStatus.PENDING),
                name="one_pending_approval_per_officer",
            ),
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=Q(status=ApprovalStatus.PENDING),
                name="one_pending_approval_per_vehicle",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} #{self.pk} ({self.status})"
