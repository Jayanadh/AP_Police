from django.db import migrations

DISTRICTS = [
    "Srikakulam", "Parvathipuram Manyam", "Vizianagaram", "Visakhapatnam", "Alluri Sitharama Raju",
    "Anakapalli", "Kakinada", "East Godavari", "Dr. B.R. Ambedkar Konaseema", "Eluru",
    "West Godavari", "NTR", "Krishna", "Palnadu", "Guntur", "Bapatla", "Prakasam",
    "Sri Potti Sriramulu Nellore", "Kurnool", "Nandyal", "Anantapuramu", "Sri Sathya Sai",
    "YSR Kadapa", "Annamayya", "Tirupati", "Chittoor",
]

DESIGNATIONS = [
    "Director General of Police", "Additional Director General of Police",
    "Inspector General of Police", "Deputy Inspector General of Police",
    "Superintendent of Police", "Additional Superintendent of Police",
    "Deputy Superintendent of Police", "Inspector of Police", "Reserve Inspector",
    "Sub-Inspector of Police", "Reserve Sub-Inspector", "Assistant Sub-Inspector",
    "Head Constable", "Police Constable", "Home Guard", "Civilian Staff",
]

CADRES = ["IPS", "State Police Service", "Civil", "Armed Reserve", "APSP", "Ministerial", "Other"]


def seed(apps, schema_editor):
    for model_name, names in (("District", DISTRICTS), ("Designation", DESIGNATIONS), ("Cadre", CADRES)):
        model = apps.get_model("masters", model_name)
        model.objects.bulk_create([model(name=name) for name in names], ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [("masters", "0001_initial")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
