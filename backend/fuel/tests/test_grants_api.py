from datetime import date
from decimal import Decimal
from pathlib import PurePath

import pytest
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile

from common.months import current_month, format_month, next_month
from fleet import services
from fleet.models import VehicleStatus
from fuel.models import FuelGrant
from notifications.models import Notification
from testing.factories import (
    DriverFactory,
    FuelGrantFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    PumpStaffFactory,
    UnitFactory,
    VehicleFactory,
)

pytestmark = pytest.mark.django_db

URL = "/api/fuel/grants/"
LETTER_MESSAGE = "Upload the letter as JPG, PNG or PDF."
CONTENT_MESSAGE = "This file is not a real JPG, PNG or PDF. Upload the scanned letter itself."
BIG_MESSAGE = "The letter must be 5 MB or smaller."
MONTH_MESSAGE = "Additional quota can be added for this month or next month only."


@pytest.fixture
def mto():
    return MTOFactory(full_name="Sri K. Ramesh")


@pytest.fixture
def mto_api(api, mto):
    api.force_login(mto)
    return api


@pytest.fixture
def vehicle(mto):
    return VehicleFactory(unit=mto.unit, registration_number="AP39PA1234")


# How each kind of letter file starts, so a test letter is a real one of its kind.
SIGNATURES = {
    ".pdf": b"%PDF-1.4 ",
    ".png": b"\x89PNG\r\n\x1a\n",
    ".jpg": b"\xff\xd8\xff\xe0",
    ".jpeg": b"\xff\xd8\xff\xe0",
}


def pdf(name="approval.pdf", size=None, body=None):
    """A letter file called `name` whose content is a real file of the kind its name says (a PDF by default)."""
    if body is None:
        body = SIGNATURES.get(PurePath(name).suffix.lower(), b"%PDF-1.4 ") + b"approval letter"
    if size is not None:
        body = body.ljust(size, b"0")
    return SimpleUploadedFile(name, body, content_type="application/octet-stream")


def payload(for_vehicle, **overrides):
    data = {
        "vehicle": for_vehicle.id,
        "month": format_month(current_month()),
        "litres": "30",
        "approved_by": "DIG Nellore Range",
        "letter": pdf(),
        "note": "Election duty",
    }
    data.update(overrides)
    return {key: value for key, value in data.items() if value is not None}


def create(api, for_vehicle, **overrides):
    return api.post(URL, payload(for_vehicle, **overrides), format="multipart")


# --- creating a grant ------------------------------------------------------------------------


def test_creating_a_grant_with_a_pdf_letter_returns_it_and_notifies_the_driver(mto_api, mto, vehicle):
    driver = DriverFactory(unit=mto.unit)
    services.assign_person(vehicle, driver, mto)

    response = create(mto_api, vehicle, month=format_month(current_month()), litres="30")

    assert response.status_code == 201
    body = response.json()
    grant = FuelGrant.objects.get()
    assert body == {
        "id": grant.id,
        "vehicle": vehicle.id,
        "registration_number": "AP39PA1234",
        "month": format_month(current_month()),
        "litres": "30.00",
        "approved_by": "DIG Nellore Range",
        "note": "Election duty",
        "letter_url": f"/api/fuel/grants/{grant.id}/letter/",
        "created_by_name": "Sri K. Ramesh",
        "created_at": body["created_at"],
    }
    assert (grant.vehicle, grant.month, grant.litres, grant.created_by) == (
        vehicle, current_month(), Decimal("30"), mto
    )
    assert grant.letter.name.startswith("letters/") and grant.letter.name.endswith(".pdf")
    with grant.letter.open("rb") as stored:
        assert stored.read() == b"%PDF-1.4 approval letter"

    alert = Notification.objects.get(recipient=driver)
    assert alert.title == "Additional fuel for AP39PA1234"
    month_name = current_month().strftime("%B %Y")
    assert alert.body == f"30.00 L added for {month_name}."
    assert alert.link == "/driver"


def test_the_current_officer_is_notified_too_and_nobody_else(mto_api, mto, vehicle):
    officer, driver = OfficerFactory(unit=mto.unit), DriverFactory(unit=mto.unit)
    services.assign_person(vehicle, officer, mto)
    services.assign_person(vehicle, driver, mto)
    bystander = DriverFactory(unit=mto.unit)

    response = create(mto_api, vehicle, litres="12.5")

    assert response.status_code == 201
    alerts = {alert.recipient_id: alert for alert in Notification.objects.all()}
    assert set(alerts) == {officer.id, driver.id}
    assert alerts[officer.id].link == "/officer"
    assert alerts[driver.id].link == "/driver"
    assert alerts[officer.id].title == alerts[driver.id].title == "Additional fuel for AP39PA1234"
    assert alerts[officer.id].body.startswith("12.50 L added for ")
    assert bystander.id not in alerts


def test_a_person_whose_link_has_ended_is_not_notified(mto_api, mto, vehicle):
    driver = DriverFactory(unit=mto.unit)
    services.end_assignment(services.assign_person(vehicle, driver, mto), mto)

    assert create(mto_api, vehicle).status_code == 201

    assert Notification.objects.count() == 0


def test_a_vehicle_with_nobody_linked_still_gets_its_grant(mto_api, vehicle):
    assert create(mto_api, vehicle).status_code == 201
    assert FuelGrant.objects.count() == 1
    assert Notification.objects.count() == 0


def test_next_month_is_allowed(mto_api, vehicle):
    month = next_month(current_month())

    response = create(mto_api, vehicle, month=format_month(month))

    assert response.status_code == 201
    assert response.json()["month"] == format_month(month)
    assert FuelGrant.objects.get().month == month


def test_the_note_is_optional(mto_api, vehicle):
    response = create(mto_api, vehicle, note=None)

    assert response.status_code == 201
    assert response.json()["note"] == ""


@pytest.mark.parametrize("name", ["letter.jpg", "letter.jpeg", "letter.png", "letter.pdf", "LETTER.PDF", "scan.JpG"])
def test_jpg_jpeg_png_and_pdf_letters_are_accepted_in_any_case(mto_api, vehicle, name):
    assert create(mto_api, vehicle, letter=pdf(name)).status_code == 201


@pytest.mark.parametrize("name", ["virus.exe", "letter.docx", "letter.pdf.exe", "letter", "letter.gif", ".pdf.txt"])
def test_any_other_letter_type_is_refused(mto_api, vehicle, name):
    response = create(mto_api, vehicle, letter=pdf(name))

    assert response.status_code == 400
    assert response.json() == {"letter": [LETTER_MESSAGE]}
    assert FuelGrant.objects.count() == 0


def test_a_letter_of_exactly_five_megabytes_is_accepted(mto_api, vehicle):
    assert create(mto_api, vehicle, letter=pdf(size=settings.MTO_RULES["LETTER_MAX_BYTES"])).status_code == 201


def test_a_letter_one_byte_over_five_megabytes_is_refused(mto_api, vehicle):
    response = create(mto_api, vehicle, letter=pdf(size=settings.MTO_RULES["LETTER_MAX_BYTES"] + 1))

    assert response.status_code == 400
    assert response.json() == {"letter": [BIG_MESSAGE]}
    assert FuelGrant.objects.count() == 0


def test_a_grant_without_a_letter_is_refused(mto_api, vehicle):
    response = create(mto_api, vehicle, letter=None)

    assert response.status_code == 400
    assert list(response.json()) == ["letter"]
    assert FuelGrant.objects.count() == 0


def test_a_very_long_letter_file_name_is_shortened_not_refused(mto_api, vehicle):
    response = create(mto_api, vehicle, letter=pdf("a" * 200 + ".pdf"))

    assert response.status_code == 201
    assert len(FuelGrant.objects.get().letter.name) <= 100


@pytest.mark.parametrize(
    ("name", "body"),
    [
        ("letter.pdf", b"<html><script>alert(1)</script></html>"),  # a web page named like a PDF
        ("letter.png", b"\xff\xd8\xff\xe0 a JPG named like a PNG"),
        ("letter.jpg", b"%PDF-1.4 a PDF named like a JPG"),
        ("letter.pdf", b"PK\x03\x04 a zip named like a PDF"),
    ],
)
def test_a_letter_whose_content_is_not_what_its_name_says_is_refused(mto_api, vehicle, name, body):
    response = create(mto_api, vehicle, letter=pdf(name, body=body))

    assert response.status_code == 400
    assert response.json() == {"letter": [CONTENT_MESSAGE]}
    assert FuelGrant.objects.count() == 0


def test_an_empty_letter_is_refused(mto_api, vehicle):
    response = create(mto_api, vehicle, letter=SimpleUploadedFile("empty.pdf", b""))

    assert response.status_code == 400
    assert list(response.json()) == ["letter"]


@pytest.mark.parametrize("approved_by", [None, "", "   "])
def test_approved_by_is_required(mto_api, vehicle, approved_by):
    response = create(mto_api, vehicle, approved_by=approved_by)

    assert response.status_code == 400
    assert list(response.json()) == ["approved_by"]


@pytest.mark.parametrize("litres", ["0", "-5", "0.00"])
def test_litres_must_be_more_than_zero(mto_api, vehicle, litres):
    response = create(mto_api, vehicle, litres=litres)

    assert response.status_code == 400
    assert response.json() == {"litres": ["Enter litres greater than 0."]}
    assert FuelGrant.objects.count() == 0


@pytest.mark.parametrize("litres", [None, "abc"])
def test_litres_must_be_a_number(mto_api, vehicle, litres):
    response = create(mto_api, vehicle, litres=litres)

    assert response.status_code == 400
    assert list(response.json()) == ["litres"]


def test_a_month_two_months_ahead_is_refused(mto_api, vehicle):
    month = next_month(next_month(current_month()))

    response = create(mto_api, vehicle, month=format_month(month))

    assert response.status_code == 400
    assert response.json() == {"month": [MONTH_MESSAGE]}
    assert FuelGrant.objects.count() == 0


def test_a_past_month_is_refused(mto_api, vehicle):
    last = date(current_month().year - 1, 12, 1) if current_month().month == 1 else date(
        current_month().year, current_month().month - 1, 1
    )

    response = create(mto_api, vehicle, month=format_month(last))

    assert response.status_code == 400
    assert response.json() == {"month": [MONTH_MESSAGE]}


@pytest.mark.parametrize("month", ["2026-13", "October", "2026/10", "26-10", ""])
def test_a_badly_formed_month_is_refused(mto_api, vehicle, month):
    response = create(mto_api, vehicle, month=month)

    assert response.status_code == 400
    assert response.json() == {"month": ["Use the month format YYYY-MM."]}


def test_the_month_is_required(mto_api, vehicle):
    response = create(mto_api, vehicle, month=None)

    assert response.status_code == 400
    assert list(response.json()) == ["month"]


def test_another_units_vehicle_is_refused_on_the_vehicle_field(mto_api):
    outsider = VehicleFactory(unit=UnitFactory())

    response = create(mto_api, outsider)

    assert response.status_code == 400
    assert list(response.json()) == ["vehicle"]
    assert FuelGrant.objects.count() == 0


def test_a_terminated_vehicle_is_refused_but_a_paused_one_is_accepted(mto_api, mto):
    terminated = VehicleFactory(unit=mto.unit, status=VehicleStatus.TERMINATED)
    paused = VehicleFactory(unit=mto.unit, status=VehicleStatus.PAUSED)

    refused = create(mto_api, terminated)
    accepted = create(mto_api, paused)

    assert refused.status_code == 400
    assert list(refused.json()) == ["vehicle"]
    assert accepted.status_code == 201


@pytest.mark.parametrize("vehicle_id", [None, 999999, "abc"])
def test_a_missing_or_unknown_vehicle_is_refused_on_the_vehicle_field(mto_api, vehicle, vehicle_id):
    response = create(mto_api, vehicle, vehicle=vehicle_id)

    assert response.status_code == 400
    assert list(response.json()) == ["vehicle"]


def test_a_refused_grant_notifies_nobody(mto_api, mto, vehicle):
    services.assign_person(vehicle, DriverFactory(unit=mto.unit), mto)

    assert create(mto_api, vehicle, litres="0").status_code == 400

    assert Notification.objects.count() == 0


@pytest.mark.parametrize("make_user", [DriverFactory, OfficerFactory, PTOFactory, PumpStaffFactory])
def test_only_the_mto_can_add_a_grant(api, mto, vehicle, make_user):
    kwargs = {} if make_user is PTOFactory else {"unit": mto.unit}
    api.force_login(make_user(**kwargs))

    assert create(api, vehicle).status_code == 403
    assert FuelGrant.objects.count() == 0


def test_anonymous_cannot_add_a_grant(api, vehicle):
    assert create(api, vehicle).status_code in (401, 403)


# --- listing grants --------------------------------------------------------------------------


def test_the_mto_lists_only_their_own_units_grants_newest_first(mto_api, mto, vehicle):
    older = FuelGrantFactory(vehicle=vehicle, month=current_month(), litres=Decimal("10"))
    newer = FuelGrantFactory(vehicle=vehicle, month=current_month(), litres=Decimal("20"))
    FuelGrantFactory(vehicle=VehicleFactory(unit=UnitFactory()))

    response = mto_api.get(URL)

    assert response.status_code == 200
    rows = response.json()
    assert [row["id"] for row in rows] == [newer.id, older.id]
    assert rows[0] == {
        "id": newer.id,
        "vehicle": vehicle.id,
        "registration_number": "AP39PA1234",
        "month": format_month(current_month()),
        "litres": "20.00",
        "approved_by": newer.approved_by,
        "note": "",
        "letter_url": f"/api/fuel/grants/{newer.id}/letter/",
        "created_by_name": "Sri K. Ramesh",
        "created_at": rows[0]["created_at"],
    }


def test_the_pto_lists_every_units_grants(api, mto, vehicle):
    mine = FuelGrantFactory(vehicle=vehicle)
    theirs = FuelGrantFactory(vehicle=VehicleFactory(unit=UnitFactory()))
    api.force_login(PTOFactory())

    response = api.get(URL)

    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {mine.id, theirs.id}


def test_grants_can_be_filtered_by_vehicle_and_by_month(mto_api, mto, vehicle):
    other = VehicleFactory(unit=mto.unit)
    this = current_month()
    wanted = FuelGrantFactory(vehicle=vehicle, month=this)
    next_one = FuelGrantFactory(vehicle=vehicle, month=next_month(this))
    elsewhere = FuelGrantFactory(vehicle=other, month=this)

    def ids(query):
        response = mto_api.get(f"{URL}?{query}")
        assert response.status_code == 200
        return {row["id"] for row in response.json()}

    assert ids(f"vehicle={vehicle.id}") == {wanted.id, next_one.id}
    assert ids(f"month={format_month(this)}") == {wanted.id, elsewhere.id}
    assert ids(f"vehicle={vehicle.id}&month={format_month(next_month(this))}") == {next_one.id}
    assert ids(f"vehicle={other.id}&month={format_month(next_month(this))}") == set()


def test_a_bad_month_or_vehicle_filter_is_a_400_not_a_crash(mto_api):
    assert mto_api.get(f"{URL}?month=2026-13").status_code == 400
    assert mto_api.get(f"{URL}?vehicle=abc").status_code == 400


@pytest.mark.parametrize("make_user", [DriverFactory, OfficerFactory, PumpStaffFactory])
def test_other_roles_cannot_list_grants(api, mto, vehicle, make_user):
    FuelGrantFactory(vehicle=vehicle)
    api.force_login(make_user(unit=mto.unit))

    assert api.get(URL).status_code == 403


def test_listing_uses_a_fixed_number_of_queries(mto_api, mto, vehicle, django_assert_max_num_queries):
    for _ in range(4):
        FuelGrantFactory(vehicle=VehicleFactory(unit=mto.unit))

    with django_assert_max_num_queries(3):  # session, user, grants (vehicle and creator are joined in)
        assert mto_api.get(URL).status_code == 200


def test_grants_have_no_edit_or_delete_endpoints(mto_api, vehicle):
    grant = FuelGrantFactory(vehicle=vehicle)

    assert mto_api.patch(f"{URL}{grant.id}/", {"litres": "99"}).status_code == 404
    assert mto_api.delete(f"{URL}{grant.id}/").status_code == 404


# --- downloading the letter ------------------------------------------------------------------


def download(response):
    return b"".join(response.streaming_content)


def test_the_units_mto_downloads_the_letter(mto_api, vehicle):
    grant = FuelGrantFactory(vehicle=vehicle)

    response = mto_api.get(f"{URL}{grant.id}/letter/")

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/pdf"
    assert response.headers["Content-Disposition"].startswith("attachment;")
    assert ".pdf" in response.headers["Content-Disposition"]
    assert download(response) == b"%PDF-1.4 test letter"


def test_a_png_letter_is_served_with_its_own_type(mto_api, vehicle):
    response = create(mto_api, vehicle, letter=SimpleUploadedFile("scan.png", b"\x89PNG\r\n\x1a\n data"))
    letter = mto_api.get(response.json()["letter_url"])

    assert letter.status_code == 200
    assert letter.headers["Content-Type"] == "image/png"
    assert download(letter) == b"\x89PNG\r\n\x1a\n data"


def test_the_pto_downloads_any_letter(api, vehicle):
    grant = FuelGrantFactory(vehicle=vehicle)
    api.force_login(PTOFactory())

    response = api.get(f"{URL}{grant.id}/letter/")

    assert response.status_code == 200
    assert download(response) == b"%PDF-1.4 test letter"


def test_another_units_mto_cannot_download_the_letter(api, vehicle):
    grant = FuelGrantFactory(vehicle=vehicle)
    api.force_login(MTOFactory())

    assert api.get(f"{URL}{grant.id}/letter/").status_code == 404


@pytest.mark.parametrize("make_user", [DriverFactory, OfficerFactory, PumpStaffFactory])
def test_a_driver_officer_or_pump_operator_gets_404_for_the_letter(api, mto, vehicle, make_user):
    grant = FuelGrantFactory(vehicle=vehicle)
    api.force_login(make_user(unit=mto.unit))

    assert api.get(f"{URL}{grant.id}/letter/").status_code == 404


def test_anonymous_cannot_download_the_letter(api, vehicle):
    grant = FuelGrantFactory(vehicle=vehicle)

    assert api.get(f"{URL}{grant.id}/letter/").status_code in (401, 403)


def test_an_unknown_grant_is_404(mto_api):
    assert mto_api.get(f"{URL}999999/letter/").status_code == 404
    assert mto_api.get(f"{URL}abc/letter/").status_code == 404


def test_a_letter_missing_from_storage_is_404(mto_api, vehicle):
    grant = FuelGrantFactory(vehicle=vehicle)
    grant.letter.storage.delete(grant.letter.name)

    assert mto_api.get(f"{URL}{grant.id}/letter/").status_code == 404
