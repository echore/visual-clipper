import json
import struct
import sys
from io import RawIOBase
from typing import Optional

from server.config import Config
from server.processor import save_to_staging, process_job, open_note

CONFIG = Config.load()


def encode_message(obj: dict) -> bytes:
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return struct.pack("<I", len(body)) + body


def decode_message(stream: RawIOBase) -> Optional[dict]:
    raw_len = stream.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    length = struct.unpack("<I", raw_len)[0]
    body = stream.read(length)
    return json.loads(body.decode("utf-8"))


def handle_message(msg: dict, cfg: Config) -> dict:
    try:
        from pathlib import Path
        overrides = {}
        if msg.get("vault_path"):
            overrides["vault_path"] = Path(msg["vault_path"]).expanduser()
        if msg.get("notes_folder"):
            overrides["aesthetic_folder"] = msg["notes_folder"]
        if msg.get("assets_folder"):
            overrides["assets_folder"] = msg["assets_folder"]
        if overrides:
            cfg = cfg.model_copy(update=overrides)

        job = save_to_staging(
            msg.get("image_base64", ""),
            msg.get("source_url", ""),
            msg.get("title", ""),
            cfg,
        )
        result = process_job(job, cfg)
        if result.get("success") and result.get("note_path"):
            open_note(cfg.vault_path.name, result["note_path"])
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    cfg = CONFIG
    msg = decode_message(sys.stdin.buffer)
    if msg is None:
        sys.exit(0)
    response = handle_message(msg, cfg)
    sys.stdout.buffer.write(encode_message(response))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
