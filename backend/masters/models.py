from django.db import models


class MasterItem(models.Model):
    """A dropdown value managed by the PTO. One in use is switched off rather than deleted, so records keep it."""

    name = models.CharField(max_length=120, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        abstract = True
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class District(MasterItem):
    pass


class Designation(MasterItem):
    pass


class Cadre(MasterItem):
    pass
