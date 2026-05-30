import pytest
from server.config import Config

# 1x1 transparent PNG
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


@pytest.fixture
def tmp_config(tmp_path):
    sop = tmp_path / "sop.md"
    sop.write_text("# test sop\n")
    return Config(
        staging_dir=tmp_path / "staging",
        vault_path=tmp_path / "vault",
        sop_path=sop,
    )
