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
    """The caller's statement as the page shows it: the fills (date first), the totals, then the other tables."""
    data = report.fuel_statement(user, period, unit_id)
    if user.role == Role.PUMP_OPERATOR:
        sheets = _pump_fills_and_totals(user, period, data)
    elif user.role in (Role.DRIVER, Role.OFFICER):
        sheets = _own_fills_and_totals(user, period, data)
    else:
        sheets = _office_fills_and_totals(user, period, unit_id, data)
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
            ["Fuel", "Opening (L)", "Received (L)", "Filled (L)", "Closing (L)"],
            [
                [_fuel(row["fuel_type"]), Decimal(row["opening_litres"]), Decimal(row["received_litres"]),
                 Decimal(row["dispensed_litres"]), Decimal(row["closing_litres"])]
                for row in data["stock"]
            ],
        ))
    return xlsx_response(f"fuel-statement-{period.file_part}.xlsx", sheets)


def _office_fills_and_totals(user, period: Period, unit_id: int | None, data: dict) -> list[Sheet]:
    """The MTO's and the PTO's: every column, and the totals with the emergency litres."""
    fills = [
        [
            fill.filled_at, fill.vehicle.registration_number, _fuel(fill.fuel_type), fill.litres_filled,
            fill.emergency_litres, fill.driver.full_name, fill.pump.name if fill.pump else "", fill.vehicle.unit.name,
            fill.duty_particulars,
        ]
        for fill in report.statement_fills(user, period, unit_id)
    ]
    return [
        Sheet(
            "Fills",
            ["Date", "Vehicle", "Fuel", "Litres", "Emergency (L)", "Driver", "Pump", "Office", "Duty particulars"],
            fills,
        ),
        Sheet(
            "Totals",
            ["Period", "Fills", "Petrol (L)", "Diesel (L)", "Total (L)", "Emergency (L)"],
            [[
                data["label"], data["fills"], Decimal(data["petrol_litres"]), Decimal(data["diesel_litres"]),
                Decimal(data["litres"]), Decimal(data["emergency_litres"]),
            ]],
        ),
    ]


def _own_fills_and_totals(user, period: Period, data: dict) -> list[Sheet]:
    """An officer's or a driver's: the fills of their own vehicles, so no vehicle or fuel columns."""
    fills = [
        [fill.filled_at, fill.litres_filled, fill.emergency_litres, fill.pump.name if fill.pump else "",
         fill.duty_particulars or None]
        for fill in report.statement_fills(user, period)
    ]
    return [
        Sheet("Fills", ["Date", "Litres", "Emergency (L)", "Pump", "Duty particulars"], fills),
        Sheet(
            "Totals",
            ["Period", "Fills", "Total (L)", "Emergency (L)"],
            [[data["label"], data["fills"], Decimal(data["litres"]), Decimal(data["emergency_litres"])]],
        ),
    ]


def _pump_fills_and_totals(user, period: Period, data: dict) -> list[Sheet]:
    """A pump's staff's: each fill with the vehicle's officer; emergencies do not matter at the pump."""
    fills = [
        [fill.filled_at, fill.vehicle.registration_number, _fuel(fill.fuel_type), fill.litres_filled,
         fill.officer_name]
        for fill in report.pump_fills(user.pump_id, period).order_by("filled_at", "id")
    ]
    return [
        Sheet("Fills", ["Date", "Vehicle", "Fuel", "Litres", "Officer"], fills),
        Sheet(
            "Totals",
            ["Period", "Fills", "Petrol (L)", "Diesel (L)", "Total (L)"],
            [[
                data["label"], data["fills"], Decimal(data["petrol_litres"]), Decimal(data["diesel_litres"]),
                Decimal(data["litres"]),
            ]],
        ),
    ]


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
    return xlsx_response(f"bunk-statement-{slugify(pump.name) or pump.pk}-{period.file_part}.xlsx", sheets)


def _fuel(fuel_type: str) -> str:
    return FuelType(fuel_type).label
