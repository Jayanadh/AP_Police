from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q

from fleet.models import FuelType


class PumpKind(models.TextChoices):
    POLICE = "POLICE", "Police pump"
    TIE_UP = "TIE_UP", "Tie-up bunk"


class Pump(models.Model):
    """A police pump or a tie-up bunk, added (and managed) by one MTO office but usable by any vehicle in AP."""

    unit = models.ForeignKey("accounts.Unit", on_delete=models.PROTECT, related_name="pumps")
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=10, choices=PumpKind.choices)
    address = models.CharField(max_length=255)
    district = models.ForeignKey("masters.District", on_delete=models.PROTECT, related_name="pumps")
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    opening_hours = models.CharField(max_length=60, default="24/7")
    sells_petrol = models.BooleanField(default=True)
    sells_diesel = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["unit", "name"], name="unique_pump_name_per_unit"),
            models.CheckConstraint(
                condition=Q(sells_petrol=True) | Q(sells_diesel=True), name="pump_sells_a_fuel"
            ),
        ]

    def __str__(self) -> str:
        return self.name

    def sells(self, fuel_type: str) -> bool:
        return self.sells_petrol if fuel_type == FuelType.PETROL else self.sells_diesel

    def fuel_available(self, fuel_type: str) -> bool:
        """Sold here and, at a police pump, in stock. A tie-up bunk keeps no stock, so it is always available."""
        if not self.sells(fuel_type):
            return False
        if self.kind == PumpKind.TIE_UP:
            return True
        return any(tank.fuel_type == fuel_type and tank.current_stock_litres > 0 for tank in self.tanks.all())


class PumpTank(models.Model):
    """The stock of one fuel at a police pump. Tie-up bunks have no tanks."""

    pump = models.ForeignKey(Pump, on_delete=models.CASCADE, related_name="tanks")
    fuel_type = models.CharField(max_length=10, choices=FuelType.choices)
    capacity_litres = models.DecimalField(max_digits=9, decimal_places=2, null=True, blank=True)
    current_stock_litres = models.DecimalField(max_digits=9, decimal_places=2, default=0)
    low_stock_threshold_litres = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal("100"))
    low_stock_alerted = models.BooleanField(default=False)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["pump", "fuel_type"], name="one_tank_per_fuel_per_pump"),
        ]

    def __str__(self) -> str:
        return f"{self.pump} {self.fuel_type}"

    @property
    def is_low(self) -> bool:
        return self.current_stock_litres < self.low_stock_threshold_litres


class StockEntryKind(models.TextChoices):
    MEASUREMENT = "MEASUREMENT", "Morning measurement"
    TANKER_RECEIPT = "TANKER_RECEIPT", "Tanker receipt"
    DISPENSE = "DISPENSE", "Fill"


class StockEntry(models.Model):
    """One line of a tank's stock ledger. `litres` is the measured value, the litres received or the litres filled."""

    tank = models.ForeignKey(PumpTank, on_delete=models.PROTECT, related_name="entries")
    kind = models.CharField(max_length=20, choices=StockEntryKind.choices)
    litres = models.DecimalField(max_digits=9, decimal_places=2)
    stock_before = models.DecimalField(max_digits=9, decimal_places=2)
    stock_after = models.DecimalField(max_digits=9, decimal_places=2)
    note = models.CharField(max_length=200, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="stock_entries")
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at", "-id"]
        verbose_name_plural = "stock entries"

    def __str__(self) -> str:
        return f"{self.tank} {self.kind} {self.litres} L"
