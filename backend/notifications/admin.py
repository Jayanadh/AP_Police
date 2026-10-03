from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "recipient", "created_at", "read_at")
    list_filter = ("read_at",)
    search_fields = ("title", "recipient__username", "recipient__full_name")
    raw_id_fields = ("recipient",)
