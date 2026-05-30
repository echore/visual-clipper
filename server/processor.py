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


def build_prompt(job: dict, cfg: Config) -> str:
    job_json = str(cfg.staging_dir / f"{job['id']}.json")
    return (
        f"Read and follow the SOP at: {cfg.sop_path}\n"
        f"Process this one job. Job JSON path: {job_json}\n"
        f"Staged image path: {job['png_path']}\n"
        f"Vault root: {cfg.vault_path}\n"
        f"Aesthetic notes folder (relative to vault root): {cfg.aesthetic_folder}\n"
        f"Assets folder (relative to vault root): {cfg.assets_folder}\n"
        f"Source URL: {job['source_url']}\n"
        f"Title hint: {job['title']}\n"
        f"When done, print exactly one final line: NOTE_PATH: <vault-relative path to the .md>"
    )
