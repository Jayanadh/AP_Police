import pytest


@pytest.fixture(autouse=True)
def _letters_in_a_scratch_folder(settings, tmp_path):
    """Uploaded letters go to a folder that is thrown away with the test, not to the shared test media folder."""
    settings.MEDIA_ROOT = tmp_path
