from django.conf import settings
from rest_framework import serializers

from tracking.models import DutyTrip, LocationPoint
from tracking.services import BoardRow


class TripStartSerializer(serializers.Serializer):
    # Blank is let through so the service gives the one plain message for it.
    duty_particulars = serializers.CharField(max_length=1000, allow_blank=True, trim_whitespace=False)


class PointSerializer(serializers.Serializer):
    """One location as the phone reports it, with the phone's own time."""

    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    recorded_at = serializers.DateTimeField()
    accuracy = serializers.FloatField(min_value=0, max_value=100_000, required=False, allow_null=True)  # metres
    speed = serializers.FloatField(min_value=0, max_value=150, required=False, allow_null=True)  # metres a second
    heading = serializers.FloatField(min_value=0, max_value=360, required=False, allow_null=True)  # degrees


class PointBatchSerializer(serializers.Serializer):
    points = PointSerializer(many=True)

    def to_internal_value(self, data):
        # The batch's size is checked before a single location in it is read.
        points = data.get("points") if isinstance(data, dict) else None
        if isinstance(points, list):
            limit = settings.MTO_RULES["MAX_POINTS_PER_BATCH"]
            if not points:
                raise serializers.ValidationError({"points": ["Send at least one location."]})
            if len(points) > limit:
                raise serializers.ValidationError({"points": [f"Send at most {limit} locations at a time."]})
        return super().to_internal_value(data)


class TripSerializer(serializers.ModelSerializer):
    """A duty trip and where the vehicle was last seen on it."""

    driver_name = serializers.CharField(source="driver.full_name", read_only=True)
    registration_number = serializers.CharField(source="vehicle.registration_number", read_only=True)
    latitude = serializers.FloatField(source="last_latitude", read_only=True)
    longitude = serializers.FloatField(source="last_longitude", read_only=True)
    accuracy_m = serializers.FloatField(source="last_accuracy_m", read_only=True)

    class Meta:
        model = DutyTrip
        fields = [
            "id", "driver", "driver_name", "vehicle", "registration_number", "duty_particulars", "started_at",
            "ended_at", "end_reason", "last_point_at", "latitude", "longitude", "accuracy_m", "is_open",
        ]
        read_only_fields = fields


class PathPointSerializer(serializers.ModelSerializer):
    latitude = serializers.FloatField()
    longitude = serializers.FloatField()

    class Meta:
        model = LocationPoint
        fields = ["latitude", "longitude", "recorded_at"]
        read_only_fields = fields


def board_row(row: BoardRow) -> dict:
    """One driver on the MTO's live board: who, which vehicle, and the open trip if they are sharing."""
    driver, vehicle = row.driver, row.vehicle
    return {
        "driver": {"id": driver.id, "full_name": driver.full_name, "emp_id": driver.emp_id, "mobile": driver.mobile},
        "vehicle": vehicle and {
            "id": vehicle.id,
            "registration_number": vehicle.registration_number,
            "vehicle_name": f"{vehicle.make} {vehicle.model}".strip(),
        },
        "trip": row.trip and TripSerializer(row.trip).data,
    }
