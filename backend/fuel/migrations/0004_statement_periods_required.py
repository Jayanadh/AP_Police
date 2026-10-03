from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("fuel", "0003_statement_periods"),
    ]

    operations = [
        migrations.AlterField(
            model_name="bunkstatement",
            name="period_start",
            field=models.DateField(help_text="The first day the statement covers."),
        ),
        migrations.AlterField(
            model_name="bunkstatement",
            name="period_end",
            field=models.DateField(help_text="The last day the statement covers."),
        ),
        migrations.RemoveConstraint(
            model_name="bunkstatement",
            name="one_statement_per_pump_per_month",
        ),
        migrations.RemoveField(
            model_name="bunkstatement",
            name="month",
        ),
        migrations.AddConstraint(
            model_name="bunkstatement",
            constraint=models.CheckConstraint(
                condition=models.Q(("period_start__lte", models.F("period_end"))), name="statement_period_in_order"
            ),
        ),
        migrations.AlterModelOptions(
            name="bunkstatement",
            options={"ordering": ["-period_end", "-period_start", "-submitted_at", "-id"]},
        ),
    ]
