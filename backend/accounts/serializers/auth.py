from django.contrib.auth import password_validation
from rest_framework import serializers

from accounts.models import DeviceToken, User


class MeSerializer(serializers.ModelSerializer):
    unit_name = serializers.CharField(source="unit.name", read_only=True, default=None)
    designation_name = serializers.CharField(source="designation.name", read_only=True, default=None)
    district_name = serializers.CharField(source="district.name", read_only=True, default=None)
    cadre_name = serializers.CharField(source="cadre.name", read_only=True, default=None)
    pump_name = serializers.CharField(source="pump.name", read_only=True, default=None)
    pump_kind = serializers.CharField(source="pump.kind", read_only=True, default=None)

    class Meta:
        model = User
        fields = [
            "id", "username", "full_name", "emp_id", "role", "status", "unit", "unit_name",
            "designation_name", "district_name", "cadre_name", "mobile", "must_change_password",
            "pump", "pump_name", "pump_kind",
        ]
        read_only_fields = fields


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)


class DeviceSignInSerializer(LoginSerializer):
    device_name = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")


class DeviceTokenSerializer(serializers.ModelSerializer):
    user = MeSerializer(read_only=True)

    class Meta:
        model = DeviceToken
        fields = ["expires_at", "user"]
        read_only_fields = fields


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)

    def validate_new_password(self, value):
        password_validation.validate_password(value, self.context["request"].user)
        return value
