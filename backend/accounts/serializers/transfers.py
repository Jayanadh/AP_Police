from rest_framework import serializers

from accounts.models import OfficerTransfer, Role, User


class OfficerLookupSerializer(serializers.ModelSerializer):
    """What a new MTO sees of an officer in another office, before asking for them."""

    designation_name = serializers.CharField(source="designation.name", read_only=True, default=None)
    unit_name = serializers.CharField(source="unit.name", read_only=True)

    class Meta:
        model = User
        fields = ["id", "full_name", "emp_id", "designation_name", "unit", "unit_name"]
        read_only_fields = fields


class TransferSerializer(serializers.ModelSerializer):
    officer_name = serializers.CharField(source="officer.full_name", read_only=True)
    officer_emp_id = serializers.CharField(source="officer.emp_id", read_only=True)
    from_unit_name = serializers.CharField(source="from_unit.name", read_only=True)
    to_unit_name = serializers.CharField(source="to_unit.name", read_only=True)

    class Meta:
        model = OfficerTransfer
        fields = [
            "id", "officer", "officer_name", "officer_emp_id", "from_unit", "from_unit_name",
            "to_unit", "to_unit_name", "note", "status", "requested_at", "decided_at",
        ]
        read_only_fields = fields


class TransferRequestSerializer(serializers.Serializer):
    officer = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=Role.OFFICER))
    note = serializers.CharField(required=False, allow_blank=True, default="")
