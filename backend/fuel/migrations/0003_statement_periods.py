"""Statements cover any period now, not only a calendar month. Every statement so far covered one month, so it
becomes that month's first to last day. 0004 then makes the period required and drops the month."""
from datetime import date, timedelta

from django.db import migrations, models


def months_to_periods(apps, schema_editor):
    BunkStatement = apps.get_model("fuel", "BunkStatement")
    for statement in BunkStatement.objects.all():
        first = statement.month
        following = date(first.year + 1, 1, 1) if first.month == 12 else date(first.year, first.month + 1, 1)
        statement.period_start = first
        statement.period_end = following - timedelta(days=1)
        statement.save(update_fields=["period_start", "period_end"])


def periods_to_months(apps, schema_editor):
    """Going back keeps the month each statement starts in; it fails if a bunk then has two in one month."""
    BunkStatement = apps.get_model("fuel", "BunkStatement")
    for statement in BunkStatement.objects.all():
        statement.month = statement.period_start.replace(day=1)
        statement.save(update_fields=["month"])


class Migration(migrations.Migration):

    dependencies = [
        ("fuel", "0002_bunkstatement"),
    ]

    operations = [
        migrations.AlterField(
            model_name="bunkstatement",
            name="month",
            field=models.DateField(null=True, help_text="The first day of the month the statement is for."),
        ),
        migrations.AddField(
            model_name="bunkstatement",
            name="period_start",
            field=models.DateField(null=True, help_text="The first day the statement covers."),
        ),
        migrations.AddField(
            model_name="bunkstatement",
            name="period_end",
            field=models.DateField(null=True, help_text="The last day the statement covers."),
        ),
        migrations.RunPython(months_to_periods, periods_to_months),
    ]
