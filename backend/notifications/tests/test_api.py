from datetime import timedelta

import pytest
from django.utils import timezone

from notifications.models import Notification
from testing.factories import DriverFactory, MTOFactory

pytestmark = pytest.mark.django_db


def make_note(user, title="Alert", read=False, minutes_ago=0):
    note = Notification.objects.create(recipient=user, title=title, body="Body", link="/mto/emergencies")
    changes = {"created_at": timezone.now() - timedelta(minutes=minutes_ago)}
    if read:
        changes["read_at"] = timezone.now()
    Notification.objects.filter(pk=note.pk).update(**changes)
    note.refresh_from_db()
    return note


def test_list_shows_only_my_rows_newest_first(api):
    me, other = MTOFactory(), MTOFactory()
    old = make_note(me, "old", minutes_ago=30)
    new = make_note(me, "new", minutes_ago=1)
    make_note(other, "not mine")
    api.force_login(me)
    response = api.get("/api/notifications/")
    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body] == [new.id, old.id]
    assert set(body[0]) == {"id", "title", "body", "link", "created_at", "read_at"}
    assert body[0]["link"] == "/mto/emergencies"
    assert body[0]["read_at"] is None


def test_list_returns_at_most_100_rows(api):
    me = DriverFactory()
    Notification.objects.bulk_create(
        [Notification(recipient=me, title=f"n{i}") for i in range(105)]
    )
    api.force_login(me)
    assert len(api.get("/api/notifications/").json()) == 100


def test_unread_count_counts_only_my_unread_rows(api):
    me, other = DriverFactory(), DriverFactory()
    make_note(me)
    make_note(me)
    make_note(me, read=True)
    make_note(other)
    api.force_login(me)
    response = api.get("/api/notifications/unread-count/")
    assert response.status_code == 200
    assert response.json() == {"count": 2}


def test_read_sets_read_at_and_keeps_the_first_timestamp(api):
    me = DriverFactory()
    note = make_note(me)
    api.force_login(me)
    first = api.post(f"/api/notifications/{note.id}/read/")
    assert first.status_code == 200
    assert first.json()["id"] == note.id
    assert first.json()["read_at"] is not None
    stamp = Notification.objects.get(pk=note.pk).read_at
    assert stamp is not None
    second = api.post(f"/api/notifications/{note.id}/read/")
    assert second.status_code == 200
    assert Notification.objects.get(pk=note.pk).read_at == stamp


def test_read_on_someone_elses_row_is_404(api):
    me, other = DriverFactory(), DriverFactory()
    note = make_note(other)
    api.force_login(me)
    assert api.post(f"/api/notifications/{note.id}/read/").status_code == 404
    assert Notification.objects.get(pk=note.pk).read_at is None


def test_read_all_marks_only_my_unread_rows(api):
    me, other = DriverFactory(), DriverFactory()
    mine = [make_note(me), make_note(me)]
    make_note(me, read=True)
    theirs = make_note(other)
    api.force_login(me)
    response = api.post("/api/notifications/read-all/")
    assert response.status_code == 200
    assert response.json() == {"updated": 2}
    assert all(Notification.objects.get(pk=n.pk).read_at is not None for n in mine)
    assert Notification.objects.get(pk=theirs.pk).read_at is None
    assert api.post("/api/notifications/read-all/").json() == {"updated": 0}


def test_anonymous_cannot_list(api):
    assert api.get("/api/notifications/").status_code == 403
