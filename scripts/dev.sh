#!/usr/bin/env bash
# Start the ScholarGrid API (port 8000) and web app (port 3000). Ctrl+C stops both.
#   ./scripts/dev.sh            # both
#   ./scripts/dev.sh --install  # first run: install dependencies first
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY="$ROOT/.venv/Scripts/python.exe"
if [ ! -x "$PY" ]; then
  python3 -m venv "$ROOT/.venv"; PY="$ROOT/.venv/bin/python"; set -- --install
fi
if [ "${1:-}" = "--install" ]; then
  "$PY" -m pip install -r "$ROOT/requirements.txt"
  (cd "$ROOT/web" && npm install)
fi
trap 'kill 0' EXIT
(cd "$ROOT" && "$PY" -m scholargrid.api) &
(cd "$ROOT/web" && npm run dev) &
echo "API: http://127.0.0.1:8000/docs   Web: http://localhost:3000"
wait
