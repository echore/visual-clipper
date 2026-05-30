import json
import struct
from io import BytesIO
from types import SimpleNamespace
from tests.helpers import TINY_PNG_B64
from host import host


def _encode(obj: dict) -> bytes:
    """Encode a dict as a Native Messaging message (4-byte LE length + JSON bytes)."""
    body = json.dumps(obj).encode("utf-8")
    return struct.pack("<I", len(body)) + body


def _decode(raw: bytes) -> dict:
    """Decode a Native Messaging response from raw bytes."""
    length = struct.unpack("<I", raw[:4])[0]
    return json.loads(raw[4:4 + length])


def test_encode_decode_roundtrip():
    msg = {"image_base64": TINY_PNG_B64, "source_url": "u", "title": "T"}
    encoded = host.encode_message(msg)
    assert _decode(encoded) == msg


def test_decode_message_from_stream():
    raw = _encode({"hello": "world"})
    result = host.decode_message(BytesIO(raw))
    assert result == {"hello": "world"}


def test_decode_message_empty_stream_returns_none():
    result = host.decode_message(BytesIO(b""))
    assert result is None


def test_handle_message_success(tmp_config, monkeypatch):
    monkeypatch.setattr(host, "CONFIG", tmp_config)
    monkeypatch.setattr(
        host, "process_job",
        lambda job, cfg: {"success": True, "note_path": "AI协作/test.md"},
    )
    monkeypatch.setattr(host, "open_note", lambda v, p: True)
    result = host.handle_message(
        {"image_base64": TINY_PNG_B64, "source_url": "https://x.com", "title": "T"},
        tmp_config,
    )
    assert result["success"] is True
    assert result["note_path"] == "AI协作/test.md"


def test_handle_message_exception_returns_error(tmp_config, monkeypatch):
    monkeypatch.setattr(host, "CONFIG", tmp_config)
    def boom(*a, **kw):
        raise ValueError("bad png")
    monkeypatch.setattr(host, "save_to_staging", boom)
    result = host.handle_message(
        {"image_base64": "!!!BAD!!!", "source_url": "", "title": ""},
        tmp_config,
    )
    assert result["success"] is False
    assert "bad png" in result["error"]
