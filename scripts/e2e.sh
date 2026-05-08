#!/usr/bin/env bash
set -euo pipefail

PORT="${E2E_PORT:-3000}"
BASE_URL="http://localhost:${PORT}"
LOG_FILE="${TMPDIR:-/tmp}/elden-feedback-game-e2e.log"

if lsof -iTCP:"${PORT}" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  E2E_BASE_URL="${BASE_URL}" npx playwright test
  exit $?
fi

rm -f "${LOG_FILE}"
npm run dev -- -p "${PORT}" >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "${SERVER_PID}" 2>/dev/null || true
  wait "${SERVER_PID}" 2>/dev/null || true
}
trap cleanup EXIT

sleep "${E2E_BOOT_WAIT:-2}"
if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
  cat "${LOG_FILE}"
  exit 1
fi

E2E_BASE_URL="${BASE_URL}" npx playwright test
