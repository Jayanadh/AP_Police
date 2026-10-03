from django.contrib import admin

from .models import FuelGrant, FuelRequest


@admin.register(FuelGrant)
class FuelGrantAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "month", "litres", "approved_by", "created_by", "created_at")
    list_filter = ("month",)
    search_fields = ("vehicle__registration_number", "approved_by")
    raw_id_fields = ("vehicle", "created_by")


@admin.register(FuelRequest)
class FuelRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "vehicle", "driver", "fuel_type", "litres_requested", "status", "issued_at", "pump")
    list_filter = ("status", "fuel_type", "is_emergency", "emergency_status")
    search_fields = ("vehicle__registration_number", "driver__full_name")
    raw_id_fields = ("vehicle", "driver", "pump", "filled_by", "stock_entry", "emergency_reviewed_by")
