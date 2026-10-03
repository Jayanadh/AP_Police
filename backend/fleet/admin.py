from django.contrib import admin

from .models import OdometerReading, ServiceRecord, Vehicle, VehicleAssignment


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ("registration_number", "unit", "vehicle_type", "make", "model", "fuel_type", "status")
    list_filter = ("status", "fuel_type", "vehicle_type", "unit")
    search_fields = ("registration_number", "chassis_number", "engine_number")


@admin.register(VehicleAssignment)
class VehicleAssignmentAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "person", "kind", "started_at", "ended_at")
    list_filter = ("kind",)
    search_fields = ("vehicle__registration_number", "person__full_name", "person__emp_id")
    raw_id_fields = ("vehicle", "person", "assigned_by", "ended_by")


@admin.register(OdometerReading)
class OdometerReadingAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "week_of", "reading_km", "recorded_by")
    search_fields = ("vehicle__registration_number",)
    raw_id_fields = ("vehicle", "recorded_by")


@admin.register(ServiceRecord)
class ServiceRecordAdmin(admin.ModelAdmin):
    list_display = ("vehicle", "service_date", "odometer_km", "recorded_by")
    search_fields = ("vehicle__registration_number",)
    raw_id_fields = ("vehicle", "recorded_by")
