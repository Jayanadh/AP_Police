from django.contrib.auth.models import AbstractUser
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q


class Role(models.TextChoices):
    PTO = "PTO", "PTO"
    MTO = "MTO", "MTO"
    OFFICER = "OFFICER", "Officer"
    DRIVER = "DRIVER", "Driver"
    PUMP_OPERATOR = "PUMP_OPERATOR", "Pump operator"


class UserStatus(models.TextChoices):
    PENDING_APPROVAL = "PENDING_APPROVAL", "Waiting for PTO approval"
    ACTIVE = "ACTIVE", "Active"
    PAUSED = "PAUSED", "Paused"
    TERMINATED = "TERMINATED", "Terminated"
    REJECTED = "REJECTED", "Rejected"


def normalize_username(value: str) -> str:
    """Login IDs are case-insensitive: they are stored and looked up in lowercase."""
    return value.strip().lower()


mobile_validator = RegexValidator(r"^[6-9]\d{9}$", "Enter a 10-digit mobile number.")


class Unit(models.Model):
    """An MTO office: the tenant. Every MTO-level record belongs to exactly one unit."""

    name = models.CharField(max_length=150, unique=True)
    code = models.CharField(max_length=20, unique=True)
    district = models.ForeignKey("masters.District", on_delete=models.PROTECT, related_name="units")
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class User(AbstractUser):
    full_name = models.CharField(max_length=150)
    emp_id = models.CharField("Emp ID", max_length=30, unique=True, null=True, blank=True)
    designation = models.ForeignKey("masters.Designation", on_delete=models.PROTECT, null=True, blank=True)
    district = models.ForeignKey("masters.District", on_delete=models.PROTECT, null=True, blank=True)
    cadre = models.ForeignKey("masters.Cadre", on_delete=models.PROTECT, null=True, blank=True)
    mobile = models.CharField(max_length=10, blank=True, validators=[mobile_validator])
    role = models.CharField(max_length=20, choices=Role.choices)
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT, null=True, blank=True, related_name="members")
    pump = models.ForeignKey("pumps.Pump", on_delete=models.PROTECT, null=True, blank=True, related_name="staff")
    status = models.CharField(max_length=20, choices=UserStatus.choices, default=UserStatus.ACTIVE)
    must_change_password = models.BooleanField(default=False)
    licence_number = models.CharField(max_length=30, blank=True)
    licence_valid_till = models.DateField(null=True, blank=True)

    REQUIRED_FIELDS = ["full_name", "role"]

    class Meta:
        ordering = ["full_name"]
        constraints = [
            models.CheckConstraint(
                condition=Q(role=Role.PTO) | Q(unit__isnull=False),
                name="user_unit_required_unless_pto",
            ),
            models.UniqueConstraint(
                fields=["unit"], condition=Q(role=Role.MTO), name="one_mto_login_per_unit"
            ),
            models.CheckConstraint(
                condition=~Q(role=Role.PUMP_OPERATOR) | Q(pump__isnull=False),
                name="pump_operator_needs_pump",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.username})"

    def save(self, *args, **kwargs):
        # Only ACTIVE users may log in. Keeping Django's is_active in step with status makes
        # login, existing sessions and the admin all respect pause / terminate / pending.
        self.username = normalize_username(self.username)
        self.is_active = self.status == UserStatus.ACTIVE

        # When update_fields is used, ensure is_active and username are included when relevant
        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            update_fields = set(update_fields)
            if "status" in update_fields:
                update_fields.add("is_active")
            if self.username:  # Always keep username in sync when updating
                update_fields.add("username")
            kwargs["update_fields"] = list(update_fields)

        super().save(*args, **kwargs)


class TransferStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    ACCEPTED = "ACCEPTED", "Accepted"
    REJECTED = "REJECTED", "Rejected"
    CANCELLED = "CANCELLED", "Cancelled"


class OfficerTransfer(models.Model):
    """The new MTO office asks for an officer; the officer's current office accepts or rejects.

    `from_unit` is the officer's office when the request was made; `to_unit` is the office asking.
    The new office may cancel while the request is pending.
    """

    officer = models.ForeignKey(User, on_delete=models.PROTECT, related_name="transfers")
    from_unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="outgoing_transfers")
    to_unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="incoming_transfers")
    note = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=TransferStatus.choices, default=TransferStatus.PENDING)
    requested_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-requested_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["officer"],
                condition=Q(status=TransferStatus.PENDING),
                name="one_pending_transfer_per_officer",
            ),
        ]

    def __str__(self) -> str:
        return f"Transfer #{self.pk} of {self.officer_id} to {self.to_unit_id} ({self.status})"


class DeviceToken(models.Model):
    """A phone app's sign-in. The app keeps the token; only its SHA-256 is stored. It stops working when it expires,
    when the app signs out, when the person's password changes on any other device, or when they are no longer
    active."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="device_tokens")
    key_hash = models.CharField(max_length=64, unique=True)
    # A mark of the password the token was given under (Django's session hash of it): a new password ends it.
    password_mark = models.CharField(max_length=128)
    name = models.CharField(max_length=100, blank=True)  # the device, as the app names it
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"Device token #{self.pk} of {self.user_id}"
