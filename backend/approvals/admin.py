from django.contrib import admin

from .models import ApprovalRequest


@admin.register(ApprovalRequest)
class ApprovalRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "kind", "unit", "officer", "vehicle", "status", "requested_at", "decided_at")
    list_filter = ("kind", "status", "unit")
    search_fields = ("officer__full_name", "officer__emp_id", "vehicle__registration_number")
    raw_id_fields = ("officer", "vehicle", "requested_by", "decided_by")
