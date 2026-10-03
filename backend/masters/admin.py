from django.contrib import admin

from .models import Cadre, Designation, District

for model in (District, Designation, Cadre):
    admin.site.register(model, list_display=("name", "is_active"), search_fields=("name",))
