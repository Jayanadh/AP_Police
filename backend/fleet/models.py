import re

from django.db import models
from django.db.models import Q


class FuelType(models.TextChoices):
    PETROL = "PETROL", "Petrol"
    DIESEL = "DIESEL", "Diesel"


class VehicleType(models.TextChoices):
    CAR = "CAR", "Car"
    JEEP = "JEEP", "Jeep"
    MOTORCYCLE = "MOTORCYCLE", "Motorcycle"
    VAN = "VAN", "Van"
    BUS = "BUS", "Bus"
    TRUCK = "TRUCK", "Truck"
    OTHER = "OTHER", "Other"


class VehicleStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    PAUSED = "PAUSED", "Paused"
    TERMINATION_PENDING = "TERMINATION_PENDING", "Termination waiting for PTO"
    TERMINATED = "TERMINATED", "Terminated"


class AssignmentKind(models.TextChoices):
    OFFICER = "OFFICER", "Officer"
    DRIVER = "DRIVER", "Driver"


def normalize_registration(value: str) -> str:
    """Registration numbers are stored uppercase with only letters and digits: "ap 39-pa 1234" -> "AP39PA1234"."""
    return re.sub(r"[^A-Z0-9]", "", value.upper())


class Vehicle(models.Model):
    unit = models.ForeignKey("accounts.Unit", on_delete=models.PROTECT, related_name="vehicles")
    registration_number = models.CharField(max_length=15, unique=True)
    vehicle_type = models.CharField(max_length=20, choices=VehicleType.choices)
    make = models.CharField(max_length=60)
    model = models.CharField(max_length=60)
    year_of_manufacture = models.PositiveSmallIntegerField(null=True, blank=True)
    fuel_type = models.CharField(max_length=10, choices=FuelType.choices)
    tank_capacity_litres = models.DecimalField(max_digits=6, decimal_places=2)
    chassis_number = models.CharField(max_length=30, blank=True)
    engine_number = models.CharField(max_length=30, blank=True)
    odometer_at_onboarding_km = models.PositiveIntegerField(default=0)
    monthly_fuel_limit_litres = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    service_interval_km = models.PositiveIntegerField(null=True, blank=True)
    service_interval_days = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=VehicleStatus.choices, default=VehicleStatus.ACTIVE)
    service_due_alerted = models.BooleanField(default=False)  # the MTO has been alerted for this service cycle
    odometer_alert_week = models.DateField(null=True, blank=True)  # the last week a missing reading was alerted
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["registration_number"]

    def __str__(self) -> str:
        return self.registration_number

    def save(self, *args, **kwargs):
        self.registration_number = normalize_registration(self.registration_number)
        super().save(*args, **kwargs)


class VehicleAssignment(models.Model):
    """A link between a vehicle and an officer or driver. A link with no `ended_at` is current."""

    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="assignments")
    person = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="vehicle_assignments")
    kind = models.CharField(max_length=10, choices=AssignmentKind.choices)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    assigned_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")
    ended_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-started_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=Q(kind=AssignmentKind.OFFICER, ended_at__isnull=True),
                name="one_current_officer_per_vehicle",
            ),
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=Q(kind=AssignmentKind.DRIVER, ended_at__isnull=True),
                name="one_current_driver_per_vehicle",
            ),
            models.UniqueConstraint(
                fields=["person"],
                condition=Q(kind=AssignmentKind.DRIVER, ended_at__isnull=True),
                name="one_current_vehicle_per_driver",
            ),
            models.UniqueConstraint(
                fields=["vehicle", "person"],
                condition=Q(ended_at__isnull=True),
                name="no_duplicate_current_link",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.person} on {self.vehicle} ({self.kind})"


class OdometerReading(models.Model):
    """The reading a driver enters for a Sunday: one per vehicle per week."""

    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="odometer_readings")
    week_of = models.DateField()  # the Sunday the reading is for
    reading_km = models.PositiveIntegerField()
    recorded_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-week_of", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["vehicle", "week_of"], name="one_odometer_reading_per_vehicle_week"),
        ]

    def __str__(self) -> str:
        return f"{self.vehicle} {self.reading_km} km, week of {self.week_of}"


class ServiceRecord(models.Model):
    """A service of a vehicle, written down by the MTO."""

    vehicle = models.ForeignKey(Vehicle, on_delete=models.PROTECT, related_name="service_records")
    service_date = models.DateField()
    odometer_km = models.PositiveIntegerField()
    notes = models.TextField(blank=True)
    recorded_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-service_date", "-id"]

    def __str__(self) -> str:
        return f"{self.vehicle} serviced on {self.service_date}"
