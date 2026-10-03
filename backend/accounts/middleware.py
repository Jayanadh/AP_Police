from django.http import JsonResponse

# What someone needs to set their own password: who they are, the change itself, and a way out.
OPEN_WHILE_PASSWORD_MUST_CHANGE = frozenset(
    {"/api/auth/session/", "/api/auth/login/", "/api/auth/logout/", "/api/auth/change-password/", "/api/health/"}
)


class PasswordChangeRequiredMiddleware:
    """Until a person replaces a password someone else set (a first login, or one the MTO or PTO reset), the API
    answers nothing but the calls needed to change it. The app sends them to the change-password page as well, but
    the server must not rely on that."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = request.user
        if (
            user.is_authenticated
            and user.must_change_password
            and request.path.startswith("/api/")
            and request.path not in OPEN_WHILE_PASSWORD_MUST_CHANGE
        ):
            return JsonResponse({"detail": "Change your password before you continue."}, status=403)
        return self.get_response(request)
