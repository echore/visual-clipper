import json
from pathlib import Path


_OBSIDIAN_REGISTRY = Path.home() / "Library/Application Support/obsidian/obsidian.json"


def resolve_vault(vault_name: str) -> Path:
    """Return full filesystem path for a vault given its display name.

    Reads Obsidian's own registry so the user never has to type a full path.
    Raises ValueError with a user-facing message if the vault is not found.
    """
    if not _OBSIDIAN_REGISTRY.exists():
        raise ValueError(
            "找不到 Obsidian 注册表，请先打开 Obsidian 至少一次"
        )
    registry = json.loads(_OBSIDIAN_REGISTRY.read_text(encoding="utf-8"))
    for entry in registry.get("vaults", {}).values():
        p = Path(entry.get("path", ""))
        if p.name == vault_name:
            return p
    raise ValueError(
        f"Vault '{vault_name}' 未在 Obsidian 中找到，"
        "请确认名称与 Obsidian 左下角显示的一致"
    )


def resolve_folder(vault_path: Path, hint: str) -> str:
    """Return vault-relative path for a folder given a name or partial path.

    If hint contains '/' it is used as-is (user provided a full relative path).
    Otherwise the vault is searched for a directory whose name matches hint.
    Raises ValueError if no match or if multiple matches require disambiguation.
    """
    if not hint:
        raise ValueError("文件夹名称不能为空")

    if "/" in hint:
        # User already gave a full relative path — trust it directly
        return hint

    # Search vault for a directory whose name matches hint exactly
    matches = [
        p for p in vault_path.rglob("*")
        if p.is_dir()
        and p.name == hint
        and not any(part.startswith(".") for part in p.relative_to(vault_path).parts)
    ]

    if len(matches) == 1:
        return str(matches[0].relative_to(vault_path))

    if len(matches) == 0:
        raise ValueError(
            f"在 vault 中找不到文件夹 '{hint}'，"
            "请检查名称或填写完整相对路径（如 Projects/Design/Screenshots）"
        )

    paths = "、".join(str(m.relative_to(vault_path)) for m in matches)
    raise ValueError(
        f"找到多个名为 '{hint}' 的文件夹：{paths}，"
        "请填写完整相对路径加以区分"
    )
