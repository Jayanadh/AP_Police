import pytest
from django.db import IntegrityError

from masters.models import Cadre, Designation, District

pytestmark = pytest.mark.django_db


def test_all_26_ap_districts_are_seeded():
    assert District.objects.count() == 26
    assert District.objects.filter(name="Sri Potti Sriramulu Nellore").exists()


def test_designations_and_cadres_are_seeded():
    assert Designation.objects.filter(name="Inspector of Police").exists()
    assert Cadre.objects.filter(name="Armed Reserve").exists()


def test_master_names_are_unique():
    with pytest.raises(IntegrityError):
        District.objects.create(name="Krishna")
