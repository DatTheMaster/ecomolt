# PASSDOWN — Ecomolt Session Handoff

## Current State: LIVE TEMPO — STAGE 1 IN PROGRESS, 7-DAY OBSERVATION

**Started:** 2026-05-25 (latest restart with critical survival fixes)
**Server:** `TEMPO=live` on port 3000, DB at `data/ecomolt-live.db`
**Agent Runner:** session `proc_9b05e71433f8`, 12 NIM agents
**Milestone:** Stage 0 completed at ~35 min. Stage 1 started. Priority: ore.
**Health:** 12/12 alive, 0 deaths, 0 low HP. All stable.

## 30-Minute Test Results (PASSED)
- 12/12 alive for entire 30 minutes
- Stage 0 completed: wood 55/50, ore 30/30, labor 21/20
- 0 deaths, 0 low HP events
- Fallback counts 0-1 per agent (minimal survival intervention)
- Smart productivity override working (mountains→ore, forest→wood)
- Auto-contribute triggering correctly (3+ units → contribute)

## Critical Fixes Applied This Session

### 1. Conditional Auto-Eat (simulation-core)
- Auto-eat only triggers when `hunger > 30` (was: always when food > 0)
- Prevents wasting food at low hunger — agents stockpile as buffer

### 2. Reduced Hunger Rate (simulation-core)
- `targetHungerPerDay = 8` (was 15) — `hungerPerTick ≈ 2.78` in live tempo
- Gives LLM agents 3-4 action cycles before health damage

### 3. Stale isBusy Fix (agent-runner)
- Uses `citizenData.currentTask` from server (was `this.currentTask`)

### 4. Smart Productivity Override (agent-runner)
- Picks lowest-fill resource in biome, not just global priority
- Mountains agents gather ore/energy; forest agents gather wood/food

### 5. buy_food Instant + Allowed While Busy
- `buyFoodMin=0, buyFoodMax=0` in task durations
- Agents can buy food while gathering/contributing

### 6. Deposit Regeneration (simulation-core)
- Food, wood, ore, energy all regenerate per tick

## Monitoring
- Cron: every 4h (`45b3ca12f354`) — checks state, deaths, progress
- Agent runner: `proc_9b05e71433f8`
- Game server: `proc_a3832523a830`

## Emergent Behavior to Watch For
- Agent communication (say/journal actions)
- Law proposals and voting
- Elections (every game year = 1 real day)
- Trade between agents
- Resource specialization patterns
- Social dynamics (cooperation vs competition)

## Recovery
```bash
# If agent runner dies:
cd /home/deshiel/projects/ecomolt
TEMPO=live node packages/agent-runner/dist/cli.js --config agents.json --api-url http://localhost:3000 &

# If game server dies:
cd /home/deshiel/projects/ecomolt
TEMPO=live DB_PATH=./data/ecomolt-live.db ARCHIVE_DIR=./data/live-archives PORT=3000 node packages/game-server/dist/index.js &
```

## Build & Test
- `npm run build` — passes
- `npm run test` — 76/76 pass
- Latest commit: `ccc3684` — pushed to GitHub
