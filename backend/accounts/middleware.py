from django.http import JsonResponse

# What someone needs to set their own password: who they are, the change itself, and a way in and out.
OPEN_WHILE_PASSWORD_MUST_CHANGE = frozenset(
    {
        "/api/auth/session/", "/api/auth/login/", "/api/auth/token/", "/api/auth/logout/",
        "/api/auth/change-password/", "/api/health/",
    }
)
MUST_CHANGE_PASSWORD = "Change your password before you continue."


class PasswordChangeRequiredMiddleware:
    """Until a person replaces a password someone else set (a first login, or one the MTO or PTO reset), the API
    answers nothing but the calls needed to change it. The app sends them to the change-password page as well, but
    the server must not rely on that. (A phone app's device token is checked the same way where it is read, in
    accounts.device_tokens: the session middleware does not see it.)"""

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
            return JsonResponse({"detail": MUST_CHANGE_PASSWORD}, status=403)
        return self.get_response(request)
