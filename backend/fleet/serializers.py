from django.utils import timezone
from rest_framework import serializers

from accounts.models import User
from fleet import services
from fleet.models import (
    AssignmentKind,
    OdometerReading,
    ServiceRecord,
    Vehicle,
    VehicleAssignment,
    normalize_registration,
)

MIN_YEAR = 1980
MAX_ODOMETER_KM = 9_999_999  # far beyond any real odometer; keeps a typo from overflowing the database


class VehicleSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    current_officer = serializers.SerializerMethodField()
    current_driver = serializers.SerializerMethodField()

    class Meta:
        model = Vehicle
        fields = [
            "id", "registration_number", "vehicle_type", "make", "model", "year_of_manufacture",
            "fuel_type", "tank_capacity_litres", "chassis_number", "engine_number",
            "odometer_at_onboarding_km", "monthly_fuel_limit_litres", "service_interval_km",
            "service_interval_days", "status", "status_label", "current_officer", "current_driver",
            "created_at",
        ]
        read_only_fields = ["status", "created_at"]
        extra_kwargs = {
            # The checks that matter run on the normalized value (length, uniqueness), not on what was typed.
            "registration_number": {"validators": [], "max_length": None},
            # Our own range check gives the one message, instead of DRF's generic min/max ones.
            "year_of_manufacture": {"min_value": None, "max_value": None},
            "service_interval_km": {"min_value": None},  # so 0 and negatives share one message
            "service_interval_days": {"min_value": None},
        }

    def validate_registration_number(self, value):
        value = normalize_registration(value)
        if not 6 <= len(value) <= 12:
            raise serializers.ValidationError("Enter a valid registration number, e.g. AP39PA1234.")
        clash = Vehicle.objects.filter(registration_number=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A vehicle with this registration number already exists.")
        return value

    def validate_tank_capacity_litres(self, value):
        if value <= 0:
            raise serializers.ValidationError("Tank capacity must be more than 0.")
        return value

    def validate_monthly_fuel_limit_litres(self, value):
        if value < 0:
            raise serializers.ValidationError("The monthly limit can't be negative.")
        return value

    def validate_year_of_manufacture(self, value):
        if value is not None and not MIN_YEAR <= value <= timezone.localdate().year:
            raise serializers.ValidationError("Enter a valid year.")
        return value

    def _validate_interval(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("Use a number greater than 0.")
        return value

    validate_service_interval_km = _validate_interval
    validate_service_interval_days = _validate_interval

    def _link(self, vehicle, kind):
        links = getattr(vehicle, "current_links", None)  # set by current_links_prefetch()
        if links is None:
            links = services.current_links(vehicle)
        for link in links:
            if link.kind == kind:
                person = link.person
                return {
                    "assignment_id": link.id,
                    "id": person.id,
                    "full_name": person.full_name,
                    "emp_id": person.emp_id,
                    "mobile": person.mobile,
                }
        return None

    def get_current_officer(self, vehicle):
        return self._link(vehicle, AssignmentKind.OFFICER)

    def get_current_driver(self, vehicle):
        return self._link(vehicle, AssignmentKind.DRIVER)


class TerminationRequestSerializer(serializers.Serializer):
    note = serializers.CharField()  # why the vehicle should be terminated; the PTO reads it


class AssignmentSerializer(serializers.ModelSerializer):
    """A vehicle link, current or ended. Read-only: links are made and ended through the service functions."""

    person_name = serializers.CharField(source="person.full_name", read_only=True)
    person_emp_id = serializers.CharField(source="person.emp_id", read_only=True)
    assigned_by_name = serializers.CharField(source="assigned_by.full_name", read_only=True)
    ended_by_name = serializers.CharField(source="ended_by.full_name", read_only=True, allow_null=True)

    class Meta:
        model = VehicleAssignment
        fields = [
            "id", "vehicle", "person", "person_name", "person_emp_id", "kind", "started_at", "ended_at",
            "assigned_by_name", "ended_by_name",
        ]
        read_only_fields = fields


class AssignSerializer(serializers.Serializer):
    """Who to link to a vehicle. Needs `request` in the context: only people of the caller's unit are accepted."""

    person = serializers.PrimaryKeyRelatedField(queryset=User.objects.none())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["person"].queryset = User.objects.filter(unit=self.context["request"].user.unit)


class MyVehicleSerializer(VehicleSerializer):
    """A vehicle as its officer or driver sees it, with the lowest odometer reading it may take next. Needs
    `latest_odometer_km` on the instance (see `odometer.with_latest_odometer_km`)."""

    latest_odometer_km = serializers.IntegerField(read_only=True)

    class Meta(VehicleSerializer.Meta):
        fields = [*VehicleSerializer.Meta.fields, "latest_odometer_km"]


class OdometerSubmitSerializer(serializers.Serializer):
    reading_km = serializers.IntegerField(min_value=0, max_value=MAX_ODOMETER_KM)


class OdometerReadingSerializer(serializers.ModelSerializer):
    """A Sunday reading. Read-only: readings are made through `record_reading`. Needs `previous_km` on the instance
    (see `readings_with_previous`) to show the distance since the vehicle's reading of the week before."""

    registration_number = serializers.CharField(source="vehicle.registration_number", read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.full_name", read_only=True)
    km_since_previous = serializers.SerializerMethodField()

    class Meta:
        model = OdometerReading
        fields = [
            "id", "vehicle", "registration_number", "week_of", "reading_km", "km_since_previous",
            "recorded_by_name", "created_at",
        ]
        read_only_fields = fields

    def get_km_since_previous(self, reading):
        previous = getattr(reading, "previous_km", None)
        return None if previous is None else reading.reading_km - previous


class ServiceRecordSerializer(serializers.ModelSerializer):
    """A service of a vehicle. The viewset records it through `record_service`, which checks the date."""

    recorded_by_name = serializers.CharField(source="recorded_by.full_name", read_only=True)

    class Meta:
        model = ServiceRecord
        fields = ["id", "vehicle", "service_date", "odometer_km", "notes", "recorded_by_name", "created_at"]
        read_only_fields = ["vehicle", "created_at"]
        extra_kwargs = {"odometer_km": {"max_value": MAX_ODOMETER_KM}}
