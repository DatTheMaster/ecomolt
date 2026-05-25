# Passdown — Ecomolt Session Handoff

## Goal
- Get LLM-only agents to complete the full 4-stage project in a dev-tempo season (~52 min)
- No bots — the simulation must be self-sustaining with LLM agents
- Then move to M8: first live week-long season

## Constraints & Preferences
- TypeScript strict mode, ES2022, Node16 module resolution
- Monorepo with npm workspaces, build order: shared → simulation-core → game-server → mcp-server → agent-runner → client
- No bots. LLM agents only. This is non-negotiable — the live deployment will have zero bots.
- Always `npm run build` and `npm run test` after changes (76 tests must pass)
- API keys in `~/.hermes/auth.json` under `credential_pool`
- NIM is the most reliable provider; Groq and OpenRouter free tiers are heavily rate-limited

## What Changed This Session

### Bots Removed Entirely
- `packages/game-server/src/bots.ts` deleted
- All bot references stripped from `index.ts`: imports, config fields, bot seeding, bot tick loop, botId tracking
- `isBot` field still exists on Citizen type but is always `false` now

### Agent Runner Overhauled
- **Survival system added** — agents auto-buy food (hunger > 70, credits >= 10) or auto-gather food (hunger > 50, credits < 10) without waiting for LLM response
- **Per-provider rate limiting** — `RateLimiterRegistry` creates one `RateLimiter` per API key instead of one global limiter
- **Fallback threshold lowered** from 10 to 3 consecutive LLM failures
- **Fallback logic improved** — looks at project's most-needed resource instead of just gathering food
- **Dead/season-cycle handling** — detects whether citizen is dead or season cycled, re-registers on season change, goes idle if truly dead
- **Staggered startup** — 3s between each agent registration to avoid API stampede
- **Prompt improvements** — explicit "check connections before traveling", "no thinking in output", JSON-only enforcement, added `list_market` action
- **AbortSignal leak fixed** — shared `safeSleep()` with proper `removeEventListener`
- **Per-request timeout** — 20s timeout on all LLM fetch calls
- **Per-agent RPM config** — `rpm` field in agents.json

### Economy Tuning
- **Starting credits**: 50 → 100
- **Basic income**: 0 → 5 credits/tick per citizen
- **Food base price**: 5 → 3 credits/unit
- **Buy food fix**: now allows buying just 1 unit if agent can't afford full amount (was all-or-nothing)
- **Hunger rate**: 40/day → 15/day (~6.7 in-game days to starvation at dev tempo)
- **Dev season length**: 30 game-days → 60 game-days (2 real-days ≈ 52 min)
- **`totalDays`**: now derived from `seasonDurationDays * 30` instead of hardcoded 30

### Agent Config (agents.json)
6 agents across 3 providers:
- **Atlas** (NIM / llama-4-maverick) — workhorse, 70+ actions per season
- **Forge** (NIM / llama-4-maverick) — workhorse
- **Spark** (NIM / llama-3.3-70b-versatile via NIM) — productive
- **Sage** (Groq / llama-3.3-70b-versatile) — barely functional, 0-1 actions due to 30 RPM limit
- **Nova** (OpenRouter / minimax-m2.5:free) — intermittent, heavy 429s
- **Ember** (OpenRouter / minimax-m2.5:free) — intermittent, heavy 429s

## Current Test Results

Best run so far (before economy tuning was incomplete):
- Season 1, Day 84, 4 of 6 agents alive
- Stage 0 at 73.1% (ore 47/30 done, labor 10.1/20, wood 0/50)
- Atlas and Spark died of starvation (pre-survival-fix)
- No wood contributed at all — agents only gather ore/energy from mountains

After the latest round of fixes (basic income, lower food price, lower hunger rate, affordable food buys), the system has NOT been tested yet. The build passes and 76 tests pass, but no fresh run has been validated.

## Critical Problems (Ranked by Impact)

### 1. Agents Don't Contribute Wood
Stage 0 requires 50 wood. Agents gather ore from Western Mountains and energy from various regions, but never travel to forest biomes to gather wood. The LLMs don't understand the wood supply chain.
- **Fix ideas:** Add "most needed resource" to observe output, add wood-gathering to the fallback heuristic, mention wood regions explicitly in the prompt

### 2. Project Requirements Too High for 3 Productive Agents
Total project needs ~510 resource units + 140 labor. With only 3 reliably active NIM agents producing ~1.5 res/tick each = 4.5/tick, minimum non-stop gathering = ~113 ticks (9.4 min). But with travel/food/contribute overhead, realistically 3-4x that. A 60 game-day season (~1037 ticks at dev tempo) should be enough mathematically, but only if agents are efficient.
- **Fix ideas:** Scale project requirements for dev tempo / agent count, or increase number of NIM agents

### 3. Groq and OpenRouter Free Tiers Are Nearly Useless
- Groq: 30 RPM per key, 1 agent max. Backoff escalates to 60s, agent gets permanently stuck.
- OpenRouter (minimax): ~5 RPM effective. Agents spend most time in 429 retry loops.
- **Fix ideas:** Get a second NIM API key, or use paid tiers, or accept 3-agent runs

### 4. Season Cycling Can Kill Productive Agents
When a season ends, agents re-register but lose all progress. The 30s intermission + staggered startup means they miss early ticks of the new season.
- **Fix ideas:** Track last-seen season number in agent, skip re-registration if already registered

## What to Do Next (Build Order)

1. **Start a fresh test run** with all the economy fixes applied (basic income 5/tick, food price 3/unit, hunger 15/day, affordable food buys) and validate agents survive the full season
2. **Fix the wood contribution problem** — either:
   - Add `project.priorityResource` or "most needed" hint to observe output
   - Add explicit "gather wood from forest regions" instruction in the agent prompt
   - Make the fallback heuristic check which resource the project needs most and direct agents accordingly
3. **Scale project requirements** for dev tempo — consider reducing by 50-70% for testing, or adding a `projectScaleFactor` to `SeasonConfig`
4. **Consider replacing Groq/OpenRouter agents with more NIM agents** — 5-6 NIM agents would be far more productive than 3 NIM + 3 dead weight
5. **Run a full season completion test** — validate Stage 0 completes, then Stages 1-3
6. **Reimplement deterministic validation** (M7 Phase 5) for the no-bots era — maybe use scripted "dumb" agents instead of bots
7. **Clean up `agents.json`** — API keys are embedded; move to env vars or `~/.hermes/auth.json` references

## Key Files Modified This Session

| File | Change |
|---|---|
| `packages/game-server/src/bots.ts` | DELETED |
| `packages/game-server/src/index.ts` | Removed all bot imports, config, seeding, tick logic |
| `packages/agent-runner/src/agent.ts` | Survival checks, dead/season handling, per-agent RPM, fallback improvements |
| `packages/agent-runner/src/nim-client.ts` | Per-request timeout (20s), AbortSignal leak fix |
| `packages/agent-runner/src/rate-limiter.ts` | `RateLimiterRegistry` for per-provider limiting, `safeSleep()` |
| `packages/agent-runner/src/cli.ts` | Staggered startup, per-provider limiter creation, 30s stats interval |
| `packages/agent-runner/src/prompt.ts` | Travel constraints, JSON-only enforcement, `list_market` action, no-thinking rule |
| `packages/agent-runner/src/config.ts` | Added `rpm` field to `AgentConfig` |
| `packages/simulation-core/src/world.ts` | Basic income (5/tick), food price (3/unit base), buy_food affordability fix, hunger rate (15/day), starting credits (100), `totalDays` from tempo |
| `packages/shared/src/types.ts` | Dev tempo: seasonDurationDays 7→2, totalDays derived |
| `agents.json` | 6-agent config: 3 NIM, 1 Groq, 2 OpenRouter |

## Relevant Files (Full Map)

- `packages/shared/src/types.ts` — TempoConfig, CitizenTask, ResourceType, all shared types
- `packages/simulation-core/src/world.ts` — Main engine: tick(), executeAction(), all game logic, project stages, buy_food, hunger, basic income
- `packages/simulation-core/src/index.ts` — Re-exports from world.ts
- `packages/simulation-core/test.ts` — 76 tests
- `packages/game-server/src/index.ts` — Tick loop, HTTP API, WebSocket, no bots
- `packages/game-server/src/persistence.ts` — SQLite persistence (data/ecomolt.db)
- `packages/game-server/src/rate-limiter.ts` — Action rate limiting (game-side, separate from agent-runner)
- `packages/agent-runner/src/agent.ts` — Agent state machine, survival overrides, fallback logic
- `packages/agent-runner/src/nim-client.ts` — OpenAI-compatible LLM client with timeout + retry
- `packages/agent-runner/src/rate-limiter.ts` — Per-provider token bucket rate limiter
- `packages/agent-runner/src/cli.ts` — CLI entry point, agent orchestration, stats logging
- `packages/agent-runner/src/prompt.ts` — System prompt template
- `packages/agent-runner/src/api-client.ts` — Game server HTTP client
- `packages/agent-runner/src/config.ts` — agents.json loader
- `agents.json` — Agent configuration (names, models, API keys, RPM)
- `~/.hermes/auth.json` — Credential pool (NVIDIA, Groq, OpenRouter keys)

## Running a Test

```bash
# 1. Kill any old processes
pkill -9 -f "game-server/dist/index" 2>/dev/null
pkill -9 -f "agent-runner/dist/cli" 2>/dev/null

# 2. Wipe data for fresh start
rm -rf /home/deshiel/projects/ecomolt/data

# 3. Build
cd /home/deshiel/projects/ecomolt && npm run build && npm run test

# 4. Start game server (background)
TEMPO=dev node packages/game-server/dist/index.js &

# 5. Wait for server ready, then start agent runner
sleep 3
node packages/agent-runner/dist/cli.js --config agents.json --api-url http://localhost:3000

# 6. Monitor progress
curl -s http://localhost:3000/api/state | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Day {d[\"day\"]}, Alive: {d[\"aliveCitizens\"]}')"
curl -s http://localhost:3000/api/project | python3 -c "import sys,json; ..."  # see project progress
curl -s http://localhost:3000/api/citizens | python3 -c "import sys,json; ..."  # see agent health
```

## Critical Context

- `Citizen.currentTask` must be checked before allowing actions — if set, citizen is busy
- Task durations are defined in real-time seconds, converted to ticks via `Math.ceil(durationSeconds / (tickIntervalMs / 1000))`
- `observe`, `say`, `journal` are always instant (no task queued)
- Dev mode (TEMPO=dev or default): tasks have 0 duration (instant), preserving backward compat with tests
- `hungerPerTick = targetHungerPerDay / ticksPerDay` — currently 15/day at all tempos
- `totalDays = seasonDurationDays * 30` — derived from tempo config
- `packages/agent-runner` talks to game server HTTP API directly — no dependency on simulation-core types
- Region connections are in the observe output — agents should read them before traveling
- Food is purchased from the current region — agents in mountains may have no food to buy
- Region biomes determine available resources: forest=wood, mountains=ore/energy, coast=food, settlement=no gathering
- Pollution increases food price via scarcity multiplier
- The `buy_food` action now buys only what the agent can afford (1 unit minimum)
