from rest_framework import status
from rest_framework.exceptions import APIException


class BusinessRuleError(APIException):
    """A well-formed request that breaks an MTO business rule. Returns 400 {"detail": msg}."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This action is not allowed."
    default_code = "business_rule"
