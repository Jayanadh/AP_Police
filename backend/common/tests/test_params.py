import pytest

from common.exceptions import BusinessRuleError
from common.params import office_id, vehicle_id


def test_an_id_parameter_is_read_as_a_whole_number():
    assert office_id({"unit": "12"}) == 12
    assert vehicle_id({"vehicle": "7"}) == 7


@pytest.mark.parametrize("params", [{}, {"unit": ""}])
def test_a_missing_or_blank_id_means_no_filter(params):
    assert office_id(params) is None


@pytest.mark.parametrize("value", ["Nellore", "-1", "1.5", " 3"])
def test_anything_but_a_whole_number_is_refused_with_its_own_message(value):
    with pytest.raises(BusinessRuleError, match="^Use the office's id.$"):
        office_id({"unit": value})
    with pytest.raises(BusinessRuleError, match="^Use the vehicle's id.$"):
        vehicle_id({"vehicle": value})
