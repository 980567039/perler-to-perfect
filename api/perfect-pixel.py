"""Vercel HTTP entry point for the shared Perfect Pixel service."""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from perfect_pixel_service import MAX_IMAGE_BYTES, process  # noqa: E402


# A base64 data URL is at most 4/3 the decoded image size. The remainder allows
# for JSON keys and the data URL header without imposing a second image limit.
MAX_REQUEST_BYTES = (MAX_IMAGE_BYTES * 4 + 2) // 3 + 64 * 1024


def _status_for(result: Dict[str, Any]) -> int:
    if result.get("ok"):
        return 200
    return {
        "invalid-parameters": 400,
        "missing-dependency": 503,
        "grid-detection-failed": 422,
        "processing-error": 500,
    }.get(str(result.get("code")), 500)


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        content_length = self.headers.get("Content-Length")
        try:
            request_length = int(content_length) if content_length is not None else None
        except ValueError:
            request_length = None
        if request_length is not None and request_length > MAX_REQUEST_BYTES:
            self._send_json(413, {"ok": False, "code": "request-too-large", "error": "请求体过大，图片不能超过 25 MB"})
            return

        body = self.rfile.read(MAX_REQUEST_BYTES + 1)
        if len(body) > MAX_REQUEST_BYTES:
            self._send_json(413, {"ok": False, "code": "request-too-large", "error": "请求体过大，图片不能超过 25 MB"})
            return
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"ok": False, "code": "invalid-parameters", "error": "请求体不是有效的 JSON"})
            return

        result = process(payload)
        self._send_json(_status_for(result), result)

    def do_GET(self) -> None:  # noqa: N802
        self._send_json(405, {"ok": False, "code": "method-not-allowed", "error": "仅支持 POST 请求"})

    def log_message(self, format: str, *args: Any) -> None:
        # Vercel/runtime logs belong on stderr; service stdout remains JSON-only.
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))
