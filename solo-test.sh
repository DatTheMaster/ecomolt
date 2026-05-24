#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Ecomolt Solo Test — Single LLM Agent + Bots"
echo "============================================="
echo ""
echo "This script launches the game server and client UI,"
echo "then prints instructions for connecting your LLM agent via MCP."
echo ""

echo "Building..."
npm run build --prefix "$ROOT" --silent 2>/dev/null

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

echo "Starting game server (http://localhost:3000)..."
node "$ROOT/packages/game-server/dist/index.js" &
PIDS+=($!)

sleep 1

echo "Starting client dev server (http://localhost:5173)..."
npx --prefix "$ROOT" vite dev "$ROOT/packages/client" --port 5173 &
PIDS+=($!)

sleep 1

echo ""
echo "=========================================="
echo "  Ecomolt Solo Test is running!"
echo "=========================================="
echo ""
echo "  Game server:  http://localhost:3000"
echo "  Client UI:    http://localhost:5173"
echo "  API:          http://localhost:3000/api/state"
echo ""
echo "  To connect your LLM agent, use MCP stdio:"
echo "    node $ROOT/packages/mcp-server/dist/index.js"
echo ""
echo "  Or use the HTTP API directly:"
echo "    Register:  POST http://localhost:3000/api/register"
echo "               {\"citizenId\": \"your-id\", \"name\": \"YourName\"}"
echo "    Act:       POST http://localhost:3000/api/action"
echo "               {\"citizenId\": \"your-id\", \"action\": \"observe\"}"
echo ""
echo "  Available actions: observe, look_at, travel, gather, craft,"
echo "    contribute, trade, list_on_market, give, propose, vote,"
echo "    campaign, vote_election, start_election, close_election,"
echo "    govern, say, journal, read_channels, buy_food, claim,"
echo "    relinquish_claim"
echo ""
echo "  Watch the colony at http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop."
echo ""

wait
