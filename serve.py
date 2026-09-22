"""
Change-part pipeline — backend
==============================

    python serve.py        ->  http://localhost:8765/           engineering studio
                               http://localhost:8765/customer   customer portal

Serves the built app (app/dist) plus:

    GET  /api/health                     cadquery / registry / overlay status (?ollama=1 adds an Ollama probe)
    GET  /api/registry                   parts/registry.json merged with parts/*.part.json overlays
    POST /api/validate                   reference Stage 5 engine (stage5_engine.py)
    POST /api/step                       CAD-ready STEP built by CadQuery from validated parameters

    *    /api/ollama/<path>              streaming proxy to the local Ollama server, so browsers
                                         never need OLLAMA_ORIGINS and nothing leaves the network

    POST /api/designs                    publish a design for customer review  -> {"id"}
    PUT  /api/designs/<id>               update a published design
    GET  /api/designs[/<id>]             list / fetch
    POST /api/designs/<id>/responses     customer approval or change request
    POST /api/requests  GET /api/requests  new customer requests (the customer portal's intake form)

Standard library only. STEP is never produced by executing model-generated code.
Hand-off data persists to data/store.json.
"""

from __future__ import annotations

import importlib.util
import json
import mimetypes
import os
import secrets
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
DIST = ROOT / "app" / "dist"
REGISTRY_PATH = ROOT / "parts" / "registry.json"
STORE_PATH = ROOT / "data" / "store.json"
PORT = int(os.environ.get("PIPELINE_PORT", "8765"))
HOST = os.environ.get("PIPELINE_HOST", "127.0.0.1")
OLLAMA = os.environ.get("OLLAMA_HOST_URL", "http://localhost:11434").rstrip("/")
APP_NAME = os.environ.get("APP_NAME", "Change-Part Studio")

sys.path.insert(0, str(ROOT))
import stage5_engine as s5  # noqa: E402

BUILDERS = {
    "starwheel": s5.build_starwheel_solid,
    "feed_screw": s5.build_feed_screw_solid,
    "guide_rail": s5.build_guide_rail_solid,
}
_CQ_PRESENT = None
_LOCK = threading.Lock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------- registry
def load_registry() -> dict:
    """parts/registry.json plus parts/*.part.json overlays (a new part type is one file)."""
    data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    data.setdefault("part_types", {})
    data.setdefault("precedents", [])
    overlays, errors = [], []
    for extra in sorted(REGISTRY_PATH.parent.glob("*.part.json")):
        try:
            o = json.loads(extra.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"  ! skipping {extra.name}: {exc}", flush=True)
            errors.append(f"{extra.name}: {exc}")
            continue
        for key, pt in (o.get("part_types") or {}).items():
            data["part_types"][key] = {**data["part_types"].get(key, {}), **pt}
        known = {p.get("id") for p in data["precedents"]}
        data["precedents"].extend(p for p in (o.get("precedents") or []) if p.get("id") not in known)
        overlays.append(extra.name)
    data["overlays"] = overlays
    data["errors"] = errors
    return data


# ---------------------------------------------------------------- hand-off store
def _load_store() -> dict:
    try:
        return json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"designs": {}, "requests": []}


def _save_store(store: dict) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, indent=2), encoding="utf-8")
    os.replace(tmp, STORE_PATH)  # atomic: a crash mid-write never corrupts the store


def _new_id() -> str:
    return secrets.token_urlsafe(6)


# ---------------------------------------------------------------- probes
def _cadquery_available() -> bool:
    """Presence check only — importing cadquery loads OCCT, which takes seconds."""
    global _CQ_PRESENT
    if _CQ_PRESENT is None:
        try:
            _CQ_PRESENT = importlib.util.find_spec("cadquery") is not None
        except Exception:
            _CQ_PRESENT = False
    return _CQ_PRESENT


def _ollama_up() -> bool:
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


# ---------------------------------------------------------------- handler
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def _json(self, code: int, payload) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _read_json(self):
        raw = self._body()
        return json.loads(raw.decode("utf-8") or "{}") if raw else {}

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        # Hashed build assets can be cached forever; everything else is always fresh.
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if path.startswith("/assets/") else "no-store")
        super().end_headers()

    def log_message(self, fmt, *args) -> None:
        first = str(args[0]) if args else ""
        if "/api/" in first or fmt.startswith("code "):
            super().log_message(fmt, *args)

    # ---- Ollama streaming proxy -------------------------------------------
    def _proxy_ollama(self, method: str) -> None:
        upstream = OLLAMA + self.path[len("/api/ollama"):]
        data = self._body() if method == "POST" else None
        req = urllib.request.Request(upstream, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            resp = urllib.request.urlopen(req, timeout=900)
        except urllib.error.HTTPError as e:
            body = e.read() or json.dumps({"error": f"Ollama HTTP {e.code}"}).encode()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        except Exception as exc:  # noqa: BLE001
            return self._json(502, {"error": f"Ollama not reachable at {OLLAMA} ({exc})"})
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.headers.get("Content-Type", "application/x-ndjson"))
        self.end_headers()
        try:
            while True:  # read1 returns what has arrived, so tokens stream instead of buffering
                chunk = resp.read1(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the browser cancelled the run
        finally:
            resp.close()

    # ---- routing -----------------------------------------------------------
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/ollama/"):
            return self._proxy_ollama("GET")
        if path == "/api/health":
            reg = {}
            try:
                reg = load_registry()
            except Exception:
                pass
            body = {"app": APP_NAME, "cadquery": _cadquery_available(), "registry_version": reg.get("version"),
                    "part_types": sorted((reg.get("part_types") or {}).keys()),
                    "overlays": reg.get("overlays", []), "errors": reg.get("errors", []), "port": PORT,
                    "built": (DIST / "index.html").exists()}
            if "ollama=1" in (self.path.split("?", 1)[1] if "?" in self.path else ""):
                body["ollama"] = _ollama_up()
            return self._json(200, body)
        if path == "/api/registry":
            try:
                return self._json(200, load_registry())
            except Exception as exc:  # noqa: BLE001
                return self._json(500, {"error": f"registry unreadable: {exc}"})
        if path == "/api/designs":
            with _LOCK:
                designs = list(_load_store()["designs"].values())
            return self._json(200, sorted(designs, key=lambda d: d.get("updated", ""), reverse=True))
        if path.startswith("/api/designs/"):
            did = path.split("/")[3]
            with _LOCK:
                rec = _load_store()["designs"].get(did)
            return self._json(200, rec) if rec else self._json(404, {"error": "design not found"})
        if path == "/api/requests":
            with _LOCK:
                reqs = _load_store()["requests"]
            return self._json(200, list(reversed(reqs)))
        if path.startswith("/api/"):
            return self._json(404, {"error": f"unknown endpoint {path}"})

        # ---- the app ----
        if not (DIST / "index.html").exists():
            msg = (b"<h1>App not built</h1><p>Run <code>cd app &amp;&amp; npm install &amp;&amp; npm run build</code>, "
                   b"or use the dev server: <code>npm run dev</code> (port 5173).</p>")
            self.send_response(503)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return
        if path in ("/", "/index.html", "/studio"):
            self.path = "/index.html"
        elif path in ("/customer", "/customer/"):
            self.path = "/customer.html" + ("?" + self.path.split("?", 1)[1] if "?" in self.path else "")
        return super().do_GET()

    def do_PUT(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/designs/"):
            did = path.split("/")[3]
            try:
                payload = self._read_json()
            except Exception as exc:  # noqa: BLE001
                return self._json(400, {"error": f"invalid JSON: {exc}"})
            with _LOCK:
                store = _load_store()
                rec = store["designs"].get(did)
                if not rec:
                    return self._json(404, {"error": "design not found"})
                rec["payload"], rec["updated"] = payload, now()
                _save_store(store)
            return self._json(200, {"id": did})
        return self._json(404, {"error": f"unknown endpoint {path}"})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/ollama/"):
            return self._proxy_ollama("POST")
        try:
            body = self._read_json()
        except Exception as exc:  # noqa: BLE001
            return self._json(400, {"error": f"invalid JSON body: {exc}"})

        if path == "/api/validate":
            try:
                card = s5.validate_change_part(body.get("part_type", "starwheel"), body.get("branch_id", "web"),
                                               body.get("params") or {}, body.get("ovality_mm"))
            except (KeyError, ValueError, TypeError) as exc:
                return self._json(400, {"error": f"{type(exc).__name__}: {exc}"})
            return self._json(200, card)

        if path == "/api/step":
            part_type = body.get("part_type", "starwheel")
            builder = BUILDERS.get(part_type)
            if builder is None:
                return self._json(400, {"error": f"no CAD builder for part_type {part_type!r}"})
            if not _cadquery_available():
                return self._json(503, {"error": "cadquery is not installed on this machine (pip install cadquery)"})
            try:
                solid = builder(body.get("params") or {})
                with tempfile.TemporaryDirectory() as td:
                    out = Path(td) / f"{part_type}.step"
                    solid.val().exportStep(str(out))
                    data = out.read_bytes()
            except (KeyError, ValueError, TypeError) as exc:
                return self._json(400, {"error": f"{type(exc).__name__}: {exc}"})
            except Exception as exc:  # noqa: BLE001
                return self._json(500, {"error": f"CAD build failed: {exc}"})
            self.send_response(200)
            self.send_header("Content-Type", "application/step")
            self.send_header("Content-Disposition", f'attachment; filename="{part_type}.step"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/api/designs":
            did = _new_id()
            rec = {"id": did, "payload": body, "responses": [], "created": now(), "updated": now()}
            with _LOCK:
                store = _load_store()
                store["designs"][did] = rec
                _save_store(store)
            return self._json(201, {"id": did})

        if path.startswith("/api/designs/") and path.endswith("/responses"):
            did = path.split("/")[3]
            kind = body.get("kind")
            if kind not in ("approve", "request"):
                return self._json(400, {"error": "kind must be 'approve' or 'request'"})
            resp = {"kind": kind, "text": str(body.get("text", ""))[:5000],
                    "adjustments": body.get("adjustments") or {}, "answers": body.get("answers") or [], "ts": now()}
            with _LOCK:
                store = _load_store()
                rec = store["designs"].get(did)
                if not rec:
                    return self._json(404, {"error": "design not found"})
                rec["responses"].append(resp)
                rec["updated"] = now()
                _save_store(store)
            return self._json(201, {"ok": True})

        if path == "/api/requests":
            req = {"id": _new_id(), "contact": str(body.get("contact", ""))[:200], "company": str(body.get("company", ""))[:200],
                   "part_type": str(body.get("part_type", ""))[:60], "details": body.get("details") or {},
                   "notes": str(body.get("notes", ""))[:5000], "ts": now()}
            with _LOCK:
                store = _load_store()
                store["requests"].append(req)
                _save_store(store)
            return self._json(201, {"id": req["id"]})

        return self._json(404, {"error": f"unknown endpoint {path}"})


def main() -> None:
    mimetypes.add_type("application/json", ".json")
    mimetypes.add_type("text/javascript", ".js")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(APP_NAME)
    print(f"  studio    : http://localhost:{PORT}/")
    print(f"  customer  : http://localhost:{PORT}/customer")
    print(f"  app build : {'ok' if (DIST / 'index.html').exists() else 'MISSING — cd app && npm run build'}")
    print(f"  ollama    : {'up' if _ollama_up() else 'NOT reachable'} at {OLLAMA} (proxied at /api/ollama)")
    print("  Ctrl+C to stop", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
