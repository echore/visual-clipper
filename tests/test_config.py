import json
from pathlib import Path
from server.config import Config


def test_config_defaults():
    c = Config()
    assert c.port == 27183
    assert c.aesthetic_folder == "AI协作/05 审美积累/单张分析"
    assert c.assets_folder == "Assets/审美"
    assert c.claude_bin == "claude"


def test_config_load_overrides_from_json(tmp_path):
    p = tmp_path / "config.json"
    p.write_text(json.dumps({"port": 9999, "vault_path": "/tmp/v"}))
    c = Config.load(p)
    assert c.port == 9999
    assert c.vault_path == Path("/tmp/v")


def test_config_load_missing_file_returns_defaults(tmp_path):
    c = Config.load(tmp_path / "nope.json")
    assert c.port == 27183
