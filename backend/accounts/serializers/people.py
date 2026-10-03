from django.contrib.auth import password_validation
from django.db.models import QuerySet
from rest_framework import serializers

from accounts.models import User, normalize_username
from fleet.models import VehicleAssignment


def current_vehicle_links() -> QuerySet[VehicleAssignment]:
    """Open vehicle links with their vehicle, in registration order."""
    return (
        VehicleAssignment.objects.filter(ended_at__isnull=True)
        .select_related("vehicle")
        .order_by("vehicle__registration_number")
    )


class PersonSerializer(serializers.ModelSerializer):
    """An officer or a driver, as the MTO sees them. The viewset decides role, unit and status."""

    status_label = serializers.CharField(source="get_status_display", read_only=True)
    designation_name = serializers.CharField(source="designation.name", read_only=True)
    district_name = serializers.CharField(source="district.name", read_only=True)
    cadre_name = serializers.CharField(source="cadre.name", read_only=True)
    current_vehicles = serializers.SerializerMethodField()
    # Only used to create a person (the MTO sets a first password). Later changes go through reset-password.
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    class Meta:
        model = User
        fields = [
            "id", "username", "full_name", "emp_id", "designation", "designation_name", "district",
            "district_name", "cadre", "cadre_name", "mobile", "status", "status_label",
            "licence_number", "licence_valid_till", "password", "current_vehicles",
        ]
        read_only_fields = ["username", "status"]
        extra_kwargs = {
            # Every police person has these five; the model allows blanks only for pump staff.
            "emp_id": {"required": True, "allow_null": False, "allow_blank": False, "validators": []},
            "designation": {"required": True, "allow_null": False},
            "district": {"required": True, "allow_null": False},
            "cadre": {"required": True, "allow_null": False},
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance is not None:
            del self.fields["password"]  # ignored on update

    def validate_emp_id(self, value):
        value = value.strip().upper()
        taken = User.objects.filter(emp_id=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("This Emp ID is already registered.")
        if self.instance is None and User.objects.filter(username=normalize_username(value)).exists():
            raise serializers.ValidationError("A login with this Emp ID already exists.")
        return value

    def validate_password(self, value):
        password_validation.validate_password(value)
        return value

    def get_current_vehicles(self, person):
        links = getattr(person, "current_links", None)  # set by the viewset's prefetch
        if links is None:
            links = current_vehicle_links().filter(person=person)
        return [{"id": link.vehicle.id, "registration_number": link.vehicle.registration_number} for link in links]

    def create(self, validated_data):
        password = validated_data.pop("password")
        person = User(username=normalize_username(validated_data["emp_id"]), **validated_data)
        person.set_password(password)
        person.save()
        return person


class PasswordResetSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False)

    def validate_password(self, value):
        password_validation.validate_password(value)
        return value
