"""Run the API server: ``python -m scholargrid.api [--host 127.0.0.1] [--port 8000] [--config PATH]``."""
from __future__ import annotations

import argparse
import os


def main() -> None:
    p = argparse.ArgumentParser(description="ScholarGrid API server (FastAPI + uvicorn)")
    p.add_argument("--host", default=os.environ.get("SCHOLARGRID_API_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("SCHOLARGRID_API_PORT", "8000")))
    p.add_argument("--config", default=None, help="config YAML (default: SCHOLARGRID_CONFIG or configs/config.yaml)")
    p.add_argument("--reload", action="store_true", help="auto-reload on code changes (development)")
    p.add_argument("--openapi", metavar="FILE", help="write the OpenAPI schema to FILE and exit")
    args = p.parse_args()
    if args.config:
        os.environ["SCHOLARGRID_CONFIG"] = args.config

    if args.openapi:
        import json

        from .main import create_app
        from .state import AppState

        app = create_app(AppState(), load_on_start=False)
        with open(args.openapi, "w", encoding="utf-8") as fh:
            json.dump(app.openapi(), fh, indent=1)
        print(f"Wrote {args.openapi}")
        return

    import uvicorn

    if args.reload:
        uvicorn.run("scholargrid.api.main:create_app", factory=True, host=args.host, port=args.port, reload=True,
                    reload_dirs=["scholargrid"])
    else:
        from .main import create_app

        uvicorn.run(create_app(), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
