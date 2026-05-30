import pytest
from server.config import Config
from tests.helpers import TINY_PNG_B64


@pytest.fixture
def tmp_config(tmp_path):
    sop = tmp_path / "sop.md"
    sop.write_text("# test sop\n")
    return Config(
        staging_dir=tmp_path / "staging",
        vault_path=tmp_path / "vault",
        sop_path=sop,
    )
