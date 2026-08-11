# -*- coding: utf-8 -*-
"""HTTP-сервер «Черемша: Госхайп».

Только стандартная библиотека Python: http.server + sqlite3.
Запуск:  python server/app.py  [--port 8000] [--no-browser]
"""

import argparse
import json
import mimetypes
import os
import posixpath
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from server.engine import Engine, GameError
else:
    from .engine import Engine, GameError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")

ENGINE = None
ENGINE_LOCK = threading.Lock()


def get_engine():
    global ENGINE
    with ENGINE_LOCK:
        if ENGINE is None:
            ENGINE = Engine()
    return ENGINE


class Handler(BaseHTTPRequestHandler):
    server_version = "Cheremsha/1.0"
    protocol_version = "HTTP/1.1"

    def _send(self, code, body=b"", ctype="application/octet-stream"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, code=200):
        self._send(code, json.dumps(data, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise GameError("Некорректный JSON в запросе")

    def log_message(self, fmt, *args):
        if os.environ.get("MCT_VERBOSE"):
            super().log_message(fmt, *args)

    # --- маршруты ---
    def do_GET(self):
        path = urlparse(self.path).path
        try:
            eng = get_engine()
            if path == "/api/state":
                return self._json(eng.state(apply_offline=True))
            if path == "/api/stats":
                return self._json(eng.stats())
            if path.startswith("/api/"):
                return self._json({"error": "Неизвестный эндпоинт"}, 404)
            return self._static(path)
        except GameError as e:
            self._json({"error": str(e)}, 400)
        except Exception as e:                      # noqa: BLE001
            self._json({"error": f"Внутренняя ошибка: {e}"}, 500)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            p = self._read_json()
            eng = get_engine()
            if path == "/api/sync":
                return self._json(eng.sync(p))
            if path == "/api/buy":
                return self._json(eng.buy(str(p["id"]), p.get("hype", 0)))
            if path == "/api/roll-event":
                return self._json(eng.roll_event(float(p.get("cringe", 0))))
            if path == "/api/fix-event":
                return self._json(eng.fix_event(str(p["id"]), p.get("hype", 0)))
            if path == "/api/shop":
                return self._json(eng.shop(str(p["id"])))
            if path == "/api/skin":
                return self._json(eng.set_skin(str(p["id"])))
            if path == "/api/reset":
                return self._json(eng.new_game())
            raise GameError("Неизвестная команда")
        except GameError as e:
            self._json({"error": str(e)}, 400)
        except KeyError as e:
            self._json({"error": f"Не передан параметр {e}"}, 400)
        except Exception as e:                      # noqa: BLE001
            self._json({"error": f"Внутренняя ошибка: {e}"}, 500)

    def _static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        rel = posixpath.normpath(path).lstrip("/")
        full = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not full.startswith(WEB_DIR) or not os.path.isfile(full):
            return self._send(404, b"404", "text/plain; charset=utf-8")
        ctype, _ = mimetypes.guess_type(full)
        if ctype and ctype.startswith("text/"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype or "application/octet-stream")


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="Cheremsha: Goshype")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    get_engine()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"  Cheremsha: Goshype  ->  {url}")
    print("  Ctrl+C - stop server")
    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  Smena okonchena.")
        srv.server_close()


if __name__ == "__main__":
    main()
