from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import User, UserStatus, normalize_username
from accounts.serializers.auth import ChangePasswordSerializer, LoginSerializer, MeSerializer
from accounts.throttles import LoginIdThrottle
from common.exceptions import BusinessRuleError

BLOCKED_MESSAGES = {
    UserStatus.PENDING_APPROVAL.value: "Your account is waiting for PTO approval.",
    UserStatus.PAUSED.value: "Your account is paused. Contact your MTO.",
    UserStatus.TERMINATED.value: "Your account has been terminated.",
    UserStatus.REJECTED.value: "Your account request was rejected by the PTO.",
}


@method_decorator(ensure_csrf_cookie, name="dispatch")
class SessionView(APIView):
    """Sets the CSRF cookie and tells the app who, if anyone, is logged in."""

    permission_classes = [AllowAny]

    def get(self, request):
        user = request.user if request.user.is_authenticated else None
        return Response({"user": MeSerializer(user).data if user else None})


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle, LoginIdThrottle]
    throttle_scope = "login"

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # DRF checks CSRF only for a signed-in session. Login needs it too, or another site could sign a visitor in
        # as the attacker without them noticing. The app gets the token from the session call before it logs in.
        SessionAuthentication().enforce_csrf(request)

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = normalize_username(serializer.validated_data["username"])
        password = serializer.validated_data["password"]
        user = authenticate(request, username=username, password=password)
        if user is None:
            # Explain a blocked account only to someone who knows its password.
            blocked = User.objects.filter(username=username).exclude(status=UserStatus.ACTIVE).first()
            if blocked is not None and blocked.check_password(password):
                raise BusinessRuleError(BLOCKED_MESSAGES[blocked.status])
            raise BusinessRuleError("Invalid username or password.")
        login(request, user)
        return Response({"user": MeSerializer(user).data})


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChangePasswordView(APIView):
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["old_password"]):
            raise BusinessRuleError("Current password is incorrect.")
        user.set_password(serializer.validated_data["new_password"])
        user.must_change_password = False
        user.save()
        update_session_auth_hash(request, user)
        return Response(status=status.HTTP_204_NO_CONTENT)
