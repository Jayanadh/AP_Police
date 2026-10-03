from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import OfficerTransfer, Unit, User


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "district")
    search_fields = ("name", "code")


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("username", "full_name", "role", "unit", "status")
    list_filter = ("role", "status", "unit")
    search_fields = ("username", "full_name", "emp_id")
    fieldsets = DjangoUserAdmin.fieldsets + (
        (
            "MTO profile",
            {
                "fields": (
                    "full_name", "emp_id", "designation", "district", "cadre", "mobile",
                    "role", "unit", "pump", "status", "must_change_password",
                    "licence_number", "licence_valid_till",
                )
            },
        ),
    )
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (
        ("MTO profile", {"fields": ("full_name", "role", "unit", "pump")}),
    )


@admin.register(OfficerTransfer)
class OfficerTransferAdmin(admin.ModelAdmin):
    list_display = ("id", "officer", "from_unit", "to_unit", "status", "requested_at", "decided_at")
    list_filter = ("status", "from_unit", "to_unit")
    search_fields = ("officer__full_name", "officer__emp_id")
    raw_id_fields = ("officer", "requested_by", "decided_by")
