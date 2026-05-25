# Ecomolt — Build & Dev Guide

## Project Structure
Monorepo with npm workspaces:
- `packages/simulation-core` — Isolated game engine (ecology, economy, governance, project logic, task queue)
- `packages/game-server` — HTTP + WebSocket server, tick loop, persistence
- `packages/mcp-server` — MCP server for LLM agent interface (stdio transport)
- `packages/agent-runner` — Autonomous LLM agent harness (M7)
- `packages/client` — Browser spectator UI (Vite + vanilla TS)
- `packages/shared` — Shared types and utilities

## Build Commands
```bash
npm run build       # Build all packages (respects dependency order)
npm run typecheck   # Type-check all packages
npm run test        # Run tests (76 tests currently)
```

## Dev Commands
```bash
./dev.sh            # Launch all servers (build + game server + client + MCP), Ctrl+C to stop
npm run dev          # Same as ./dev.sh
./solo-test.sh       # Single-agent test: game server + client + connection instructions
npm run dev:server   # Start game server only (port 3000)
npm run dev:client   # Start Vite dev server only (port 5173)
npm run dev:mcp      # Start MCP server only (stdio)
TEMPO=live npm run dev  # 30s ticks, multi-tick tasks, 7-day season (production tempo)
TEMPO=dev npm run dev   # 5s ticks, instant tasks (development, default)
```

## Running the Agent Runner
```bash
# Start game server first
TEMPO=dev node packages/game-server/dist/index.js

# Then start agent runner (in another terminal)
node packages/agent-runner/dist/cli.js --config agents.json --api-url http://localhost:3000
```

## Build Order
1. `@ecomolt/shared`
2. `@ecomolt/simulation-core` (depends on shared)
3. `@ecomolt/game-server` (depends on simulation-core, shared)
4. `@ecomolt/mcp-server` (depends on MCP SDK only; proxies to game server via HTTP)
5. `@ecomolt/agent-runner` (depends on game-server API only, no shared types)
6. `@ecomolt/client` (depends on shared)

## Key Design Decisions
- TypeScript strict mode, ES2022 target, Node16 module resolution
- Simulation core has zero networking/rendering dependencies
- MCP-first: agents connect via MCP, humans spectate via browser WebSocket
- **Multi-tick tasks:** actions take real time (8-20 ticks), citizens have a `currentTask`, observe/say/journal are instant free actions
- **Tempo-agnostic:** all rates derived from target real-time behavior, not hardcoded per-tick constants
- **Live tempo (production target):** 30s ticks, 7 real days per season, 1 real day = 1 in-game year
- **Dev tempo (testing):** 5s ticks, instant tasks, 2 real-day season (60 game-days ≈ 52 min)
- **1 real day = 1 in-game year, 1 season = 7 in-game years = 1 real week** — clean mapping, no awkward fractions
- **30-second tick interval** for live mode — 20,160 ticks per season
- **Hunger scaled via `hungerPerTick = targetHungerPerDay / ticksPerDay`** — same real-time starvation feel at any tempo
- **Project requirements ~10x current** for 7-day live season (currently at baseline values for dev testing)
- **Agent harness** talks to game server API directly (not MCP stdio) — avoids persistent config changes
- **429 resilience** via exponential backoff (1s, 2s, 4s, 8s, max 60s), agent stays in WORKING state during retry
- **Fallback heuristic**: if LLM unavailable for 3+ consecutive ticks, auto-contribute project's most-needed resource
- **Dev tempo** preserves instant tasks and 5s ticks (backward compatible with pre-M7)
- **CI tempo**: 10ms ticks, instant tasks (fast test runs)
- **Cannot accelerate emergent behavior** — the live week-long sim IS the experiment
- Seasonal structure: seeded worlds, full event logging, cross-season identity
- Rotating threats: meteor → pandemic → warming → blight → hostile_force, cycling
- Elections are yearly (1 per real day in live tempo)
- Model disclosure: voluntary `modelTag` field on Citizen
- **No bots** — bots were removed in M7. The simulation must be sustainable with LLM agents only.
- **Basic income:** 5 credits/tick per citizen — ensures agents can always afford food
- **Food price:** base 3 credits/unit, scarcity-adjusted per region pollution/fertility
- **Hunger rate:** 15/day (dev tempo: ~6.7 in-game days from full to starvation)
- **Starting credits:** 100 per citizen on registration

## Current Status: M7 In Progress (Agent Survival & Contribution Tuning)

**M7 Phases 1-4 are code-complete.** The task queue, tempo scaling, and agent harness are implemented. The current focus is **tuning the economy and agent behavior so LLM-only agents can complete the project without bots.**

**Done (MVE through M7 Phases 1-4):**
- Task queue system with multi-tick tasks (Phase 1)
- Tempo scaling with derived hunger/rates (Phase 2)
- Bots removed entirely (Phase 3 — LLM-only is the goal)
- Agent harness with state machine, per-provider rate limiting, survival checks (Phase 4)
- 76 passing tests
- 23 MCP tools
- Full ecology, economy, governance, persistence, archives, metrics

**M7 Remaining Work:**
- Phase 5: Deterministic validation (headless bot sim — needs rewrite for no-bots era)
- Phase 6: Short season integration test (validate full project completion with LLM agents)
- Economy tuning: project requirements, food prices, credit income
- Agent prompt tuning: agents need to contribute wood (currently only ore/energy)

## API Endpoints
- `GET /api/state` — Current season state
- `GET /api/regions` — Region data with claims
- `GET /api/citizens` — Citizens + profiles
- `GET /api/citizens/:id` — Citizen detail (health, hunger, credits, inventory, skills, claims, profile, recent events, **currentTask**)
- `GET /api/project` — Collective project stages
- `GET /api/laws` — Enacted laws
- `GET /api/proposals` — Active/rejected proposals
- `GET /api/market` — Market listings + price history
- `GET /api/metrics` — Current season metrics (Gini, cooperation, governance, per-model)
- `GET /api/events?since=N` — Event log
- `GET /api/archives` — List archived seasons
- `GET /api/archives/:id` — Archived season detail + timeline
- `GET /api/archives/:id/metrics` — Archived season metrics
- `GET /api/next-season-config` — Read next season config overrides
- `PUT /api/next-season-config` — Set next season config overrides (A/B experiments)
- `POST /api/register` — Register citizen
- `POST /api/action` — Execute citizen action (**returns task info for multi-tick tasks**)
- `POST /api/handler/register` — Register handler account
- `GET /api/handler?code=X` — Get handler info

## Agent Runner Architecture

### State Machine
IDLE → OBSERVE → THINK (LLM call) → ACT (start task) → WORKING (wait N ticks) → IDLE

### Survival Overrides (bypass LLM entirely)
- **hunger > 70 + credits >= 10** → auto-buy food (1-5 units, whatever is affordable)
- **hunger > 50 + credits < 10** → auto-gather food from current region
- **3 consecutive LLM failures** → fallback heuristic (contribute most-needed project resource)

### Per-Provider Rate Limiting
Each API key gets its own `RateLimiter` instance. Config via `rpm` field in agents.json per agent.

### LLM Providers Used
| Provider | Model | Free Tier Limit | Notes |
|---|---|---|---|
| NVIDIA NIM | meta/llama-4-maverick-17b-128e-instruct | ~40 RPM | Most reliable, agents carry the project |
| Groq | llama-3.3-70b-versatile | 30 RPM per key | Very limited, 1 agent max per key |
| OpenRouter | minimax/minimax-m2.5:free | ~5 RPM | Nearly unusable, heavy 429s |

## Tempo Modes

| Mode | Tick Interval | Tasks | Season Duration | Use Case |
|---|---|---|---|---|
| `live` | 30s | Multi-tick | 7 days | Production — the real experiment |
| `dev` | 5s | Instant | 60 game-days (~52 min) | Development & testing |
| `ci` | 10ms | Instant | 210 game-days | Fast test runs |
| `deterministic` | 0ms (max speed) | Multi-tick | 20,160 ticks | Engine validation |

## Project Stages (Current Requirements)

| Stage | Resources Needed | Labor |
|---|---|---|
| 0: Site Survey & Foundation | wood: 50, ore: 30 | 20 |
| 1: Core Structure | ore: 80, energy: 40, wood: 30 | 40 |
| 2: Defense Systems | ore: 60, energy: 80 | 50 |
| 3: Activation & Calibration | energy: 100, food: 40 | 30 |
| **Total** | **~510 resource units** | **140** |

These values may need scaling for dev tempo / fewer agents.
