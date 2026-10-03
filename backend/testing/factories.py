"""factory_boy factories shared by every app's tests."""
from datetime import timedelta
from decimal import Decimal

import factory
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.utils import timezone

from accounts.models import Role, Unit, User, UserStatus
from common.months import current_month, today_ist
from fleet import odometer
from fleet import services as fleet_services
from fleet.models import FuelType, OdometerReading, ServiceRecord, Vehicle, VehicleType
from fuel.models import EmergencyStatus, FuelGrant, FuelRequest, RequestStatus
from masters.models import Cadre, Designation, District
from pumps import services as pump_services
from pumps.models import Pump, PumpKind

PASSWORD = "Strong-pass-2026"


def master(model, name):
    return model.objects.get_or_create(name=name)[0]


class UnitFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Unit

    name = factory.Sequence(lambda n: f"MTO Office {n}")
    code = factory.Sequence(lambda n: f"U{n:03d}")
    district = factory.LazyFunction(lambda: master(District, "Sri Potti Sriramulu Nellore"))


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User

    username = factory.Sequence(lambda n: f"user{n}")
    full_name = factory.Sequence(lambda n: f"Person {n}")
    emp_id = factory.Sequence(lambda n: f"EMP{n:05d}")
    role = Role.DRIVER
    unit = factory.SubFactory(UnitFactory)
    status = UserStatus.ACTIVE
    designation = factory.LazyFunction(lambda: master(Designation, "Police Constable"))
    district = factory.LazyFunction(lambda: master(District, "Sri Potti Sriramulu Nellore"))
    cadre = factory.LazyFunction(lambda: master(Cadre, "Civil"))
    password = factory.LazyFunction(lambda: make_password(PASSWORD))


class PTOFactory(UserFactory):
    role = Role.PTO
    unit = None


class MTOFactory(UserFactory):
    role = Role.MTO


class OfficerFactory(UserFactory):
    role = Role.OFFICER
    designation = factory.LazyFunction(lambda: master(Designation, "Inspector of Police"))


class DriverFactory(UserFactory):
    role = Role.DRIVER
    licence_number = factory.Sequence(lambda n: f"AP{n:011d}")


class VehicleFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Vehicle

    unit = factory.SubFactory(UnitFactory)
    registration_number = factory.Sequence(lambda n: f"AP99ZZ{n:04d}")
    vehicle_type = VehicleType.JEEP
    make = "Mahindra"
    model = "Bolero"
    fuel_type = FuelType.DIESEL
    tank_capacity_litres = 60
    monthly_fuel_limit_litres = 100


def driver_on(vehicle):
    """A new driver of the vehicle's unit, linked to the vehicle."""
    driver = DriverFactory(unit=vehicle.unit)
    fleet_services.assign_person(vehicle, driver, unit_mto(vehicle.unit))
    return driver


class OdometerReadingFactory(factory.django.DjangoModelFactory):
    """The Sunday reading of the current week, recorded by a driver of the vehicle's unit."""

    class Meta:
        model = OdometerReading

    vehicle = factory.SubFactory(VehicleFactory)
    week_of = factory.LazyFunction(lambda: odometer.week_of(today_ist()))
    reading_km = 1000
    recorded_by = factory.SubFactory(DriverFactory, unit=factory.SelfAttribute("..vehicle.unit"))


class ServiceRecordFactory(factory.django.DjangoModelFactory):
    """A service done today, recorded by the vehicle unit's MTO."""

    class Meta:
        model = ServiceRecord

    vehicle = factory.SubFactory(VehicleFactory)
    service_date = factory.LazyFunction(today_ist)
    odometer_km = 1000
    recorded_by = factory.LazyAttribute(lambda record: unit_mto(record.vehicle.unit))


class PumpFactory(factory.django.DjangoModelFactory):
    """A police pump selling petrol and diesel, with empty tanks. Pass `kind=PumpKind.TIE_UP` for a bunk."""

    class Meta:
        model = Pump
        skip_postgeneration_save = True

    unit = factory.SubFactory(UnitFactory)
    name = factory.Sequence(lambda n: f"Pump {n}")
    kind = PumpKind.POLICE
    address = factory.Sequence(lambda n: f"{n} Main Road")
    district = factory.LazyFunction(lambda: master(District, "Sri Potti Sriramulu Nellore"))
    latitude = Decimal("14.442600")
    longitude = Decimal("79.986500")

    @factory.post_generation
    def tanks(self, create, extracted, **kwargs):
        if create:
            pump_services.ensure_tanks(self)


class PumpStaffFactory(UserFactory):
    """Staff of a pump of their own unit. Pump staff have no Emp ID, designation, district or cadre."""

    role = Role.PUMP_OPERATOR
    emp_id = None
    designation = None
    district = None
    cadre = None
    pump = factory.SubFactory(PumpFactory, unit=factory.SelfAttribute("..unit"))


def police_pump(unit, petrol=Decimal("0"), diesel=Decimal("0")):
    """A police pump of `unit` with the given stock in its petrol and diesel tanks."""
    pump = PumpFactory(unit=unit, kind=PumpKind.POLICE)
    pump.tanks.filter(fuel_type=FuelType.PETROL).update(current_stock_litres=petrol)
    pump.tanks.filter(fuel_type=FuelType.DIESEL).update(current_stock_litres=diesel)
    return pump


def tieup_pump(unit):
    """A tie-up bunk of `unit` selling petrol and diesel."""
    return PumpFactory(unit=unit, kind=PumpKind.TIE_UP)


def unit_mto(unit):
    """The MTO login of `unit`: a unit has only one, so it is created on first use."""
    return User.objects.filter(role=Role.MTO, unit=unit).first() or MTOFactory(unit=unit)


class FuelGrantFactory(factory.django.DjangoModelFactory):
    """Additional quota of 30 L for the current month, with a small PDF letter, added by the vehicle unit's MTO."""

    class Meta:
        model = FuelGrant

    vehicle = factory.SubFactory(VehicleFactory)
    month = factory.LazyFunction(current_month)
    litres = Decimal("30")
    approved_by = "DIG Nellore Range"
    letter = factory.django.FileField(filename="letter.pdf", data=b"%PDF-1.4 test letter")
    created_by = factory.LazyAttribute(lambda grant: unit_mto(grant.vehicle.unit))


class FuelRequestFactory(factory.django.DjangoModelFactory):
    """An open (PIN issued) request for 20 L from a driver of the vehicle's unit."""

    class Meta:
        model = FuelRequest

    vehicle = factory.SubFactory(VehicleFactory)
    driver = factory.SubFactory(DriverFactory, unit=factory.SelfAttribute("..vehicle.unit"))
    fuel_type = factory.SelfAttribute("vehicle.fuel_type")
    litres_requested = Decimal("20")
    pin = factory.Sequence(lambda n: f"{100000 + n:06d}")
    expires_at = factory.LazyFunction(
        lambda: timezone.now() + timedelta(hours=settings.MTO_RULES["PIN_VALID_HOURS"])
    )


def filled_request(vehicle, litres, filled_at, driver=None, pump=None, emergency_litres=Decimal("0"), **overrides):
    """A request that has been filled: `litres` at `pump` at `filled_at`, `emergency_litres` of it beyond the quota.

    An emergency fill waits for the MTO's go-ahead (emergency status PENDING), as it does when a pump records it.
    Any other `FuelRequest` field can be set through `overrides`, e.g. `emergency_status=EmergencyStatus.ALLOWED`.
    """
    driver = driver or DriverFactory(unit=vehicle.unit)
    pump = pump or PumpFactory(unit=vehicle.unit)
    emergency = emergency_litres > 0
    fields = {
        "vehicle": vehicle,
        "driver": driver,
        "litres_requested": litres,
        "is_emergency": emergency,
        "emergency_reason": "Emergency duty" if emergency else "",
        "status": RequestStatus.FILLED,
        "pump": pump,
        "filled_by": PumpStaffFactory(pump=pump, unit=pump.unit),
        "filled_at": filled_at,
        "litres_filled": litres,
        "emergency_litres": emergency_litres,
        "emergency_status": EmergencyStatus.PENDING if emergency else EmergencyStatus.NONE,
    }
    return FuelRequestFactory(**{**fields, **overrides})
