"""The fuel statement and the bunk statement as Excel files: the same figures the pages show, one sheet per table."""
from decimal import Decimal

from django.utils.text import slugify

from accounts.models import Role
from common.excel import Sheet, xlsx_response
from common.periods import Period
from fleet.models import FuelType
from fuel import report
from pumps.models import Pump, PumpKind


def fuel_statement(user, period: Period, unit_id: int | None = None):
    """Every fill of the caller's statement (date, vehicle, fuel and litres first), then its tables."""
    data = report.fuel_statement(user, period, unit_id)
    at_pump = user.role == Role.PUMP_OPERATOR
    fill_headers = ["Date", "Vehicle", "Fuel", "Litres", "Emergency (L)", "Driver", "Pump", "Office"]
    if not at_pump:
        fill_headers.append("Duty particulars")
    fills = []
    for fill in report.statement_fills(user, period, unit_id):
        row = [
            fill.filled_at, fill.vehicle.registration_number, _fuel(fill.fuel_type), fill.litres_filled,
            fill.emergency_litres, fill.driver.full_name, fill.pump.name if fill.pump else "", fill.vehicle.unit.name,
        ]
        if not at_pump:
            row.append(fill.duty_particulars)
        fills.append(row)

    sheets = [
        Sheet("Fills", fill_headers, fills),
        Sheet(
            "Totals",
            ["Period", "Fills", "Petrol (L)", "Diesel (L)", "Total (L)", "Emergency (L)"],
            [[
                data["label"], data["fills"], Decimal(data["petrol_litres"]), Decimal(data["diesel_litres"]),
                Decimal(data["litres"]), Decimal(data["emergency_litres"]),
            ]],
        ),
    ]
    if data["by_unit"] is not None:
        sheets.append(Sheet(
            "By office",
            ["Office", "Fills", "Petrol (L)", "Diesel (L)", "Total (L)", "Emergency (L)"],
            [
                [row["unit_name"], row["fills"], Decimal(row["petrol_litres"]), Decimal(row["diesel_litres"]),
                 Decimal(row["litres"]), Decimal(row["emergency_litres"])]
                for row in data["by_unit"]
            ],
        ))
    if data["by_vehicle"] is not None:
        sheets.append(Sheet(
            "By vehicle",
            ["Vehicle", "Office", "Fuel", "Fills", "Litres", "Emergency (L)"],
            [
                [row["registration_number"], row["unit_name"], _fuel(row["fuel_type"]), row["fills"],
                 Decimal(row["litres"]), Decimal(row["emergency_litres"])]
                for row in data["by_vehicle"]
            ],
        ))
    if data["by_pump"] is not None:
        sheets.append(Sheet(
            "By pump",
            ["Pump", "Kind", "Fills", "Litres"],
            [
                [row["pump_name"] or "", PumpKind(row["pump_kind"]).label if row["pump_kind"] else "", row["fills"],
                 Decimal(row["litres"])]
                for row in data["by_pump"]
            ],
        ))
    if data["stock"] is not None:
        sheets.append(Sheet(
            "Stock",
            ["Fuel", "Opening (L)", "Received (L)", "Filled (L)", "Measured change (L)", "Closing (L)"],
            [
                [_fuel(row["fuel_type"]), Decimal(row["opening_litres"]), Decimal(row["received_litres"]),
                 Decimal(row["dispensed_litres"]), Decimal(row["measured_change_litres"]),
                 Decimal(row["closing_litres"])]
                for row in data["stock"]
            ],
        ))
    return xlsx_response(f"fuel-statement-{_dates(period)}.xlsx", sheets)


def bunk_statement(pump: Pump, period: Period):
    """Every fill at `pump` in `period`, then its totals."""
    data = report.bunk_statement(pump, period)
    fills = [
        [fill.filled_at, fill.vehicle.registration_number, fill.vehicle.unit.name, fill.driver.full_name,
         _fuel(fill.fuel_type), fill.litres_filled]
        for fill in report.bunk_fills(pump, period)
    ]
    sheets = [
        Sheet("Fills", ["Date", "Vehicle", "Office", "Driver", "Fuel", "Litres"], fills),
        Sheet(
            "Totals",
            ["Bunk", "Office", "Period", "Fills", "Petrol (L)", "Diesel (L)", "Total (L)"],
            [[
                pump.name, pump.unit.name, data["label"], data["fills"], Decimal(data["petrol_litres"]),
                Decimal(data["diesel_litres"]), Decimal(data["litres"]),
            ]],
        ),
    ]
    return xlsx_response(f"bunk-statement-{slugify(pump.name) or pump.pk}-{_dates(period)}.xlsx", sheets)


def _fuel(fuel_type: str) -> str:
    return FuelType(fuel_type).label


def _dates(period: Period) -> str:
    return f"{period.start.isoformat()}-to-{period.end.isoformat()}"
