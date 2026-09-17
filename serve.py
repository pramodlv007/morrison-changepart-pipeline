"""
Morrison change-part pipeline — local backend + static server
==============================================================

    python serve.py            ->  http://localhost:8765/            (developer dashboard)
                                   http://localhost:8765/customer     (customer page)

Serves the two pages plus:

    GET  /api/health       {"ollama": bool, "cadquery": bool, "registry_version": str}
    GET  /api/registry     parts/registry.json  (the part-type registry the pages consume)
    POST /api/validate     {"part_type", "params", "ovality_mm"}  -> stage5_engine scorecard
    POST /api/step         {"part_type", "params"}                 -> STEP file (trusted builders)

Standard library only. The LLM stages still talk to Ollama directly from the
browser; this server is the deterministic side of the pipeline: the same Python
Stage 5 engine the notebooks use, and CAD-ready STEP export built with CadQuery
from the *validated* parameters (never by executing model-generated code).
"""

from __future__ import annotations

import importlib.util
import json
import mimetypes
import os
import sys
import tempfile
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
REGISTRY_PATH = ROOT / "parts" / "registry.json"
PORT = int(os.environ.get("PIPELINE_PORT", "8765"))
OLLAMA = os.environ.get("OLLAMA_HOST_URL", "http://localhost:11434")

sys.path.insert(0, str(ROOT))
import stage5_engine as s5  # noqa: E402

BUILDERS = {
    "starwheel": s5.build_starwheel_solid,
    "feed_screw": s5.build_feed_screw_solid,
    "guide_rail": s5.build_guide_rail_solid,
}

_CQ_PRESENT = None


def load_registry() -> dict:
    """parts/registry.json plus any parts/*.part.json overlays.

    An overlay has the same shape ({"part_types": {...}, "precedents": [...]}) and lets a
    new change part (or extra precedents / RAG entries for an existing one) live in its
    own file without touching the core registry.
    """
    data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    data.setdefault("part_types", {})
    data.setdefault("precedents", [])
    overlays, errors = [], []
    for extra in sorted(REGISTRY_PATH.parent.glob("*.part.json")):
        try:
            o = json.loads(extra.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            # Surfaced to the dashboard too — a silently ignored part file is baffling.
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


def _cadquery_available() -> bool:
    """Presence check only — importing cadquery pulls in OCCT and takes several
    seconds, which would stall /api/health past the browser's timeout."""
    global _CQ_PRESENT
    if _CQ_PRESENT is None:
        try:
            _CQ_PRESENT = importlib.util.find_spec("cadquery") is not None
        except Exception:
            _CQ_PRESENT = False
    return _CQ_PRESENT


def _ollama_up() -> bool:
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    # ---- helpers -----------------------------------------------------------
    def _json(self, code: int, payload) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self) -> None:
        # The dashboard may also be opened straight from disk (file://); allow it.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args) -> None:  # quieter console: API calls and errors only
        first = str(args[0]) if args else ""
        if "/api/" in first or fmt.startswith("code "):
            super().log_message(fmt, *args)

    # ---- routing -----------------------------------------------------------
    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            self.path = "/pipeline_dashboard.html"
        elif path in ("/customer", "/customer/"):
            self.path = "/customer.html"
        elif path == "/api/health":
            reg = {}
            try:
                reg = load_registry()
            except Exception:
                pass
            # The Ollama probe costs ~2 s on some machines, so it is opt-in (?ollama=1).
            # The dashboard pings Ollama directly for its own badge.
            body = {"cadquery": _cadquery_available(), "registry_version": reg.get("version"),
                    "part_types": sorted((reg.get("part_types") or {}).keys()),
                    "overlays": reg.get("overlays", []), "errors": reg.get("errors", []), "port": PORT}
            if "ollama=1" in (self.path.split("?", 1)[1] if "?" in self.path else ""):
                body["ollama"] = _ollama_up()
            return self._json(200, body)
        elif path == "/api/registry":
            try:
                data = load_registry()
            except Exception as exc:  # noqa: BLE001
                return self._json(500, {"error": f"registry unreadable: {exc}"})
            return self._json(200, data)
        return super().do_GET()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        try:
            body = self._read_json()
        except Exception as exc:  # noqa: BLE001
            return self._json(400, {"error": f"invalid JSON body: {exc}"})

        if path == "/api/validate":
            part_type = body.get("part_type", "starwheel")
            params = body.get("params") or {}
            try:
                card = s5.validate_change_part(part_type, body.get("branch_id", "web"), params, body.get("ovality_mm"))
            except (KeyError, ValueError, TypeError) as exc:
                return self._json(400, {"error": f"{type(exc).__name__}: {exc}"})
            return self._json(200, card)

        if path == "/api/step":
            part_type = body.get("part_type", "starwheel")
            params = body.get("params") or {}
            builder = BUILDERS.get(part_type)
            if builder is None:
                return self._json(400, {"error": f"no CAD builder for part_type {part_type!r}"})
            if not _cadquery_available():
                return self._json(503, {"error": "cadquery is not installed on this machine (pip install cadquery)"})
            try:
                solid = builder(params)
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
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return

        return self._json(404, {"error": f"unknown endpoint {path}"})


def main() -> None:
    mimetypes.add_type("application/json", ".json")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)  # bind first, report after
    print("Morrison change-part pipeline backend")
    print(f"  dashboard : http://localhost:{PORT}/")
    print(f"  customer  : http://localhost:{PORT}/customer")
    print(f"  ollama    : {'up' if _ollama_up() else 'NOT reachable'} at {OLLAMA}")
    print("  cadquery  : checked lazily on the first /api/health or /api/step call (OCCT import takes a few seconds)")
    print("  Ctrl+C to stop", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
