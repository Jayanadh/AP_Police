from decimal import Decimal

from django.contrib.auth.validators import UnicodeUsernameValidator
from rest_framework import serializers

from accounts.models import User, UserStatus, normalize_username
from accounts.serializers.people import PersonSerializer
from fleet.models import FuelType
from pumps.models import Pump, PumpKind, PumpTank, StockEntry

# Andhra Pradesh sits inside this box. A rough check, enough to catch a pin dropped in another state.
AP_LATITUDE = (Decimal("12.5"), Decimal("19.5"))
AP_LONGITUDE = (Decimal("76.5"), Decimal("84.9"))
OUTSIDE_AP = "Pick a location inside Andhra Pradesh."

# Pump staff who are no longer on the team do not count towards a pump's staff.
FORMER_STAFF = (UserStatus.TERMINATED, UserStatus.REJECTED)


class TankSerializer(serializers.ModelSerializer):
    is_low = serializers.BooleanField(read_only=True)
    # Anything recorded for the tank yet. Until then the MTO may set its opening stock.
    opening_set = serializers.SerializerMethodField()

    class Meta:
        model = PumpTank
        fields = [
            "id", "fuel_type", "current_stock_litres", "low_stock_threshold_litres", "capacity_litres", "is_low",
            "opening_set",
        ]
        read_only_fields = fields

    def get_opening_set(self, tank) -> bool:
        found = getattr(tank, "opening_set", None)  # annotated by the views that list many tanks
        return tank.entries.exists() if found is None else found


class TankDetailSerializer(TankSerializer):
    """A tank on its own: the MTO may change its alert level and capacity, nothing else is writable."""

    pump_name = serializers.CharField(source="pump.name", read_only=True)

    class Meta(TankSerializer.Meta):
        fields = [
            "id", "pump", "pump_name", "fuel_type", "current_stock_litres", "low_stock_threshold_litres",
            "capacity_litres", "is_low", "opening_set",
        ]
        read_only_fields = [
            "id", "pump", "pump_name", "fuel_type", "current_stock_litres", "is_low", "opening_set",
        ]
        extra_kwargs = {
            "low_stock_threshold_litres": {"min_value": Decimal("0")},
            "capacity_litres": {"min_value": Decimal("0")},
        }


class StockInputSerializer(serializers.Serializer):
    """The body of a measurement or a tanker receipt. The stock rules (sign, size) are checked by `pumps.stock`."""

    litres = serializers.DecimalField(max_digits=9, decimal_places=2)
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class StockEntrySerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.full_name", read_only=True)

    class Meta:
        model = StockEntry
        fields = [
            "id", "kind", "kind_label", "litres", "stock_before", "stock_after", "note", "recorded_by_name",
            "recorded_at",
        ]
        read_only_fields = fields


class PumpSerializer(serializers.ModelSerializer):
    """A pump of the MTO's own unit. The viewset decides the unit, its district and the active flag: an MTO office
    works in one district, so its pumps are in that district."""

    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    district_name = serializers.CharField(source="district.name", read_only=True)
    tanks = serializers.SerializerMethodField()
    staff_count = serializers.SerializerMethodField()

    class Meta:
        model = Pump
        fields = [
            "id", "name", "kind", "kind_label", "address", "district", "district_name", "latitude", "longitude",
            "opening_hours", "sells_petrol", "sells_diesel", "is_active", "tanks", "staff_count",
        ]
        read_only_fields = ["district", "is_active"]

    def validate_name(self, value):
        # The unit is set by the viewset, not sent by the client, so the (unit, name) rule is checked here.
        clash = Pump.objects.filter(unit=self.context["request"].user.unit, name=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("You already have a pump with this name.")
        return value

    def validate_latitude(self, value):
        if not AP_LATITUDE[0] <= value <= AP_LATITUDE[1]:
            raise serializers.ValidationError(OUTSIDE_AP)
        return value

    def validate_longitude(self, value):
        if not AP_LONGITUDE[0] <= value <= AP_LONGITUDE[1]:
            raise serializers.ValidationError(OUTSIDE_AP)
        return value

    def validate(self, attrs):
        # On a partial update, the fuel flags that were not sent keep their current values.
        petrol = attrs.get("sells_petrol", self.instance.sells_petrol if self.instance else True)
        diesel = attrs.get("sells_diesel", self.instance.sells_diesel if self.instance else True)
        if not (petrol or diesel):
            raise serializers.ValidationError("Choose at least one fuel.")
        return attrs

    def get_tanks(self, pump):
        if pump.kind != PumpKind.POLICE:
            return []
        return TankSerializer(pump.tanks.all(), many=True).data

    def get_staff_count(self, pump):
        count = getattr(pump, "staff_count", None)  # set by the viewset's annotation
        if count is None:
            count = pump.staff.exclude(status__in=FORMER_STAFF).count()
        return count


class OwnUnitPumpField(serializers.PrimaryKeyRelatedField):
    """A pump of the requesting MTO's own unit; any other pump is refused as if it did not exist."""

    def get_queryset(self):
        return Pump.objects.filter(unit=self.context["request"].user.unit)


class PumpStaffSerializer(PersonSerializer):
    """Staff of a police pump or tie-up bunk: only a login ID, a name, a pump and a password are needed."""

    pump = OwnUnitPumpField(queryset=Pump.objects.none())
    pump_name = serializers.CharField(source="pump.name", read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "username", "full_name", "emp_id", "designation", "district", "cadre", "mobile", "pump",
            "pump_name", "status", "status_label", "password", "current_vehicles",
        ]
        read_only_fields = ["status"]
        extra_kwargs = {
            # Login IDs are compared in lowercase (see validate_username), so the model's exact-match check is dropped.
            "username": {
                "validators": [
                    UnicodeUsernameValidator(message="Use only letters, numbers and . @ + - _ in the login ID.")
                ]
            },
            "emp_id": {"required": False, "allow_null": True, "allow_blank": True, "validators": []},
            "designation": {"required": False, "allow_null": True},
            "district": {"required": False, "allow_null": True},
            "cadre": {"required": False, "allow_null": True},
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            self.fields["username"] = serializers.CharField(read_only=True)  # chosen once, at creation

    def validate_username(self, value):
        value = normalize_username(value)
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("This login ID is already taken.")
        return value

    def validate_emp_id(self, value):
        value = (value or "").strip().upper()
        if not value:
            return None  # stored as null, so any number of staff can have no Emp ID
        taken = User.objects.filter(emp_id=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("This Emp ID is already registered.")
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        staff = User(**validated_data)  # User.save lowercases the login ID
        staff.set_password(password)
        staff.save()
        return staff


class DirectoryPumpSerializer(serializers.ModelSerializer):
    """A pump as any logged-in user sees it when looking for somewhere to fill up."""

    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    district_name = serializers.CharField(source="district.name", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)
    petrol_available = serializers.SerializerMethodField()
    diesel_available = serializers.SerializerMethodField()

    class Meta:
        model = Pump
        fields = [
            "id", "name", "kind", "kind_label", "address", "district_name", "unit_name", "latitude", "longitude",
            "opening_hours", "sells_petrol", "sells_diesel", "petrol_available", "diesel_available",
        ]
        read_only_fields = fields

    def get_petrol_available(self, pump):
        return pump.fuel_available(FuelType.PETROL)

    def get_diesel_available(self, pump):
        return pump.fuel_available(FuelType.DIESEL)
