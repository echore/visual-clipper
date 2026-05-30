import json
from pathlib import Path
from pydantic import BaseModel, Field

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "screenshot-clipper" / "config.json"
_REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_SOP = _REPO_ROOT / "sop" / "处理审美-SOP.md"


class Config(BaseModel):
    port: int = 27183
    staging_dir: Path = Field(default_factory=lambda: Path.home() / ".local/share/screenshot-clipper/staging")
    vault_path: Path = Field(default_factory=lambda: Path.home() / "Documents/Obsidian Vault")
    aesthetic_folder: str = "AI协作/05 审美积累/单张分析"
    assets_folder: str = "Assets/审美"
    sop_path: Path = Field(default=_DEFAULT_SOP)
    claude_bin: str = "claude"

    @classmethod
    def load(cls, path: Path = DEFAULT_CONFIG_PATH) -> "Config":
        data = {}
        if path.exists():
            data = json.loads(path.read_text())
        return cls(**data)
