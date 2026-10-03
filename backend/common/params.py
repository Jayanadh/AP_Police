"""Query parameters that name a record by its id, read the same way by every list."""
from collections.abc import Mapping

from common.exceptions import BusinessRuleError


def _id(params: Mapping[str, str], name: str, message: str) -> int | None:
    """The whole-number id in `params[name]`; None when it is missing or blank, refused with `message` otherwise."""
    value = params.get(name)
    if not value:
        return None
    if not value.isdecimal():
        raise BusinessRuleError(message)
    return int(value)


def office_id(params: Mapping[str, str]) -> int | None:
    """`?unit=<id>`: one MTO office."""
    return _id(params, "unit", "Use the office's id.")


def vehicle_id(params: Mapping[str, str]) -> int | None:
    """`?vehicle=<id>`: one vehicle."""
    return _id(params, "vehicle", "Use the vehicle's id.")


def pump_id(params: Mapping[str, str]) -> int | None:
    """`?pump=<id>`: one police pump or tie-up bunk."""
    return _id(params, "pump", "Use the pump's id.")
