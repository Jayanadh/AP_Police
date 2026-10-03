"""The first login on a new server: a PTO, made without the demo data. The password is typed twice and never shown."""
from getpass import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from accounts.models import Role, User, normalize_username


class Command(BaseCommand):
    help = "Create a PTO login (the state super admin). Asks for its password twice."

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True, help="The login ID, e.g. pto.")
        parser.add_argument("--full-name", required=True, help="The name shown in the app, e.g. 'State PTO'.")

    def handle(self, *args, username, full_name, **options):
        username, full_name = normalize_username(username), full_name.strip()
        if not username or not full_name:
            raise CommandError("Give both a login ID and a full name.")
        if User.objects.filter(username=username).exists():
            raise CommandError(f"The login ID {username} is already in use.")

        password = getpass("Password: ")
        if getpass("Password again: ") != password:
            raise CommandError("The two passwords do not match.")
        pto = User(username=username, full_name=full_name, role=Role.PTO)
        try:
            validate_password(password, pto)
        except ValidationError as error:
            raise CommandError(" ".join(error.messages)) from None

        pto.set_password(password)
        pto.save()
        self.stdout.write(f"PTO login {username} is ready.")
