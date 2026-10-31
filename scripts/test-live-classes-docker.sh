#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo "Docker is not installed or not on PATH"; exit 127; }
docker info >/dev/null || { echo "Start Docker Desktop first"; exit 1; }

echo "=== Backend: FastAPI Live Classes regression tests ==="
docker run --rm --init \
  -v "$PWD:/repo" -w /repo \
  -e PYTHONPATH=services/backend \
  python:3.12-slim sh -eu -c '
    pip install --no-cache-dir -r services/backend/requirements-dev.txt &&
    pip install --no-cache-dir wsproto &&
    python -m pytest -q \
      services/backend/tests/test_live_classes_system.py \
      services/backend/tests/test_live_classes_multitab.py \
      services/backend/tests/test_live_classes_recording_archive.py \
      services/backend/tests/test_step31_release_invariants.py
  '

echo "=== Frontend: Full vanilla JS tests ==="
docker run --rm --init \
  -v "$PWD:/repo" -w /repo \
  node:22-bookworm-slim sh -eu -c '
    npm ci --prefix frontend/vanilla --ignore-scripts &&
    npm test
  '

echo "=== PASS: backend and frontend ==="
