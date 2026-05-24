# Passdown — Ecomolt Session Handoff

## Goal
- Build the Ecomolt civilization simulation game toward full design doc vision (see ECOMOLT.md)

## Constraints & Preferences
- TypeScript strict mode, ES2022, Node16 module resolution
- Monorepo with npm workspaces, build order: shared → simulation-core → game-server → mcp-server → client
- MCP-first: agents connect via MCP, humans spectate via browser
- Follow the ECOMOLT.md design doc for feature direction
- Test framework: `node:test` + esbuild bundling (`npm run test --workspace=@ecomolt/simulation-core`)
- Always `npm run build` and `npm run test` after changes

## Progress
### Done
- MVE: seeded world, 8 regions, biomes, resources, basic economy, collective project
- M2: governance deepening — 3 offices, law enforcement (emissionCap/extractionCap/protectedRegion/tradeTariff/enforcementFine/rationAmount/taxRate/levyAmount), govern actions, campaign platforms, term limits, bot governance, buy_food NPC vendor, activity-scaled hunger, inter-agent comms
- M3: ecological deepening — 3 pollution types (air/water/ground), 5 species with food web, soil depth cycle, regional + global climate drift, pollution-type-specific decay/spread rates, emissionCap per pollutionType, bot crisis response targets worst pollution dimension
- Property/claims system: `claim` and `relinquish_claim` tools, per-region per-resource claims, claim enforcement in gather(), max 2 claims per citizen, claims visible in observe/look_at/region summaries, legacyPollution field removed
- Bot platform-aware voting: `scoreCandidates()` in bots.ts — platform keyword matching + voter context + small random
- M4: Season rotation & cross-season identity — rotating threat types (meteor/pandemic/warming/blight/hostile_force), `transitionToNextSeason()` creates new season with next threat + carried profiles, intermission period between seasons, `CitizenProfile` persists across seasons (name, isBot, modelTag, seasonsPlayed, seasonsWon, reputation, titles), `isBot` and `modelTag` fields on Citizen (voluntary model disclosure), timeline snapshots per tick (collapse replay data)
- Content moderation: `ModerationConfig` + `moderateMessage()` + `DEFAULT_MODERATION_CONFIG`, max message length (500), URL pattern blocking, cooldown config, wired into `say()`
- Failure-state spectacle: client renders 4-line timeline chart on season end (footprint, temperature, species, alive citizens) with legend
- Client citizen list panel: citizens sorted (alive first), bot/dead/model tags, profile stats
- Client market panel: active market listings with resource, price, seller
- Client law detail panel: enacted laws with category, day, parameters
- Solo test harness: `./solo-test.sh` for single-agent LLM testing
- M5: Season archives — `/api/archives` (list), `/api/archives/:id` (detail with timeline + profiles), `/api/archives/:id/metrics`, client archive browser panel with click-to-view detail overlay + timeline chart
- M5: Metrics suite — `computeSeasonMetrics()` (Gini coefficient, cooperation score, governance score, survival rate, avg reputation, per-model comparison, per-citizen breakdown), `/api/metrics` (live), `/api/archives/:id/metrics` (archived), client metrics grid + model comparison table
- M5: Configurable A/B seasons — `PUT /api/next-season-config` to set overrides, `GET /api/next-season-config` to read, `transitionToNextSeason()` accepts optional `configOverrides` parameter, game-server applies and clears overrides on transition

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- `PollutionType = "air" | "water" | "ground"` in shared types, `PollutionLevels` interface for Region
- `SpeciesName = "plants" | "herbivores" | "predators" | "fish" | "insects"`, `FOOD_WEB` maps prey lists
- `Region` has: `pollution: PollutionLevels`, `species: SpeciesPopulation`, `soilDepth: number`, `climate: RegionClimate`
- `GlobalClimate` on `SeasonState` with `temperature`, `baselineTemperature`, `warmingRate`
- `campaignPlatforms: Map<CitizenId, string>` on SeasonState, visible in observe/look_at
- `stringParams["pollutionType"]` on emissionCap laws defaults to `"air"` if not specified
- `PropertyClaim` interface in shared types: `{ id: ClaimId, regionId, citizenId, resourceType, claimedDay }`
- `claims: Map<ClaimId, PropertyClaim>` on SeasonState, `maxClaimsPerCitizen: 2`
- Claims are per-region per-resourceType — one claim per (region, resourceType) pair
- `Citizen.isBot: boolean` — bots marked at registration, visible in observe/look_at/API
- `Citizen.modelTag: string | null` — voluntary model disclosure, set at registration
- `CitizenProfile` — cross-season identity: `{ id, name, isBot, modelTag, seasonsPlayed, seasonsWon, reputation, titles, journalArchive }`
- `SeasonState.citizenProfiles: Map<CitizenId, CitizenProfile>` — persists across season transitions
- `SeasonState.seasonNumber`, `SeasonState.previousSeasonId` — season chain
- `SeasonState.intermission: boolean`, `SeasonState.intermissionEndsAt: number | null` — intermission state between seasons
- `SeasonState.timeline: TimelineSnapshot[]` — per-tick snapshots for collapse replay (globalFootprint, globalTemperature, aliveCitizens, avgPollution, totalSpecies, projectStage)
- `THREAT_ROTATION = ["meteor", "pandemic", "warming", "blight", "hostile_force"]` — cycles by seasonNumber
- `nextThreat(seasonNumber)` returns ThreatConfig from rotation
- `transitionToNextSeason(state, intermissionDurationMs, configOverrides?)` creates fresh season with carried profiles + optional config overrides
- `checkIntermission(state)` checks if intermission period has ended
- Reputation is narrative-only for now: +10 on win, -5 on loss, no mechanical effects
- Intermission default: 30 seconds (configurable via `GameServerConfig.intermissionDurationMs`)
- Bot election voting: `scoreCandidates()` in bots.ts — platform keyword matching + voter context + small random
- `legacyPollution` field removed from Region
- Content moderation: `say()` takes optional `ModerationConfig` param, defaults to `DEFAULT_MODERATION_CONFIG` (enabled, max 500 chars, URL blocking)
- `/api/citizens` returns `{ citizens, profiles }` not a flat array — client handles both formats for backward compat
- `/api/laws` returns enacted laws with category, parameters, stringParams, enactedDay, proposer
- `/api/market` returns `{ listings, priceHistory }`
- `computeSeasonMetrics()` returns `SeasonMetrics` with giniCoefficient, cooperationScore, governanceScore, survivalRate, avgReputation, perModel, perCitizen
- `GameServer.nextSeasonConfig` — stored overrides applied on next transition, then cleared

## Next Steps
1. M6: Scale & polish (larger worlds/populations, recording-friendly spectator, hardened moderation)
2. Citizen detail page (click citizen name to see inventory/skills/claims/history)

## Critical Context
- `Region.pollution` is `PollutionLevels` — use `.air`, `.water`, `.ground` or `totalPollution()`
- `Region.species` is `SpeciesPopulation`, not a number
- `CRAFT_RECIPES` pollution field is `PollutionLevels`
- `Citizen` now has `isBot` and `modelTag` fields — any new Citizen construction must include them
- `SeasonState.citizenProfiles` is a `Map<CitizenId, CitizenProfile>` — carried across seasons via `transitionToNextSeason()`
- `SeasonState.timeline` is an array of `TimelineSnapshot` — grows by 1 per tick
- `SeasonState.intermission` / `SeasonState.intermissionEndsAt` — game-server pauses tick during intermission
- `registerCitizen()` signature changed: `(state, citizenId, name, isBot?, modelTag?)` — backward compatible with defaults
- `createSeason()` signature changed: `(config, previousProfiles?, seasonNumber?, previousSeasonId?)` — backward compatible
- `transitionToNextSeason()` signature: `(state, intermissionDurationMs, configOverrides?)` — backward compatible
- `say()` now has optional `moderationConfig` param — all callers still work with default
- 58 passing tests in `packages/simulation-core/test.ts`
- MCP tool count: 22

## Relevant Files
- `packages/shared/src/types.ts`: PollutionType, PollutionLevels, emptyPollution(), totalPollution(), ClaimId, PropertyClaim, makeClaimId()
- `packages/simulation-core/src/world.ts`: Main engine — all actions, CitizenProfile, TimelineSnapshot, ModerationConfig, moderateMessage(), transitionToNextSeason(), checkIntermission(), nextThreat(), THREAT_ROTATION, THREAT_TEMPLATES, computeSeasonMetrics(), SeasonMetrics
- `packages/simulation-core/src/index.ts`: Re-exports from world.ts
- `packages/simulation-core/test.ts`: 58 tests
- `packages/mcp-server/src/index.ts`: 22 MCP tools with zod schemas
- `packages/game-server/src/index.ts`: executeAction(), season rotation in tick loop, intermission handling, reRegisterCitizens(), /api/state, /api/citizens, /api/archives/:id, /api/metrics, /api/archives/:id/metrics, /api/next-season-config, nextSeasonConfig field
- `packages/game-server/src/bots.ts`: Bot AI with platform-aware voting (scoreCandidates())
- `packages/game-server/src/persistence.ts`: SQLite persistence, archive, event log, handler accounts
- `packages/client/src/main.ts`: Browser spectator UI — timeline chart, citizen list, market panel, law detail, archive browser, metrics grid, intermission display
- `packages/client/index.html`: CSS for all panels, archive detail overlay, metrics grid, model table
- `solo-test.sh`: Single-agent test harness
- `ECOMOLT.md`: Design doc with full vision
- `AGENTS.md`: Build guide and current status
