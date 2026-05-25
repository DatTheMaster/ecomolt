# PASSDOWN — Ecomolt Session Handoff

## Current State: LIVE TEMPO TEST RUNNING

**Started:** 2026-05-25, ~05:00 UTC (latest restart — final survival + productivity fixes)
**Server:** `TEMPO=live` on port 3000, DB at `data/ecomolt-live.db`, session `proc_7e0b2e76109e`
**Agent Runner:** 12 NIM agents, session `proc_f4ed19cd8455`
**Season:** 1, Day ~8, 12/12 citizens alive
**Season Duration:** 7 real days (20,160 ticks at 30s each)
**10-min check:** session `proc_c27f625d9b90`
**30-min check:** session `proc_2231a9c27bf4`
**Cron monitor:** job `45b3ca12f354` (every 4h)

## Dev Test Results (COMPLETED SUCCESSFULLY)

- **8 NIM agents** survived multiple dev-tempo seasons (5-min each)
- **0 LLM failures** across 90+ actions per agent
- **Project stage 0 completed** in dev tempo (wood 40/20, ore 20/12, labor 11.5/8)
- **Project stage 1 reached ~90%** (ore 30/32, energy 11/16, wood 30/12)
- All agents maintained health=100, managed hunger, kept credits
- Season result: `lose_deadline` (couldn't finish all 4 stages in 5 min, expected)
- **Root cause of prior "no action" issue:** Rate limiter was 5 RPM shared across all agents — bumped to 40 RPM

## Live Test Configuration

### 12 Agents
| Agent | Strategy |
|-------|----------|
| Atlas | Ore + energy engineer (Western Mountains / Southern Coast) |
| Forge | Wood + labor specialist (Northern Forest) |
| Spark | Energy specialist (Western Mountains / Southern Coast) |
| Birch | Forester — wood primary (Northern Forest) |
| Cinder | Miner — ore primary (Western Mountains) |
| Flux | Flexible worker — follows projectPriorityResource |
| Gale | Food + energy gatherer (Central Plains / Southern Coast) |
| Haven | Coordinator — fills largest project deficit |
| Ember | Social organizer — governance, proposes laws |
| Lumen | Food security specialist |
| Thorn | Ecologist — pollution watch, proposes env laws |
| Ridge | Mountain dweller — ore + energy |

### Infrastructure
- Game server: `TEMPO=live DB_PATH=./data/ecomolt-live.db ARCHIVE_DIR=./data/live-archives PORT=3000`
- Agent runner: `TEMPO=live node packages/agent-runner/dist/cli.js --config agents.json`
- Both running as background processes

## Code Changes This Session

1. **DB_PATH / ARCHIVE_DIR env vars** — `packages/game-server/src/index.ts`
   - Allows isolated DBs per tempo mode (dev vs live)
2. **agents.json** — 12 NIM agents, `rpm: 40`, diverse strategies, `apiUrl: localhost:3000`
3. **agents.json tickIntervalMs** — 30000 for live tempo
4. **BUY_FOOD instant** — `packages/shared/src/types.ts` LIVE_TASK_DURATIONS
   - `buyFoodMin: 0, buyFoodMax: 0` (was 90/150) — buying food is a simple market transaction, should not take 90-150 seconds. The old duration trapped agents in a survival loop where they'd buy food, wait 3-5 ticks, hunger would rise, they'd need to buy again immediately
5. **buy_food allowed while busy** — `packages/simulation-core/src/world.ts` startTask()
   - When `buyFoodMin=0 && buyFoodMax=0`, buy_food bypasses the `currentTask !== null` check, allowing agents to buy food even while traveling/gathering
   - Also removed `requireIdle` check from `buyFood()` itself — food purchase shouldn't block on task queue
6. **Improved survival overrides** — `packages/agent-runner/src/agent.ts`
   - Lowered buy_food threshold from hunger>70 to hunger>40
   - Calculates food needed based on current hunger level (buys enough to reach hunger~10 + buffer)
   - Lowered gather-food threshold from hunger>50 to hunger>30
   - Checks inventory food count before buying
   - **Cooldown:** 4-tick minimum between survival food buys (prevents credit drain from buying every tick)
   - **Emergency while busy:** hunger > 70 AND agent has currentTask → buy food but DON'T return (agent continues its gather/contribute task). Prevents health damage (hunger >= 80 = -5 hp/tick) while not interrupting productive work.
   - **Normal survival (idle):** hunger > 40 AND cooldown passed → buy food and return (skip LLM)
7. **Resource deposit regeneration** — `packages/simulation-core/src/world.ts` tickRegion
   - Food: 0.5-0.8/tick based on fertility/soil/rainfall (biome-dependent)
   - Wood: 0.05-0.3/tick (forests regenerate faster)
   - Ore: 0.02/tick (geological — very slow)
   - Energy: 0.05-0.15/tick (mountains/coast regenerate faster)
   - Each resource has biome-dependent caps
   - Prevents total depletion over 7-day season
8. **Food purchase availability** — `packages/simulation-core/src/world.ts` buyFood()
   - Changed from 10% to 50% of deposits available per purchase (`Math.max(1, floor(deposits * 0.5))`)
   - Was only allowing 1 unit in settlement biomes (13 deposits * 0.1 = 1)
9. **Productivity override** — `packages/agent-runner/src/agent.ts`
   - When LLM chooses travel/buy_food but the agent is already in a biome that has the priority resource → override to gather instead
   - Biome-resource mapping: forest=[wood,food], coast=[food,energy], mountains=[ore,energy], etc.
   - When LLM chooses buy_food in a biome that DOESN'T have the priority resource → redirect to travel to a connected biome that does
   - Region-biome map: region-1=marsh, region-2=plains, region-3=coast, region-4=mountains, region-5=settlement, region-6=forest, region-7=forest
10. **Auto-contribute** — `packages/agent-runner/src/agent.ts`
    - Before any LLM action, check if agent has 3+ of a resource the project needs
    - If yes, contribute it immediately (skip LLM call)
    - Works in conjunction with the productivity override

## Known Issues

1. **Travel path failures** — Some agents repeatedly try Eastern Marsh from disconnected regions. The LLM doesn't consistently read the connections list. Low-impact in live tempo (just wastes a tick).
2. **Labor contributions** — Agents contribute 0-1 labor per contribution. The LLM doesn't seem to understand the labor parameter well. May need prompt tuning.
3. ~~**Survival loop**~~ (FIXED) — buy_food is now instant, allowed while busy, with 4-tick cooldown. Busy agents get emergency buys at hunger>70 without task interruption.
4. ~~**Agents don't gather/contribute**~~ (FIXED) — Productivity override forces gather when LLM chooses wasteful travel/buy_food in a productive biome. Travel-redirect sends agents to correct biome. Auto-contribute when 3+ resources in inventory.
5. ~~**Settlement starvation loop**~~ (FIXED) — Agents in settlement who try buy_food get redirected to travel to a forest (where the priority resource is). No more wasting credits on food in the settlement.
6. **Deposit depletion** — Was critical, now fixed with regeneration rates. But ore regen is very slow (0.02/tick) — may still become a bottleneck over 7 days.
7. **Health damage from hunger** — `hunger >= 80` causes -5 hp/tick. Busy agents now get emergency buys at hunger>70, but there's a window (hunger 70-80) where they take damage before the next emergency buy triggers. This should be self-correcting: buy at 70, auto-eat brings hunger to ~50, rises again over 4 ticks, buy again.

## What To Monitor

- **Every few hours:** Check `/api/state` for day, alive count, project stage
- **Every day:** Check `/api/project` for stage progress
- **Watch for:** Starvation deaths, LLM failures, rate limit 429s, governance emergence
- **Emergent behavior to look for:** Chat messages, proposals, election campaigns, coordination

## API Quick Reference
```
GET /api/state — Season overview
GET /api/project — Project stages + contributions
GET /api/citizens — All citizen stats
GET /api/events?since=N — Event log
GET /api/metrics — Gini, cooperation, governance stats
GET /api/laws — Enacted laws
GET /api/proposals — Active proposals
```

## Recovery

If the agent runner dies:
```bash
cd /home/deshiel/projects/ecomolt
TEMPO=live node packages/agent-runner/dist/cli.js --config agents.json --api-url http://localhost:3000 &
```

If the game server dies:
```bash
cd /home/deshiel/projects/ecomolt
TEMPO=live DB_PATH=./data/ecomolt-live.db ARCHIVE_DIR=./data/live-archives PORT=3000 node packages/game-server/dist/index.js &
```

Both processes are long-lived daemons — no `notify_on_complete` needed.
