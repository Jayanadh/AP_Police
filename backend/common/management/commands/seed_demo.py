"""Demo data for trying the app: a PTO, two MTO offices with people, vehicles and pumps, all on one shared password,
and last month's fills at the tie-up bunks so the statements have something to show.

Safe to run again: everything is found by its natural key (login ID, office code, registration number, pump name) and
created only when missing. A run puts every demo password back to `DEMO_PASSWORD`; it never measures a pump that
already exists, so stock changed by fills is left alone, and it adds the history only to a database with no fills.
"""
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Role, Unit, User
from common.exceptions import BusinessRuleError
from common.months import IST, current_month
from common.periods import month_period
from fleet import services as fleet_services
from fleet.models import AssignmentKind, FuelType, Vehicle, VehicleAssignment, VehicleType
from fuel import requests
from fuel.models import FuelRequest, RequestStatus
from masters.models import Cadre, Designation, District
from pumps import services as pump_services
from pumps import stock
from pumps.models import Pump, PumpKind

DEMO_PASSWORD = "Demo-pass-2026"

PETROL, DIESEL = FuelType.PETROL, FuelType.DIESEL
SERVICE_EVERY_KM, SERVICE_EVERY_DAYS = 5000, 180

# login ID -> (full name, designation, cadre, Emp ID)
PEOPLE = {
    "mto.nellore": ("K. Ramesh Babu", "Reserve Inspector", "Armed Reserve", "AP2001"),
    "mto.guntur": ("M. Srinivasa Reddy", "Reserve Inspector", "Armed Reserve", "AP2002"),
    "ap3001": ("S. Venkata Rao", "Inspector of Police", "Civil", "AP3001"),
    "ap3002": ("P. Lakshmi Narayana", "Deputy Superintendent of Police", "Civil", "AP3002"),
    "ap3101": ("B. Anil Kumar", "Inspector of Police", "Civil", "AP3101"),
    "ap4001": ("Ravi Kumar", "Police Constable", "Armed Reserve", "AP4001"),
    "ap4002": ("Shaik Imran", "Head Constable", "Armed Reserve", "AP4002"),
    "ap4101": ("G. Prasad", "Police Constable", "Armed Reserve", "AP4101"),
}

OFFICES = [
    {
        "code": "NLR",
        "name": "SPSR Nellore MTO",
        "district": "Sri Potti Sriramulu Nellore",
        "chair": "mto.nellore",
        "officers": ["ap3001", "ap3002"],
        "drivers": ["ap4001", "ap4002"],
        "vehicles": [
            {
                "registration_number": "AP39PA1001", "vehicle_type": VehicleType.JEEP, "make": "Mahindra",
                "model": "Bolero", "year_of_manufacture": 2022, "fuel_type": DIESEL, "tank_capacity_litres": 60,
                "monthly_fuel_limit_litres": 150, "people": ("ap3001", "ap4001"),
            },
            {
                "registration_number": "AP39PA1002", "vehicle_type": VehicleType.CAR, "make": "Toyota",
                "model": "Innova", "year_of_manufacture": 2023, "fuel_type": DIESEL, "tank_capacity_litres": 55,
                "monthly_fuel_limit_litres": 120, "people": ("ap3002", "ap4002"),
            },
        ],
        "pumps": [
            {
                "name": "Nellore DPO Police Pump", "kind": PumpKind.POLICE, "staff": "pump.nlr.police",
                "address": "DPO Campus, Stonehousepet, Nellore", "latitude": "14.4426", "longitude": "79.9865",
                "stock": {PETROL: 500, DIESEL: 400},
            },
            {
                "name": "Sri Venkateswara Fuels", "kind": PumpKind.TIE_UP, "staff": "pump.nlr.tieup",
                "address": "Trunk Road, Nellore", "latitude": "14.4500", "longitude": "79.9900",
                "sells": (PETROL, DIESEL),
            },
        ],
    },
    {
        "code": "GNT",
        "name": "Guntur MTO",
        "district": "Guntur",
        "chair": "mto.guntur",
        "officers": ["ap3101"],
        "drivers": ["ap4101"],
        "vehicles": [
            {
                "registration_number": "AP07PB2001", "vehicle_type": VehicleType.CAR, "make": "Maruti Suzuki",
                "model": "Swift", "year_of_manufacture": 2021, "fuel_type": PETROL, "tank_capacity_litres": 37,
                "monthly_fuel_limit_litres": 80, "people": ("ap3101", "ap4101"),
            },
        ],
        "pumps": [
            {
                "name": "Guntur Police Pump", "kind": PumpKind.POLICE, "staff": "pump.gnt.police",
                "address": "Police Lines, Arundelpet, Guntur", "latitude": "16.3067", "longitude": "80.4365",
                "stock": {PETROL: 300, DIESEL: 90},  # diesel is below 100 L, so the low-stock alert shows
            },
            {
                "name": "Krishna Fuel Point", "kind": PumpKind.TIE_UP, "staff": "pump.gnt.tieup",
                "address": "Brodipet, Guntur", "latitude": "16.3100", "longitude": "80.4400",
                "sells": (PETROL,),
            },
        ],
    },
]


# Last month at the tie-up bunks: (registration, bunk, day of the month, litres, the duty particulars written for it).
HISTORY = [
    ("AP39PA1001", "Sri Venkateswara Fuels", 5, "40", "Night patrol, Nellore town and Kavali highway"),
    ("AP07PB2001", "Krishna Fuel Point", 8, "25", "Court duty, Guntur"),
    ("AP39PA1002", "Sri Venkateswara Fuels", 12, "30", "VIP escort, Nellore to Gudur"),
    ("AP39PA1001", "Sri Venkateswara Fuels", 19, "35", "Festival bandobast, Nellore"),
]


class Command(BaseCommand):
    help = "Create demo offices, people, vehicles and pumps (development only), and print the logins."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Run even when DEBUG is off.")

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError("seed_demo is for development. Use --force to run it anyway.")
        with transaction.atomic():
            logins = [(self._pto(), "All offices")]
            for office in OFFICES:
                logins += self._office(office)
            self._history()
        self._print(logins)

    def _pto(self):
        pto, _ = User.objects.get_or_create(
            username="pto",
            defaults={"full_name": "State PTO", "role": Role.PTO, "is_superuser": True, "is_staff": True},
        )
        return self._settle(pto)

    def _office(self, office):
        unit, _ = Unit.objects.get_or_create(
            code=office["code"], defaults={"name": office["name"], "district": _master(District, office["district"])}
        )
        chair = self._person(office["chair"], Role.MTO, unit)
        people = [chair]
        people += [self._person(login, Role.OFFICER, unit) for login in office["officers"]]
        people += [self._person(login, Role.DRIVER, unit) for login in office["drivers"]]
        for vehicle in office["vehicles"]:
            self._vehicle(unit, chair, vehicle)
        logins = [(person, unit.name) for person in people]
        for pump in office["pumps"]:
            logins.append((self._pump(unit, pump), pump["name"]))
        return logins

    def _person(self, login, role, unit):
        full_name, designation, cadre, emp_id = PEOPLE[login]
        fields = {
            "full_name": full_name,
            "role": role,
            "unit": unit,
            "emp_id": emp_id,
            "designation": _master(Designation, designation),
            "cadre": _master(Cadre, cadre),
            "district": unit.district,
        }
        if role == Role.DRIVER:
            fields.update(licence_number=f"AP03{emp_id[2:]:0>11}", licence_valid_till=date(2031, 3, 31))
        person, _ = User.objects.get_or_create(username=login, defaults=fields)
        return self._settle(person)

    def _settle(self, user):
        """Every demo login uses the shared password and never has to change it."""
        user.set_password(DEMO_PASSWORD)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        return user

    def _vehicle(self, unit, chair, details):
        details = dict(details)
        officer, driver = details.pop("people")
        vehicle, _ = Vehicle.objects.get_or_create(
            registration_number=details.pop("registration_number"),
            defaults={
                "unit": unit,
                "service_interval_km": SERVICE_EVERY_KM,
                "service_interval_days": SERVICE_EVERY_DAYS,
                **details,
            },
        )
        for login in (officer, driver):
            self._link(vehicle, User.objects.get(username=login), chair)

    def _link(self, vehicle, person, chair):
        if VehicleAssignment.objects.filter(vehicle=vehicle, person=person, ended_at__isnull=True).exists():
            return
        try:
            fleet_services.assign_person(vehicle, person, chair)
        except BusinessRuleError as refusal:  # e.g. the demo was changed by hand since the last run
            self.stdout.write(self.style.WARNING(f"Not linked {person.username} to {vehicle}: {refusal.detail}"))

    def _pump(self, unit, details):
        """The pump and its staff login (returned). A new police pump gets its opening stock once."""
        pump = Pump.objects.filter(unit=unit, name=details["name"]).first()
        opening = details.get("stock", {})
        created = pump is None
        if created:
            sells = details.get("sells", tuple(opening))
            pump = pump_services.create_pump(
                unit,
                name=details["name"],
                kind=details["kind"],
                address=details["address"],
                district=unit.district,
                latitude=Decimal(details["latitude"]),
                longitude=Decimal(details["longitude"]),
                sells_petrol=PETROL in sells,
                sells_diesel=DIESEL in sells,
            )
        operator, _ = User.objects.get_or_create(
            username=details["staff"],
            defaults={"full_name": f"{pump.name} staff", "role": Role.PUMP_OPERATOR, "unit": unit, "pump": pump},
        )
        if created:  # after the staff exist, so a low-stock alert reaches them as well as the MTO
            for tank in pump.tanks.all():
                stock.record_measurement(tank, opening[tank.fuel_type], operator, "Opening stock (demo)")
        return self._settle(operator)

    def _history(self):
        """Last month's fills, each with its duty particulars. Only on a database with no fills yet, so a second run,
        or a demo already in use, gets nothing more."""
        if FuelRequest.objects.exists():
            return
        last_month = month_period(current_month() - timedelta(days=1))
        pin_valid = timedelta(hours=settings.MTO_RULES["PIN_VALID_HOURS"])
        for registration, bunk_name, day, litres, duty in HISTORY:
            vehicle = Vehicle.objects.get(registration_number=registration)
            driver = next(
                link.person for link in fleet_services.current_links(vehicle) if link.kind == AssignmentKind.DRIVER
            )
            bunk = Pump.objects.get(name=bunk_name)
            filled_at = datetime(last_month.start.year, last_month.start.month, day, 10, 0, tzinfo=IST)
            fill = FuelRequest.objects.create(
                vehicle=vehicle,
                driver=driver,
                fuel_type=vehicle.fuel_type,
                litres_requested=Decimal(litres),
                pin=requests.new_pin(),
                status=RequestStatus.FILLED,
                expires_at=filled_at + pin_valid,
                pump=bunk,
                filled_by=bunk.staff.first(),
                filled_at=filled_at,
                litres_filled=Decimal(litres),
                duty_particulars=duty,
                duty_submitted_at=filled_at + timedelta(hours=6),
            )
            FuelRequest.objects.filter(pk=fill.pk).update(issued_at=filled_at - timedelta(minutes=20))

    def _print(self, logins):
        self.stdout.write("Demo data is ready. Every login uses the same password.")
        rows = [("Username", "Role", "Belongs to", "Password")]
        rows += [(user.username, user.role, place, DEMO_PASSWORD) for user, place in logins]
        widths = [max(len(row[column]) for row in rows) for column in range(4)]
        for index, row in enumerate(rows):
            self.stdout.write("  ".join(cell.ljust(width) for cell, width in zip(row, widths)).rstrip())
            if index == 0:
                self.stdout.write("  ".join("-" * width for width in widths))


def _master(model, name):
    return model.objects.get_or_create(name=name)[0]
