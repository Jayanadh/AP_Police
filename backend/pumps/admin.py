from django.contrib import admin

from .models import Pump, PumpTank


class PumpTankInline(admin.TabularInline):
    model = PumpTank
    extra = 0


@admin.register(Pump)
class PumpAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "unit", "district", "sells_petrol", "sells_diesel", "is_active")
    list_filter = ("kind", "is_active", "unit")
    search_fields = ("name", "address")
    inlines = [PumpTankInline]
