from rest_framework import serializers

from .models import Cadre, Designation, District

FIELDS = ["id", "name", "is_active"]


class DistrictSerializer(serializers.ModelSerializer):
    class Meta:
        model = District
        fields = FIELDS


class DesignationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Designation
        fields = FIELDS


class CadreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cadre
        fields = FIELDS
