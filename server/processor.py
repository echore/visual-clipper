import base64
import json
import uuid

from server.config import Config


def save_to_staging(image_base64: str, source_url: str, title: str, cfg: Config) -> dict:
    if "," in image_base64 and image_base64.strip().startswith("data:"):
        image_base64 = image_base64.split(",", 1)[1]
    png_bytes = base64.b64decode(image_base64)

    cfg.staging_dir.mkdir(parents=True, exist_ok=True)
    job_id = uuid.uuid4().hex[:16]
    png_path = cfg.staging_dir / f"{job_id}.png"
    png_path.write_bytes(png_bytes)

    job = {
        "id": job_id,
        "png_path": str(png_path),
        "source_url": source_url,
        "title": title,
    }
    (cfg.staging_dir / f"{job_id}.json").write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
    return job
