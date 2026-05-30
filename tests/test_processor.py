import json
from pathlib import Path
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
