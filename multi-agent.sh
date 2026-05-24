#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

AGENTS_FILE="${1:-}"
if [ -z "$AGENTS_FILE" ]; then
  echo "Usage: ./multi-agent.sh <agents.json>"
  echo ""
  echo "agents.json format:"
  echo '  ['
  echo '    {"id": "agent-1", "name": "Atlas", "modelTag": "gpt-4"},'
  echo '    {"id": "agent-2", "name": "Nova", "modelTag": "claude-3.5"},'
  echo '    {"id": "agent-3", "name": "Zenith", "modelTag": "gemini-pro"}'
  echo '  ]'
  echo ""
  echo "Each agent gets its own MCP server process (stdio)."
  echo "Connect your LLM client to each MCP process separately."
  echo ""
  echo "Environment variables:"
  echo "  ECOMOLT_API_URL  - Game server URL (default: http://localhost:3000)"
  echo "  ECOMOLT_TICK_MS  - Tick interval in ms (default: 5000)"
  exit 1
fi

if [ ! -f "$AGENTS_FILE" ]; then
  echo "Error: $AGENTS_FILE not found"
  exit 1
fi

TICK_MS="${ECOMOLT_TICK_MS:-5000}"

echo "Ecomolt Multi-Agent Test"
echo "========================"
echo "Agents config: $AGENTS_FILE"
echo "Tick interval: ${TICK_MS}ms"
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
ECOMOLT_TICK_INTERVAL_MS="$TICK_MS" node "$ROOT/packages/game-server/dist/index.js" &
PIDS+=($!)

sleep 2

echo ""
echo "Registering agents..."
AGENT_COUNT=0
while IFS= read -r line; do
  AGENT_ID=$(echo "$line" | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
  AGENT_NAME=$(echo "$line" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
  AGENT_MODEL=$(echo "$line" | grep -o '"modelTag"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')

  if [ -n "$AGENT_ID" ] && [ -n "$AGENT_NAME" ]; then
    BODY="{\"citizenId\":\"$AGENT_ID\",\"name\":\"$AGENT_NAME\""
    if [ -n "$AGENT_MODEL" ]; then
      BODY="$BODY,\"modelTag\":\"$AGENT_MODEL\""
    fi
    BODY="$BODY}"

    RESULT=$(curl -s -X POST http://localhost:3000/api/register -H "Content-Type: application/json" -d "$BODY" 2>/dev/null || echo '{"success":false}')
    SUCCESS=$(echo "$RESULT" | grep -o '"success"[[:space:]]*:[[:space:]]*true' || true)
    if [ -n "$SUCCESS" ]; then
      echo "  Registered: $AGENT_NAME ($AGENT_ID)${AGENT_MODEL:+ [model: $AGENT_MODEL]}"
      AGENT_COUNT=$((AGENT_COUNT + 1))
    else
      MSG=$(echo "$RESULT" | grep -o '"message"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')
      echo "  Failed: $AGENT_NAME ($AGENT_ID) - ${MSG:-unknown error}"
    fi
  fi
done < <(cat "$AGENTS_FILE" | python3 -c "import sys,json; [print(json.dumps(a)) for a in json.load(sys.stdin)]" 2>/dev/null || cat "$AGENTS_FILE" | grep -o '{[^}]*}')

echo ""

echo "Starting client dev server (http://localhost:5173)..."
npx --prefix "$ROOT" vite dev "$ROOT/packages/client" --port 5173 &
PIDS+=($!)

sleep 1

echo ""
echo "=========================================="
echo " Ecomolt Multi-Agent Test is running!"
echo "=========================================="
echo ""
echo " Game server:   http://localhost:3000"
echo " Client UI:     http://localhost:5173"
echo " API:           http://localhost:3000/api/state"
echo " Agents:        $AGENT_COUNT registered"
echo ""
echo " To connect each LLM agent via MCP stdio:"
echo "   ECOMOLT_API_URL=http://localhost:3000 \\"
echo "     node $ROOT/packages/mcp-server/dist/index.js"
echo ""
echo " Each MCP process serves ONE agent."
echo " The agent must first call 'register' with its citizenId and name,"
echo " or you can use an already-registered citizenId directly."
echo ""
echo " MCP client config example (Claude Desktop, Cline, etc.):"
echo '  {'
echo '    "mcpServers": {'
echo '      "ecomolt": {'
echo '        "command": "node",'
echo "        \"args\": [\"$ROOT/packages/mcp-server/dist/index.js\"],"
echo '        "env": { "ECOMOLT_API_URL": "http://localhost:3000" }'
echo '      }'
echo '    }'
echo '  }'
echo ""
echo "Press Ctrl+C to stop."
echo ""

wait
