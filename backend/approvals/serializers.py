from rest_framework import serializers

from approvals.models import ApprovalRequest


class ApprovalSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    unit_name = serializers.CharField(source="unit.name", read_only=True)
    officer = serializers.SerializerMethodField()
    vehicle = serializers.SerializerMethodField()
    requested_by_name = serializers.CharField(source="requested_by.full_name", read_only=True)
    decided_by_name = serializers.CharField(source="decided_by.full_name", read_only=True, default=None)

    class Meta:
        model = ApprovalRequest
        fields = [
            "id", "kind", "kind_label", "unit", "unit_name", "status", "officer", "vehicle",
            "request_note", "requested_by_name", "requested_at", "decision_note",
            "decided_by_name", "decided_at",
        ]
        read_only_fields = fields

    def get_officer(self, approval):
        officer = approval.officer
        if officer is None:
            return None
        return {
            "id": officer.id,
            "full_name": officer.full_name,
            "emp_id": officer.emp_id,
            "designation_name": officer.designation.name if officer.designation else None,
            "mobile": officer.mobile,
        }

    def get_vehicle(self, approval):
        vehicle = approval.vehicle
        if vehicle is None:
            return None
        return {
            "id": vehicle.id,
            "registration_number": vehicle.registration_number,
            "vehicle_type": vehicle.vehicle_type,
            "make": vehicle.make,
            "model": vehicle.model,
        }


class DecisionSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, default="")
