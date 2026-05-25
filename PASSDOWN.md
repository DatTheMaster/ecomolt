# PASSDOWN — Ecomolt Session Handoff

## Current State: LIVE TEMPO TEST — STABLE AND PROGRESSING

**Started:** 2026-05-25 (latest restart with critical survival fixes)
**Server:** `TEMPO=live` on port 3000, DB at `data/ecomolt-live.db`
**Agent Runner:** session `proc_9b05e71433f8`, 12 NIM agents
**Status:** 12/12 alive, 0 deaths, 0 low HP, contributions flowing

## Critical Fixes Applied This Session

### 1. Conditional Auto-Eat (simulation-core)
- Auto-eat only triggers when `hunger > 30` (was: always when food > 0)
- Prevents wasting food at low hunger — agents stockpile as buffer
- File: `packages/simulation-core/src/world.ts` line ~1702

### 2. Reduced Hunger Rate (simulation-core)
- `targetHungerPerDay` reduced from 15 to 8
- Live tempo: `hungerPerTick ≈ 2.78` (was ~5.2)
- LLM agents get 3-4 action cycles before health damage (was 1-2)
- File: `packages/simulation-core/src/world.ts` line ~160

### 3. Stale isBusy Fix (agent-runner)
- Survival check now uses fresh `citizenData.currentTask` from server
- Previously used stale `this.currentTask` → false "busy" emergency buys
- File: `packages/agent-runner/src/agent.ts` line ~135

### 4. Smart Productivity Override (agent-runner)
- Picks lowest-fill resource in biome (not just global priority)
- Mountains agents gather ore/energy instead of traveling to forest
- Forest agents can gather food when wood is >80% full
- File: `packages/agent-runner/src/agent.ts` line ~270

### 5. buy_food Instant + Allowed While Busy
- `buyFoodMin=0, buyFoodMax=0` in task durations
- `buyFood` exempt from `requireIdle` check in world.ts
- Agents can buy food while gathering/contributing

### 6. Deposit Regeneration (simulation-core)
- Food regrows based on fertility × soil × rainfall per tick
- Wood regrows in forests (0.3/tick), ore regenerates slowly (0.02/tick)
- Energy regrows in mountains/coast (0.15/tick)

## Survival Override System (agent-runner)

1. **Idle, hunger>60, cooldown 3+ ticks** → buy food, skip LLM turn
2. **Busy, hunger>70** → buy food but DON'T interrupt task (prevents health damage at 80+)
3. **Can't afford food, hunger>30** → gather food from current region

## Productivity Override System (agent-runner)

- If LLM chose `travel` or `buy_food` and agent is idle:
  1. Check if current biome has the lowest-fill resource → override to gather it
  2. If no useful resources in biome → redirect travel to correct biome
- Auto-contribute when agent has 3+ units of a resource the project needs

## 20-Minute Check Results
- Day 52, Alive 12/12, Stage 0
- Wood: 20/50 (40%), Ore: 15/30 (50%), Labor: 8.6/20 (43%)
- 0 deaths, 0 low HP, fallback counts 0-1 per agent
- Priority still wood, ore catching up fast
- Estimated stage 0 completion: ~25-35 more minutes

## Monitoring
- 30-min check: `proc_347516b96078` (scheduled)
- Cron: every 4h (`45b3ca12f354`)
- Agent runner: `proc_9b05e71433f8`
- Game server: `proc_a3832523a830`

## Next Steps
- Wait for 30-minute check to confirm long-term stability
- If stable: let it run for 7 days to observe emergent behavior
- Watch for: agent communication, law proposals, elections, trade
- No code changes needed unless agents start dying

## Build & Test
- `npm run build` — passes
- `npm run test` — 76/76 pass
- Latest commit: `034f137` — pushed to GitHub

## Agents Configuration
- 12 agents, all using NVIDIA NIM (llama-4-maverick-17b-128e-instruct)
- API key from `~/.hermes/auth.json` (credential_pool.nvidia[0])
- RPM: 40 per agent (well within free tier limits)
