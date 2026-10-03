from rest_framework.routers import SimpleRouter

from .views import CadreViewSet, DesignationViewSet, DistrictViewSet

router = SimpleRouter()
router.register("districts", DistrictViewSet)
router.register("designations", DesignationViewSet)
router.register("cadres", CadreViewSet)

urlpatterns = router.urls
