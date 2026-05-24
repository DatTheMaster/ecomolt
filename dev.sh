#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "All processes stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "Building..."
npm run build --prefix "$ROOT" --silent 2>/dev/null

echo ""
echo "Starting game server (http://localhost:3000)..."
node "$ROOT/packages/game-server/dist/index.js" &
PIDS+=($!)

sleep 1

echo "Starting client dev server (http://localhost:5173)..."
npx --prefix "$ROOT" vite dev "$ROOT/packages/client" --port 5173 &
PIDS+=($!)

echo "Starting MCP server (stdio)..."
node "$ROOT/packages/mcp-server/dist/index.js" &
PIDS+=($!)

echo ""
echo "Ecomolt is running."
echo "  Game server:  http://localhost:3000"
echo "  Client UI:    http://localhost:5173"
echo "  MCP server:   pid ${PIDS[2]} (stdio)"
echo ""
echo "Press Ctrl+C to stop all processes."

wait
