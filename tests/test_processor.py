import json
from pathlib import Path
from types import SimpleNamespace
from tests.helpers import TINY_PNG_B64
from server import processor


def test_save_to_staging_writes_png_and_job(tmp_config):
    job = processor.save_to_staging(
        TINY_PNG_B64, "https://example.com/x", "My Cool Design", tmp_config
    )
    assert Path(job["png_path"]).exists()
    assert Path(job["png_path"]).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert job["source_url"] == "https://example.com/x"
    assert job["title"] == "My Cool Design"
    job_json = tmp_config.staging_dir / f"{job['id']}.json"
    assert job_json.exists()
    assert json.loads(job_json.read_text())["title"] == "My Cool Design"
    assert tmp_config.staging_dir.is_dir()


def test_save_to_staging_strips_data_url_prefix(tmp_config):
    data_url = "data:image/png;base64," + TINY_PNG_B64
    job = processor.save_to_staging(data_url, "u", "t", tmp_config)
    assert Path(job["png_path"]).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_build_prompt_references_sop_job_and_paths(tmp_config):
    job = {
        "id": "abc123",
        "png_path": str(tmp_config.staging_dir / "abc123.png"),
        "source_url": "https://x.com/y",
        "title": "T",
    }
    prompt = processor.build_prompt(job, tmp_config)
    assert str(tmp_config.sop_path) in prompt
    assert "abc123" in prompt
    assert str(tmp_config.vault_path) in prompt
    assert "NOTE_PATH:" in prompt


def test_process_job_parses_note_path(tmp_config, monkeypatch):
    job = {"id": "abc", "png_path": "/x/abc.png", "source_url": "u", "title": "T"}

    def fake_run(prompt, cfg):
        return SimpleNamespace(
            returncode=0,
            stdout="some log...\nNOTE_PATH: AI协作/05 审美积累/单张分析/T.md\n",
            stderr="",
        )

    monkeypatch.setattr(processor, "run_claude", fake_run)
    result = processor.process_job(job, tmp_config)
    assert result["success"] is True
    assert result["note_path"] == "AI协作/05 审美积累/单张分析/T.md"


def test_process_job_handles_claude_failure(tmp_config, monkeypatch):
    job = {"id": "abc", "png_path": "/x/abc.png", "source_url": "u", "title": "T"}

    def fake_run(prompt, cfg):
        return SimpleNamespace(returncode=1, stdout="", stderr="boom")

    monkeypatch.setattr(processor, "run_claude", fake_run)
    result = processor.process_job(job, tmp_config)
    assert result["success"] is False
    assert "boom" in result["error"]


def test_process_job_no_note_path_in_output_is_failure(tmp_config, monkeypatch):
    job = {"id": "abc", "png_path": "/x/abc.png", "source_url": "u", "title": "T"}
    monkeypatch.setattr(
        processor, "run_claude",
        lambda prompt, cfg: SimpleNamespace(returncode=0, stdout="no marker here", stderr=""),
    )
    result = processor.process_job(job, tmp_config)
    assert result["success"] is False


def test_obsidian_uri_encodes_spaces_as_percent20():
    uri = processor.obsidian_uri("Obsidian Vault", "AI协作/05 审美积累/单张分析/My Note.md")
    assert uri.startswith("obsidian://open?")
    assert "%20" in uri
    assert "+" not in uri


def test_obsidian_uri_includes_vault_and_file():
    uri = processor.obsidian_uri("My Vault", "a/b.md")
    assert "vault=My%20Vault" in uri
    assert "file=a%2Fb.md" in uri or "file=a/b.md" in uri


import shutil
import pytest


@pytest.mark.integration
def test_real_claude_produces_note(tmp_path):
    """Real claude -p run. Requires: claude CLI logged in, a real PNG, write access."""
    from server.config import Config
    from server import processor

    src_png = "/Users/liyachen/Documents/Obsidian Vault/Assets/images/Pasted image 20260505213152.png"
    vault = tmp_path / "vault"
    (vault / "AI协作/05 审美积累/单张分析").mkdir(parents=True)
    (vault / "Assets/审美").mkdir(parents=True)
    repo_sop = Path(__file__).resolve().parent.parent / "sop" / "处理审美-SOP.md"

    cfg = Config(staging_dir=tmp_path / "staging", vault_path=vault, sop_path=repo_sop)
    cfg.staging_dir.mkdir(parents=True)
    staged = cfg.staging_dir / "real.png"
    shutil.copy(src_png, staged)
    job = {"id": "real", "png_path": str(staged), "source_url": "https://test/", "title": "Integration Sample"}
    (cfg.staging_dir / "real.json").write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")

    result = processor.process_job(job, cfg)
    assert result["success"] is True, f"process_job failed: {result}"
    note = vault / result["note_path"]
    assert note.exists(), f"Note file not found: {note}"
    text = note.read_text(encoding="utf-8")
    assert "## 五个问题" in text
    assert "status: 已分析" in text
    assert "palette:" in text
    # objective fields filled:
    assert "### 1. 背景色" in text
    # subjective fields blank (q3 line immediately followed by blank line or next heading):
    assert "### 3. 眼睛第一秒落在哪里\n\n" in text or "### 3. 眼睛第一秒落在哪里\n###" in text
