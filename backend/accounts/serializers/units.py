from django.contrib.auth import password_validation
from django.db import transaction
from rest_framework import serializers

from accounts.models import Role, Unit, User, mobile_validator, normalize_username
from masters.models import Cadre, Designation


class ChairHolderSerializer(serializers.Serializer):
    """The person now holding an MTO chair, plus the password for the chair login."""

    full_name = serializers.CharField(max_length=150)
    emp_id = serializers.CharField(max_length=30)
    designation = serializers.PrimaryKeyRelatedField(queryset=Designation.objects.all())
    cadre = serializers.PrimaryKeyRelatedField(queryset=Cadre.objects.all())
    mobile = serializers.CharField(max_length=10, required=False, allow_blank=True, validators=[mobile_validator])
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_emp_id(self, value):
        value = value.strip().upper()
        taken = User.objects.filter(emp_id=value)
        chair = self.context.get("chair")
        if chair is not None:
            taken = taken.exclude(pk=chair.pk)
        if taken.exists():
            raise serializers.ValidationError("This Emp ID already has a login.")
        return value

    def validate_password(self, value):
        password_validation.validate_password(value)
        return value


class NewChairSerializer(ChairHolderSerializer):
    username = serializers.CharField(max_length=150)

    def validate_username(self, value):
        value = normalize_username(value)
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("This login ID is already taken.")
        return value


class UnitSerializer(serializers.ModelSerializer):
    district_name = serializers.CharField(source="district.name", read_only=True)
    mto = serializers.SerializerMethodField()

    class Meta:
        model = Unit
        fields = ["id", "name", "code", "district", "district_name", "address", "phone", "mto"]
        extra_kwargs = {"code": {"validators": []}}

    def validate_code(self, value):
        value = value.strip().upper()
        clash = Unit.objects.filter(code=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("Another MTO office already uses this code.")
        return value

    def get_mto(self, unit):
        chair = unit.members.filter(role=Role.MTO).first()
        if chair is None:
            return None
        return {
            "id": chair.id,
            "username": chair.username,
            "full_name": chair.full_name,
            "emp_id": chair.emp_id,
            "mobile": chair.mobile,
        }


class UnitCreateSerializer(UnitSerializer):
    mto_account = NewChairSerializer(write_only=True)

    class Meta(UnitSerializer.Meta):
        fields = UnitSerializer.Meta.fields + ["mto_account"]

    @transaction.atomic
    def create(self, validated_data):
        holder = dict(validated_data.pop("mto_account"))
        password = holder.pop("password")
        unit = Unit.objects.create(**validated_data)
        chair = User(role=Role.MTO, unit=unit, district=unit.district, must_change_password=True, **holder)
        chair.set_password(password)
        chair.save()
        return unit
