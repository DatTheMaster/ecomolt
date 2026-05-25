#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DURATION="${1:-3600}"
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "All processes stopped."

  echo ""
  echo "=========================================="
  echo " Short Season Test Summary"
  echo "=========================================="
  echo " Duration: ${DURATION}s"
  echo ""

  STATE=$(curl -s http://localhost:3000/api/state 2>/dev/null || echo "{}")
  if [ "$STATE" != "{}" ]; then
    echo " Final state:"
    echo " $STATE" | python3 -m json.tool 2>/dev/null || echo " $STATE"
  fi

  PROJECT=$(curl -s http://localhost:3000/api/project 2>/dev/null || echo "{}")
  if [ "$PROJECT" != "{}" ]; then
    echo ""
    echo " Project:"
    echo " $PROJECT" | python3 -m json.tool 2>/dev/null || echo " $PROJECT"
  fi

  CITIZENS=$(curl -s http://localhost:3000/api/citizens 2>/dev/null || echo "{}")
  if [ "$CITIZENS" != "{}" ]; then
    echo ""
    echo " Citizens:"
    echo " $CITIZENS" | python3 -m json.tool 2>/dev/null || echo " $CITIZENS"
  fi

  METRICS=$(curl -s http://localhost:3000/api/metrics 2>/dev/null || echo "{}")
  if [ "$METRICS" != "{}" ]; then
    echo ""
    echo " Metrics:"
    echo " $METRICS" | python3 -m json.tool 2>/dev/null || echo " $METRICS"
  fi

  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

echo "Ecomolt Short Season Integration Test"
echo "======================================"
echo ""
echo "Duration: ${DURATION}s (default: 3600 = 1 hour)"
echo "Tempo: dev (5s ticks, instant tasks)"
echo ""

AGENTS_CONFIG="${ROOT}/agents.json"
if [ ! -f "$AGENTS_CONFIG" ]; then
  echo "ERROR: $AGENTS_CONFIG not found."
  echo "Create one from agents.example.json with your NVIDIA NIM API key."
  exit 1
fi

echo "Building..."
npm run build --prefix "$ROOT" --silent 2>/dev/null

echo "Starting game server on :3000..."
TEMPO=dev node "$ROOT/packages/game-server/dist/index.js" &
PIDS+=($!)

sleep 2

echo "Starting agent-runner..."
node "$ROOT/packages/agent-runner/dist/cli.js" \
  --config "$AGENTS_CONFIG" \
  --api-url http://localhost:3000 &
PIDS+=($!)

sleep 2

echo ""
echo "=========================================="
echo " Short Season Test is running!"
echo "=========================================="
echo ""
echo " Game server:   http://localhost:3000"
echo " State:         http://localhost:3000/api/state"
echo " Citizens:      http://localhost:3000/api/citizens"
echo " Project:       http://localhost:3000/api/project"
echo " Events:        http://localhost:3000/api/events"
echo " Metrics:       http://localhost:3000/api/metrics"
echo ""
echo " Agent config:  $AGENTS_CONFIG"
echo " Duration:      ${DURATION}s"
echo ""
echo "Press Ctrl+C to stop early and see summary."
echo ""

sleep "$DURATION"
