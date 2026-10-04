"""A police pump's stock entries as an Excel file: one sheet per fuel, the entries of a period oldest first."""
from django.utils.text import slugify

from common.excel import Sheet, xlsx_response
from common.periods import Period
from fleet.models import FuelType
from pumps.models import Pump, PumpTank

HEADERS = ["When", "Entry", "Litres", "Stock before (L)", "Stock after (L)", "Note", "By"]
FUEL_ORDER = list(FuelType)


def stock_entries(pump: Pump, tanks: list[PumpTank], period: Period):
    start, end = period.bounds()
    sheets = []
    for tank in sorted(tanks, key=lambda tank: FUEL_ORDER.index(tank.fuel_type)):
        entries = (
            tank.entries.filter(recorded_at__gte=start, recorded_at__lt=end)
            .select_related("recorded_by")
            .order_by("recorded_at", "id")
        )
        rows = [
            [
                entry.recorded_at, entry.get_kind_display(), entry.litres, entry.stock_before, entry.stock_after,
                entry.note or None, entry.recorded_by.full_name,
            ]
            for entry in entries
        ]
        sheets.append(Sheet(FuelType(tank.fuel_type).label, HEADERS, rows))
    return xlsx_response(f"stock-{slugify(pump.name) or pump.pk}-{period.file_part}.xlsx", sheets)
