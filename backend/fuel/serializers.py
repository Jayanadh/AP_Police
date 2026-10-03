from pathlib import PurePath

from django.conf import settings
from rest_framework import serializers
from rest_framework.reverse import reverse

from common.exceptions import BusinessRuleError
from common.months import MONTH_FORMAT_MESSAGE, current_month, format_month, next_month, parse_month
from fleet.models import Vehicle, VehicleStatus
from fuel.models import FuelGrant, FuelRequest, RequestStatus
from fuel.quota import Quota, fmt
from fuel.requests import duty_due_at, duty_overdue
from pumps.models import Pump

# How a real file of each accepted kind starts. The letter is checked against its name, so a web page or a program
# renamed to "letter.pdf" is refused rather than stored.
LETTER_SIGNATURES = {
    ".pdf": b"%PDF-",
    ".png": b"\x89PNG\r\n\x1a\n",
    ".jpg": b"\xff\xd8\xff",
    ".jpeg": b"\xff\xd8\xff",
}


class MonthField(serializers.Field):
    """A month written "YYYY-MM"; held as the first day of that month."""

    default_error_messages = {"invalid": MONTH_FORMAT_MESSAGE}

    def to_internal_value(self, data):
        if not isinstance(data, str) or not data.strip():
            self.fail("invalid")  # parse_month would read an empty month as "this month"
        try:
            return parse_month(data)
        except BusinessRuleError:
            self.fail("invalid")

    def to_representation(self, value):
        return format_month(value)


class OwnUnitVehicleField(serializers.PrimaryKeyRelatedField):
    """A vehicle of the requesting MTO's own unit, not terminated; any other is refused as if it did not exist."""

    def get_queryset(self):
        return Vehicle.objects.filter(unit=self.context["request"].user.unit).exclude(
            status=VehicleStatus.TERMINATED
        )


class FuelGrantSerializer(serializers.ModelSerializer):
    """Additional quota for a vehicle. The viewset sets `created_by`; the letter is write-only (see `letter_url`)."""

    vehicle = OwnUnitVehicleField(queryset=Vehicle.objects.none())
    registration_number = serializers.CharField(source="vehicle.registration_number", read_only=True)
    month = MonthField()
    letter = serializers.FileField(write_only=True)
    letter_url = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model = FuelGrant
        fields = [
            "id", "vehicle", "registration_number", "month", "litres", "approved_by", "letter", "note",
            "letter_url", "created_by_name", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_month(self, value):
        if value not in (current_month(), next_month(current_month())):
            raise serializers.ValidationError("Additional quota can be added for this month or next month only.")
        return value

    def validate_litres(self, value):
        if value <= 0:
            raise serializers.ValidationError("Enter litres greater than 0.")
        return value

    def validate_letter(self, value):
        signature = LETTER_SIGNATURES.get(PurePath(value.name).suffix.lower())
        if signature is None:
            raise serializers.ValidationError("Upload the letter as JPG, PNG or PDF.")
        if value.size > settings.MTO_RULES["LETTER_MAX_BYTES"]:
            raise serializers.ValidationError("The letter must be 5 MB or smaller.")
        value.seek(0)
        start = value.read(len(signature))
        value.seek(0)
        if start != signature:
            raise serializers.ValidationError(
                "This file is not a real JPG, PNG or PDF. Upload the scanned letter itself."
            )
        return value

    def get_letter_url(self, grant):
        return reverse("fuel-grant-letter", args=[grant.pk])


def quota_payload(quota: Quota) -> dict:
    """The quota as the API shows it: the month as "YYYY-MM", litres as two-decimal strings."""
    return {
        "month": format_month(quota.month),
        "base_litres": fmt(quota.base_litres),
        "additional_litres": fmt(quota.additional_litres),
        "limit_litres": fmt(quota.limit_litres),
        "used_litres": fmt(quota.used_litres),
        "remaining_litres": fmt(quota.remaining_litres),
        "emergency_used_litres": fmt(quota.emergency_used_litres),
        "emergency_remaining_litres": fmt(quota.emergency_remaining_litres),
        "additional_balance_litres": fmt(quota.additional_balance_litres),
    }


class FuelRequestSerializer(serializers.ModelSerializer):
    """A fuel request as the driver, officer, MTO and PTO see it. The PIN is shown only to the driver who raised the
    request, and only while it is open."""

    registration_number = serializers.CharField(source="vehicle.registration_number", read_only=True)
    driver_name = serializers.CharField(source="driver.full_name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    pin = serializers.SerializerMethodField()
    pump_name = serializers.CharField(source="pump.name", read_only=True, allow_null=True)
    pump_kind = serializers.CharField(source="pump.kind", read_only=True, allow_null=True)
    emergency_status_label = serializers.CharField(source="get_emergency_status_display", read_only=True)
    duty_due_at = serializers.SerializerMethodField()
    duty_overdue = serializers.SerializerMethodField()

    class Meta:
        model = FuelRequest
        fields = [
            "id", "vehicle", "registration_number", "driver", "driver_name", "fuel_type", "litres_requested",
            "is_emergency", "emergency_reason", "status", "status_label", "issued_at", "expires_at", "pin",
            "failed_pin_attempts", "cancel_reason", "pump", "pump_name", "pump_kind", "filled_at", "litres_filled",
            "emergency_litres", "emergency_status", "emergency_status_label", "duty_particulars",
            "duty_submitted_at", "duty_due_at", "duty_overdue",
        ]
        read_only_fields = fields

    def get_pin(self, fuel_request):
        request = self.context.get("request")  # without one there is no telling who is asking: show no PIN
        shown = (
            request is not None
            and fuel_request.status == RequestStatus.ISSUED
            and fuel_request.driver_id == request.user.pk
        )
        return fuel_request.pin if shown else None

    def get_duty_due_at(self, fuel_request):
        due = duty_due_at(fuel_request)
        return None if due is None else serializers.DateTimeField().to_representation(due)

    def get_duty_overdue(self, fuel_request):
        return duty_overdue(fuel_request)


PICK_A_PUMP = "Pick the pump you will fill at."


class FuelRequestCreateSerializer(serializers.Serializer):
    """What a driver sends to raise a request. The rules that need the vehicle and its quota are in `fuel.requests`."""

    pump = serializers.PrimaryKeyRelatedField(
        queryset=Pump.objects.all(),
        error_messages={key: PICK_A_PUMP for key in ("required", "null", "does_not_exist", "incorrect_type")},
    )
    litres = serializers.DecimalField(max_digits=6, decimal_places=2)
    is_emergency = serializers.BooleanField(default=False)
    emergency_reason = serializers.CharField(allow_blank=True, default="")

    def validate_litres(self, value):
        if value <= 0:
            raise serializers.ValidationError("Enter litres greater than 0.")
        return value


class DutySerializer(serializers.Serializer):
    """What a driver sends as the duty particulars of a fill. A blank or missing entry is refused by
    `fuel.requests.submit_duty` with its message."""

    duty_particulars = serializers.CharField(allow_blank=True, default="")


class IncomingRequestSerializer(serializers.ModelSerializer):
    """A request waiting at the pump, as its staff see it in the list: who is coming, but not the litres or the PIN."""

    registration_number = serializers.CharField(source="vehicle.registration_number", read_only=True)
    vehicle_name = serializers.SerializerMethodField()
    driver_name = serializers.CharField(source="driver.full_name", read_only=True)
    driver_mobile = serializers.CharField(source="driver.mobile", read_only=True)

    class Meta:
        model = FuelRequest
        fields = [
            "id", "vehicle", "registration_number", "vehicle_name", "driver_name", "driver_mobile", "fuel_type",
            "is_emergency", "issued_at", "expires_at",
        ]
        read_only_fields = fields

    def get_vehicle_name(self, fuel_request):
        return f"{fuel_request.vehicle.make} {fuel_request.vehicle.model}".strip()


class CheckedRequestSerializer(IncomingRequestSerializer):
    """The same request once the driver's PIN was right: now with the litres to fill."""

    class Meta(IncomingRequestSerializer.Meta):
        fields = IncomingRequestSerializer.Meta.fields + ["litres_requested", "emergency_reason"]
        read_only_fields = fields


class PinSerializer(serializers.Serializer):
    """The driver's PIN as the pump's staff type it. More than 6 characters is refused here, so a slip of the finger
    does not use up one of the driver's attempts."""

    pin = serializers.CharField(max_length=6)
