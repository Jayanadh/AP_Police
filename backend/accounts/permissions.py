from rest_framework.permissions import BasePermission


class RolePermission(BasePermission):
    allowed_roles: tuple[str, ...] = ()
    message = "Your role cannot do this."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role in self.allowed_roles)


def role_required(*roles: str) -> type[RolePermission]:
    """A permission class that lets in only the given roles, e.g. role_required(Role.MTO)."""
    return type("RoleRequired", (RolePermission,), {"allowed_roles": tuple(roles)})
