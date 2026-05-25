import type {
  CitizenId, RegionId, ProposalId, LawId, SeasonId, ClaimId,
  ResourceType, SkillType, BiomeType, ThreatType,
  Inventory, SkillLevels, PollutionType, PollutionLevels, PropertyClaim,
  CitizenTask, TaskActionType, TempoConfig, TaskDurationSeconds,
} from "@ecomolt/shared";
import {
  makeCitizenId, makeRegionId, makeProposalId, makeLawId, makeSeasonId, makeClaimId,
  emptyInventory, addToInventory, removeFromInventory, inventoryHas,
  emptyPollution, totalPollution,
  RESOURCE_TYPES, SKILL_TYPES, POLLUTION_TYPES,
  INSTANT_ACTIONS, DEV_TEMPO, LIVE_TASK_DURATIONS, DEV_TASK_DURATIONS,
  tempoFromEnv, secondsToTicks, randomTicks, ticksToSeconds,
} from "@ecomolt/shared";

export { makeCitizenId, makeRegionId, makeProposalId, makeLawId, makeSeasonId, makeClaimId };
export type { CitizenId, RegionId, ProposalId, LawId, SeasonId, ClaimId, PropertyClaim, CitizenTask, TaskActionType, TempoConfig, TaskDurationSeconds };

export type SpeciesName = "plants" | "herbivores" | "predators" | "fish" | "insects";

export const SPECIES_NAMES: SpeciesName[] = ["plants", "herbivores", "predators", "fish", "insects"];

export const FOOD_WEB: Record<SpeciesName, SpeciesName[]> = {
  plants: [],
  herbivores: ["plants"],
  predators: ["herbivores", "fish"],
  fish: ["plants", "insects"],
  insects: ["plants"],
};

export interface SpeciesPopulation {
  plants: number;
  herbivores: number;
  predators: number;
  fish: number;
  insects: number;
}

export interface RegionClimate {
  temperature: number;
  rainfall: number;
  sunlight: number;
}

export interface Region {
  id: RegionId;
  name: string;
  biome: BiomeType;
  connections: RegionId[];
  fertility: number;
  soilDepth: number;
  pollution: PollutionLevels;
  deposits: Record<ResourceType, number>;
  species: SpeciesPopulation;
  climate: RegionClimate;
}

export interface Citizen {
  id: CitizenId;
  name: string;
  regionId: RegionId;
  health: number;
  hunger: number;
  inventory: Inventory;
  credits: number;
  skills: SkillLevels;
  office: OfficeType | null;
  alive: boolean;
  isBot: boolean;
  modelTag: string | null;
  currentTask: CitizenTask | null;
}

export type OfficeType = "coordinator" | "ecology_steward" | "project_director";

export type LawCategory = "environmental" | "economic" | "resource" | "project";

export interface Law {
  id: LawId;
  title: string;
  description: string;
  category: LawCategory;
  proposer: CitizenId;
  enactedDay: number;
  parameters: Record<string, number>;
  stringParams: Record<string, string>;
  violations: Record<CitizenId, number>;
}

export interface Proposal {
  id: ProposalId;
  title: string;
  description: string;
  category: LawCategory;
  proposer: CitizenId;
  proposedDay: number;
  votesFor: Set<CitizenId>;
  votesAgainst: Set<CitizenId>;
  status: "active" | "enacted" | "rejected";
  parameters: Record<string, number>;
  stringParams: Record<string, string>;
}

export interface ProjectStage {
  id: string;
  name: string;
  requiredResources: Partial<Inventory>;
  requiredLabor: number;
  contributedResources: Partial<Inventory>;
  contributedLabor: number;
  completed: boolean;
}

export interface CollectiveProject {
  stages: ProjectStage[];
  currentStageIndex: number;
  completed: boolean;
}

export interface ThreatConfig {
  type: ThreatType;
  impactDay: number;
  description: string;
}

export interface MarketListing {
  id: string;
  seller: CitizenId;
  resourceType: ResourceType;
  quantity: number;
  pricePerUnit: number;
  listedDay: number;
}

export interface Market {
  listings: MarketListing[];
  priceHistory: Record<ResourceType, { day: number; avgPrice: number }[]>;
}

export type EventLogEntry = {
  day: number;
  timestamp: number;
  type: string;
  data: Record<string, unknown>;
};

export interface SeasonConfig {
  seed: number;
  threat: ThreatConfig;
  regionCount: number;
  totalDays: number;
  collapseThreshold: number;
  tickIntervalMs: number;
  tempo: TempoConfig;
  taskDurations: TaskDurationSeconds;
  hungerPerTick: number;
}

export function computeHungerPerTick(tempo: TempoConfig): number {
  const targetHungerPerDay = 15; // ~6.7 in-game days to reach 100 hunger (gives agents time)
  const ticksPerDay = (86400 / tempo.tickIntervalMs);
  return ticksPerDay > 0 ? targetHungerPerDay / ticksPerDay : 1;
}

export function getTaskDurations(tempo: TempoConfig): TaskDurationSeconds {
  return tempo.mode === "dev" || tempo.mode === "ci" ? DEV_TASK_DURATIONS : LIVE_TASK_DURATIONS;
}

export const DEFAULT_SEASON_CONFIG: SeasonConfig = {
  seed: 42,
  threat: {
    type: "meteor",
    impactDay: 30,
    description: "A massive meteor is on collision course. Build a planetary defense array before impact.",
  },
  regionCount: 8,
  totalDays: 30,
  collapseThreshold: 200,
  tickIntervalMs: 1000,
  tempo: DEV_TEMPO,
  taskDurations: DEV_TASK_DURATIONS,
  hungerPerTick: 1,
};

export function createSeasonConfig(tempo?: TempoConfig): SeasonConfig {
  const t = tempo ?? tempoFromEnv();
  const durations = getTaskDurations(t);
  const hungerPerTick = computeHungerPerTick(t);
  // Derive game-days from real-time season duration
  // At dev tempo: 5s/tick, 1 real-day = 1 game-year = 30 game-days
  // So seasonDurationDays * 30 = total game-days
  const totalDays = Math.max(30, t.seasonDurationDays * 30);
  return {
    seed: 42,
    threat: { type: "meteor", impactDay: totalDays, description: "A massive meteor is on collision course. Build a planetary defense array before impact." },
    regionCount: 8,
    totalDays,
    collapseThreshold: 200,
    tickIntervalMs: t.tickIntervalMs,
    tempo: t,
    taskDurations: durations,
    hungerPerTick,
  };
}

export const THREAT_TEMPLATES: Record<ThreatType, { description: string; projectTheme: string }> = {
  meteor: {
    description: "A massive meteor is on collision course. Build a planetary defense array before impact.",
    projectTheme: "Planetary Defense Array",
  },
  pandemic: {
    description: "A virulent plague is spreading. Develop and deploy a vaccine program before it overwhelms the colony.",
    projectTheme: "Vaccine Program",
  },
  warming: {
    description: "Runaway global warming is accelerating. Build a carbon-capture grid before the biosphere collapses.",
    projectTheme: "Carbon-Capture Grid",
  },
  blight: {
    description: "An aggressive blight is destroying crops. Engineer a blight-resistant food system before famine hits.",
    projectTheme: "Blight-Resistant Agriculture",
  },
  hostile_force: {
    description: "A hostile force is approaching. Construct a colony shield before they arrive.",
    projectTheme: "Colony Shield",
  },
};

export const THREAT_ROTATION: ThreatType[] = ["meteor", "pandemic", "warming", "blight", "hostile_force"];

export function nextThreat(seasonNumber: number): ThreatConfig {
  const type = THREAT_ROTATION[(seasonNumber - 1) % THREAT_ROTATION.length]!;
  const template = THREAT_TEMPLATES[type]!;
  return {
    type,
    impactDay: 30,
    description: template.description,
  };
}

export type SeasonResult = "win" | "lose_deadline" | "lose_collapse" | "ongoing";

export interface ChannelMessage {
  day: number;
  citizenId: CitizenId;
  citizenName: string;
  channel: string;
  message: string;
  timestamp: number;
}

export interface GlobalClimate {
  temperature: number;
  baselineTemperature: number;
  warmingRate: number;
}

export interface CitizenProfile {
  id: CitizenId;
  name: string;
  isBot: boolean;
  modelTag: string | null;
  seasonsPlayed: number;
  seasonsWon: number;
  reputation: number;
  titles: string[];
  journalArchive: string[];
}

export interface TimelineSnapshot {
  day: number;
  globalFootprint: number;
  globalTemperature: number;
  aliveCitizens: number;
  avgPollution: { air: number; water: number; ground: number };
  totalSpecies: number;
  projectStageIndex: number;
  projectCompleted: boolean;
}

export interface SeasonState {
  id: SeasonId;
  config: SeasonConfig;
  day: number;
  regions: Map<RegionId, Region>;
  citizens: Map<CitizenId, Citizen>;
  laws: Law[];
  proposals: Map<ProposalId, Proposal>;
  project: CollectiveProject;
  market: Market;
  eventLog: EventLogEntry[];
  result: SeasonResult;
  globalFootprint: number;
  treasury: number;
  coordinatorId: CitizenId | null;
  ecologyStewardId: CitizenId | null;
  projectDirectorId: CitizenId | null;
  electionActive: boolean;
  electionCandidates: CitizenId[];
  electionVotes: Map<CitizenId, CitizenId>;
  electionOffice: OfficeType;
  lastElectionDay: number;
  termLengthDays: number;
  channels: Record<string, ChannelMessage[]>;
  projectPriorityResource: ResourceType | null;
  climate: GlobalClimate;
  campaignPlatforms: Map<CitizenId, string>;
  claims: Map<ClaimId, PropertyClaim>;
  maxClaimsPerCitizen: number;
  intermission: boolean;
  intermissionEndsAt: number | null;
  citizenProfiles: Map<CitizenId, CitizenProfile>;
  seasonNumber: number;
  timeline: TimelineSnapshot[];
  previousSeasonId: SeasonId | null;
}

export interface ActionResult {
  success: boolean;
  message: string;
  events?: EventLogEntry[];
  task?: CitizenTask | null;
}

export function createSeason(config: SeasonConfig, previousProfiles?: Map<CitizenId, CitizenProfile>, seasonNumber = 1, previousSeasonId?: SeasonId): SeasonState {
  const id = makeSeasonId(`season-${Date.now()}`);
  const regions = generateWorld(config);
  const project = generateProject(config);
  return {
    id,
    config,
    day: 0,
    regions,
    citizens: new Map(),
    laws: [],
    proposals: new Map(),
    project,
    market: { listings: [], priceHistory: { food: [], wood: [], ore: [], energy: [] } },
    eventLog: [],
    result: "ongoing",
    globalFootprint: 0,
    treasury: 0,
    coordinatorId: null,
    ecologyStewardId: null,
    projectDirectorId: null,
    electionActive: false,
    electionCandidates: [],
    electionVotes: new Map(),
    electionOffice: "coordinator",
    lastElectionDay: 0,
    termLengthDays: 10,
    channels: {},
    projectPriorityResource: null,
    climate: { temperature: 15, baselineTemperature: 15, warmingRate: 0.02 },
    campaignPlatforms: new Map(),
    claims: new Map(),
    maxClaimsPerCitizen: 2,
    intermission: false,
    intermissionEndsAt: null,
    citizenProfiles: previousProfiles ?? new Map(),
    seasonNumber,
    timeline: [],
    previousSeasonId: previousSeasonId ?? null,
  };
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateWorld(config: SeasonConfig): Map<RegionId, Region> {
  const rand = seededRandom(config.seed);
  const regions = new Map<RegionId, Region>();
  const biomeCycle: BiomeType[] = ["forest", "marsh", "plains", "coast", "mountains", "settlement"];
  const names = ["Northern Forest", "Eastern Marsh", "Central Plains", "Southern Coast", "Western Mountains", "Hillside Settlement", "River Delta", "Highland Ridge"];

  const biomeClimate: Record<BiomeType, { temp: number; rain: number; sun: number }> = {
    forest: { temp: 18, rain: 70, sun: 50 },
    marsh: { temp: 20, rain: 85, sun: 40 },
    plains: { temp: 22, rain: 50, sun: 75 },
    coast: { temp: 20, rain: 60, sun: 70 },
    mountains: { temp: 8, rain: 40, sun: 80 },
    settlement: { temp: 18, rain: 55, sun: 60 },
  };

  const biomeSpecies: Record<BiomeType, Partial<SpeciesPopulation>> = {
    forest: { plants: 80, herbivores: 40, predators: 15, fish: 10, insects: 50 },
    marsh: { plants: 60, herbivores: 20, predators: 5, fish: 30, insects: 40 },
    plains: { plants: 70, herbivores: 50, predators: 10, fish: 5, insects: 45 },
    coast: { plants: 30, herbivores: 10, predators: 5, fish: 60, insects: 20 },
    mountains: { plants: 30, herbivores: 20, predators: 10, fish: 5, insects: 15 },
    settlement: { plants: 20, herbivores: 5, predators: 2, fish: 2, insects: 10 },
  };

  for (let i = 0; i < config.regionCount; i++) {
    const id = makeRegionId(`region-${i}`);
    const biome = biomeCycle[i % biomeCycle.length]!;
    const name = names[i] ?? `Region ${i}`;
    const bc = biomeClimate[biome];
    const bs = biomeSpecies[biome];
    regions.set(id, {
      id,
      name,
      biome,
      connections: [],
      fertility: 50 + Math.floor(rand() * 40),
      soilDepth: 80 + Math.floor(rand() * 20),
      pollution: emptyPollution(),
      deposits: {
        food: biome === "plains" || biome === "forest" ? 200 + Math.floor(rand() * 100) : 50 + Math.floor(rand() * 50),
        wood: biome === "forest" ? 300 + Math.floor(rand() * 100) : 30 + Math.floor(rand() * 30),
        ore: biome === "mountains" ? 250 + Math.floor(rand() * 100) : 20 + Math.floor(rand() * 20),
        energy: 50 + Math.floor(rand() * 50),
      },
      species: {
        plants: bs.plants ?? 30,
        herbivores: bs.herbivores ?? 15,
        predators: bs.predators ?? 5,
        fish: bs.fish ?? 5,
        insects: bs.insects ?? 15,
      },
      climate: {
        temperature: (bc?.temp ?? 18) + Math.floor(rand() * 4) - 2,
        rainfall: (bc?.rain ?? 50) + Math.floor(rand() * 10) - 5,
        sunlight: (bc?.sun ?? 60) + Math.floor(rand() * 10) - 5,
      },
    });
  }

  const regionIds = [...regions.keys()];
  for (let i = 0; i < regionIds.length; i++) {
  const next = regionIds[(i + 1) % regionIds.length]!;
  const r = regions.get(regionIds[i]!)!;
  if (!r.connections.includes(next)) {
    r.connections.push(next);
    regions.get(next)!.connections.push(regionIds[i]!);
    }
    if (rand() > 0.6 && regionIds.length > 3) {
      const jump = regionIds[(i + 2) % regionIds.length]!;
      if (!r.connections.includes(jump)) {
        r.connections.push(jump);
        regions.get(jump)!.connections.push(regionIds[i]!);
      }
    }
  }

  return regions;
}

function generateProject(config: SeasonConfig): CollectiveProject {
 // Scale project requirements by tempo — dev tempo has shorter seasons and fewer agents
 const scale = config.tempo.mode === "dev" || config.tempo.mode === "ci" ? 0.4 : 1.0;
 const stages: ProjectStage[] = [
 {
 id: "stage-survey",
 name: "Site Survey & Foundation",
 requiredResources: { wood: Math.ceil(50 * scale), ore: Math.ceil(30 * scale) },
 requiredLabor: Math.ceil(20 * scale),
 contributedResources: { wood: 0, ore: 0 },
 contributedLabor: 0,
 completed: false,
 },
 {
 id: "stage-structure",
 name: "Core Structure",
 requiredResources: { ore: Math.ceil(80 * scale), energy: Math.ceil(40 * scale), wood: Math.ceil(30 * scale) },
 requiredLabor: Math.ceil(40 * scale),
 contributedResources: { ore: 0, energy: 0, wood: 0 },
 contributedLabor: 0,
 completed: false,
 },
 {
 id: "stage-systems",
 name: "Defense Systems",
 requiredResources: { ore: Math.ceil(60 * scale), energy: Math.ceil(80 * scale) },
 requiredLabor: Math.ceil(50 * scale),
 contributedResources: { ore: 0, energy: 0 },
 contributedLabor: 0,
 completed: false,
 },
 {
 id: "stage-activate",
 name: "Activation & Calibration",
 requiredResources: { energy: Math.ceil(100 * scale), food: Math.ceil(40 * scale) },
 requiredLabor: Math.ceil(30 * scale),
 contributedResources: { energy: 0, food: 0 },
 contributedLabor: 0,
 completed: false,
 },
 ];
  return { stages, currentStageIndex: 0, completed: false };
}

export function registerCitizen(state: SeasonState, citizenId: CitizenId, name: string, isBot = false, modelTag: string | null = null): ActionResult {
  if (state.citizens.has(citizenId)) {
    return { success: false, message: "Citizen already registered." };
  }
  const regionIds = [...state.regions.keys()];
  const startRegion = regionIds.find(r => state.regions.get(r)?.biome === "settlement") ?? regionIds[0]!;
  const citizen: Citizen = {
    id: citizenId,
    name,
    regionId: startRegion,
    health: 100,
    hunger: 0,
    inventory: emptyInventory(),
    credits: 100,
    skills: { farming: 1, forestry: 1, mining: 1, crafting: 1, engineering: 1, science: 1, governance: 1 },
    office: null,
    alive: true,
    isBot,
    modelTag,
    currentTask: null,
  };
  state.citizens.set(citizenId, citizen);

  if (!state.citizenProfiles.has(citizenId)) {
    state.citizenProfiles.set(citizenId, {
      id: citizenId,
      name,
      isBot,
      modelTag,
      seasonsPlayed: 0,
      seasonsWon: 0,
      reputation: 0,
      titles: [],
      journalArchive: [],
    });
  }
  const profile = state.citizenProfiles.get(citizenId)!;
  profile.seasonsPlayed++;

  const event = logEvent(state, "citizen_registered", { citizenId, name, regionId: startRegion });
  return { success: true, message: `${name} registered in ${state.regions.get(startRegion)?.name}`, events: [event] };
}

export function citizenCanStartTask(citizen: Citizen, action: string): boolean {
  if (!citizen.alive) return false;
  if (citizen.currentTask !== null) return false;
  if (INSTANT_ACTIONS.has(action)) return true;
  return true;
}

export function startTask(state: SeasonState, citizenId: CitizenId, action: TaskActionType, target: string, params: Record<string, unknown>): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
 if (citizen.currentTask !== null) {
  // Allow instant survival actions (buy_food) to execute alongside current task
  const taskDur = state.config.taskDurations;
  const isInstantSurvival = action === "buy_food" && taskDur.buyFoodMin === 0 && taskDur.buyFoodMax === 0;
  if (!isInstantSurvival) {
   return { success: false, message: `Already working on: ${citizen.currentTask.action} (${citizen.currentTask.ticksRemaining} ticks remaining). Cancel current task first.` };
  }
  // For instant actions like buy_food, fall through — executeTaskEffect runs without setting currentTask
 }

  const dur = state.config.taskDurations;
  const tickMs = state.config.tempo.tickIntervalMs;
  let ticksTotal = 0;

  switch (action) {
    case "travel": ticksTotal = randomTicks(dur.travelMin, dur.travelMax, tickMs); break;
    case "gather": ticksTotal = randomTicks(dur.gatherMin, dur.gatherMax, tickMs); break;
    case "craft": ticksTotal = randomTicks(dur.craftMin, dur.craftMax, tickMs); break;
    case "contribute": ticksTotal = randomTicks(dur.contributeMin, dur.contributeMax, tickMs); break;
    case "propose": ticksTotal = randomTicks(dur.proposeMin, dur.proposeMax, tickMs); break;
    case "campaign": ticksTotal = randomTicks(dur.campaignMin, dur.campaignMax, tickMs); break;
    case "govern": ticksTotal = randomTicks(dur.governMin, dur.governMax, tickMs); break;
    case "buy_food": ticksTotal = randomTicks(dur.buyFoodMin, dur.buyFoodMax, tickMs); break;
    case "claim": ticksTotal = randomTicks(dur.claimMin, dur.claimMax, tickMs); break;
    case "relinquish_claim": ticksTotal = randomTicks(dur.claimMin, dur.claimMax, tickMs); break;
    case "vote": ticksTotal = randomTicks(dur.voteMin, dur.voteMax, tickMs); break;
    case "trade": ticksTotal = randomTicks(dur.tradeMin, dur.tradeMax, tickMs); break;
    case "give": ticksTotal = randomTicks(dur.tradeMin, dur.tradeMax, tickMs); break;
    case "list_on_market": ticksTotal = randomTicks(dur.tradeMin, dur.tradeMax, tickMs); break;
    default: ticksTotal = 0;
  }

  const task: CitizenTask = {
    action,
    target,
    params,
    ticksTotal,
    ticksRemaining: ticksTotal,
    startedDay: state.day,
  };

  if (ticksTotal <= 0) {
    return executeTaskEffect(state, citizenId, task);
  }

  citizen.currentTask = task;
  const eta = ticksTotal * (tickMs / 1000);
  const etaStr = eta >= 60 ? `${Math.floor(eta / 60)}m ${Math.round(eta % 60)}s` : `${Math.round(eta)}s`;
  return { success: true, message: `Started ${action}${target ? ` (${target})` : ""}. Completes in ${ticksTotal} ticks (~${etaStr}).`, events: [] };
}

export function cancelTask(state: SeasonState, citizenId: CitizenId): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  if (!citizen.currentTask) return { success: false, message: "No active task to cancel." };
  const task = citizen.currentTask;
  citizen.currentTask = null;
  const event = logEvent(state, "task_cancelled", { citizenId, action: task.action, target: task.target, ticksRemaining: task.ticksRemaining });
  return { success: true, message: `Cancelled ${task.action}. Progress lost.`, events: [event] };
}

export function processTasks(state: SeasonState): EventLogEntry[] {
  const events: EventLogEntry[] = [];
  for (const citizen of state.citizens.values()) {
    if (!citizen.alive || !citizen.currentTask) continue;
    citizen.currentTask.ticksRemaining--;
    if (citizen.currentTask.ticksRemaining <= 0) {
      const task = citizen.currentTask;
      citizen.currentTask = null;
      const result = executeTaskEffect(state, citizen.id, task);
      if (result.events) events.push(...result.events);
    }
  }
  return events;
}

function executeTaskEffect(state: SeasonState, citizenId: CitizenId, task: CitizenTask): ActionResult {
  switch (task.action) {
    case "travel": return travel(state, citizenId, makeRegionId(task.target));
    case "gather": return gather(state, citizenId, task.target as ResourceType);
    case "craft": return craft(state, citizenId, task.target);
    case "contribute": return contribute(state, citizenId, task.params.resourceType as ResourceType, Number(task.params.amount ?? 0), Number(task.params.labor ?? 0));
    case "propose": return propose(state, citizenId, task.params.title as string, task.params.description as string, task.params.category as LawCategory, (task.params.parameters ?? {}) as Record<string, number>, (task.params.stringParams ?? {}) as Record<string, string>);
    case "campaign": return campaign(state, citizenId, task.params.platform as string | undefined);
    case "govern": return govern(state, citizenId, task.target as GovernAction, (task.params.governParams ?? {}) as Record<string, number>, (task.params.governStringParams ?? {}) as Record<string, string>);
    case "buy_food": return buyFood(state, citizenId, Number(task.params.amount ?? 0));
    case "claim": return claim(state, citizenId, makeRegionId(task.params.regionId as string), task.target as ResourceType);
    case "relinquish_claim": return relinquishClaim(state, citizenId, makeClaimId(task.target));
    case "vote": return vote(state, citizenId, makeProposalId(task.target), Boolean(task.params.support));
    case "trade": return trade(state, citizenId, task.target);
    case "list_on_market": return listOnMarket(state, citizenId, task.params.resourceType as ResourceType, Number(task.params.quantity ?? 0), Number(task.params.pricePerUnit ?? 1));
    case "give": return give(state, citizenId, makeCitizenId(task.target), task.params.resourceType as ResourceType, Number(task.params.amount ?? 0));
    default: return { success: false, message: `Unknown task action: ${task.action}` };
  }
}

export function observe(state: SeasonState, citizenId: CitizenId): ActionResult & { data: Record<string, unknown> } {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) {
    return { success: false, message: "Citizen not found or dead.", data: {} };
  }
  const region = state.regions.get(citizen.regionId)!;
  const nearbyCitizens = [...state.citizens.values()]
    .filter(c => c.id !== citizenId && c.regionId === citizen.regionId && c.alive)
    .map(c => ({ id: c.id, name: c.name, health: c.health }));
  const activeProposalSummaries = [...state.proposals.values()]
    .filter(p => p.status === "active")
    .map(p => ({ id: p.id, title: p.title, votesFor: p.votesFor.size, votesAgainst: p.votesAgainst.size }));
  return {
    success: true,
    message: "Observation complete.",
    data: {
      citizen: {
        id: citizen.id,
        name: citizen.name,
        health: citizen.health,
        hunger: citizen.hunger,
        inventory: { ...citizen.inventory },
        credits: citizen.credits,
        skills: { ...citizen.skills },
        office: citizen.office,
        regionId: citizen.regionId,
      isBot: citizen.isBot,
      modelTag: citizen.modelTag,
      currentTask: citizen.currentTask ? {
        action: citizen.currentTask.action,
        target: citizen.currentTask.target,
        ticksRemaining: citizen.currentTask.ticksRemaining,
        ticksTotal: citizen.currentTask.ticksTotal,
        progress: citizen.currentTask.ticksTotal > 0 ? +(1 - citizen.currentTask.ticksRemaining / citizen.currentTask.ticksTotal).toFixed(2) : 1,
        etaSeconds: ticksToSeconds(citizen.currentTask.ticksRemaining, state.config.tempo.tickIntervalMs),
      } : null,
    },
      region: {
        id: region.id,
        name: region.name,
        biome: region.biome,
        fertility: region.fertility,
        soilDepth: region.soilDepth,
        pollution: { ...region.pollution },
        connections: region.connections.map(cid => ({ id: cid, name: state.regions.get(cid)?.name ?? cid })),
        availableResources: Object.fromEntries(RESOURCE_TYPES.map(r => [r, region.deposits[r]])),
        species: { ...region.species },
        climate: { ...region.climate },
      },
      nearbyCitizens,
      day: state.day,
      daysRemaining: state.config.threat.impactDay - state.day,
      globalFootprint: state.globalFootprint,
      globalTemperature: state.climate.temperature,
      temperatureAnomaly: +(state.climate.temperature - state.climate.baselineTemperature).toFixed(2),
      threat: state.config.threat,
      projectProgress: getProjectProgress(state),
      activeLaws: state.laws.map(l => ({ id: l.id, title: l.title, category: l.category, parameters: l.parameters, stringParams: l.stringParams })),
      activeProposals: activeProposalSummaries,
      coordinatorId: state.coordinatorId,
      ecologyStewardId: state.ecologyStewardId,
      projectDirectorId: state.projectDirectorId,
      treasury: state.treasury,
    projectPriorityResource: state.projectPriorityResource,
    seasonNumber: state.seasonNumber,
    intermission: state.intermission,
    previousSeasonId: state.previousSeasonId,
    citizenProfiles: [...state.citizenProfiles.values()].map(p => ({
      id: p.id, name: p.name, isBot: p.isBot, modelTag: p.modelTag,
      seasonsPlayed: p.seasonsPlayed, seasonsWon: p.seasonsWon,
      reputation: p.reputation, titles: p.titles,
    })),
    timeline: state.timeline,
      electionCandidates: state.electionActive ? state.electionCandidates.map(cid => {
        const c = state.citizens.get(cid);
        return { id: cid, name: c?.name ?? cid, platform: state.campaignPlatforms.get(cid) ?? null };
      }) : [],
      claims: [...state.claims.values()].filter(c => c.regionId === citizen.regionId).map(c => ({
        id: c.id, citizenId: c.citizenId, citizenName: state.citizens.get(c.citizenId)?.name ?? c.citizenId,
        resourceType: c.resourceType, regionId: c.regionId, claimedDay: c.claimedDay,
      })),
      myClaims: [...state.claims.values()].filter(c => c.citizenId === citizenId).map(c => ({
        id: c.id, resourceType: c.resourceType, regionId: c.regionId, regionName: state.regions.get(c.regionId)?.name ?? c.regionId, claimedDay: c.claimedDay,
      })),
    },
    events: [],
  };
}

export function lookAt(state: SeasonState, _citizenId: CitizenId, target: string): ActionResult & { data: Record<string, unknown> } {
  const region = state.regions.get(makeRegionId(target));
  if (region) {
    return {
      success: true,
      message: `Details for ${region.name}.`,
      data: {
        type: "region",
        id: region.id,
        name: region.name,
        biome: region.biome,
        fertility: region.fertility,
        soilDepth: region.soilDepth,
        pollution: { ...region.pollution },
        connections: region.connections,
        deposits: { ...region.deposits },
        species: { ...region.species },
        climate: { ...region.climate },
        claims: [...state.claims.values()].filter(c => c.regionId === region.id).map(c => ({
          id: c.id, citizenId: c.citizenId, citizenName: state.citizens.get(c.citizenId)?.name ?? c.citizenId,
          resourceType: c.resourceType, claimedDay: c.claimedDay,
        })),
      },
      events: [],
    };
  }

  const citizen = state.citizens.get(makeCitizenId(target));
  if (citizen) {
    return {
      success: true,
      message: `Details for ${citizen.name}.`,
      data: {
        type: "citizen",
        id: citizen.id,
        name: citizen.name,
        health: citizen.health,
        hunger: citizen.hunger,
        regionId: citizen.regionId,
        credits: citizen.credits,
        skills: { ...citizen.skills },
        office: citizen.office,
        alive: citizen.alive,
        isBot: citizen.isBot,
        modelTag: citizen.modelTag,
        currentTask: citizen.currentTask ? {
          action: citizen.currentTask.action,
          target: citizen.currentTask.target,
          ticksRemaining: citizen.currentTask.ticksRemaining,
          ticksTotal: citizen.currentTask.ticksTotal,
          progress: citizen.currentTask.ticksTotal > 0 ? +(1 - citizen.currentTask.ticksRemaining / citizen.currentTask.ticksTotal).toFixed(2) : 1,
        } : null,
        campaignPlatform: state.campaignPlatforms.get(citizen.id) ?? null,
        claims: [...state.claims.values()].filter(c => c.citizenId === citizen.id).map(c => ({
          id: c.id, resourceType: c.resourceType, regionId: c.regionId,
          regionName: state.regions.get(c.regionId)?.name ?? c.regionId, claimedDay: c.claimedDay,
        })),
      },
      events: [],
    };
  }

  if (target === "project") {
    return {
      success: true,
      message: "Collective project details.",
      data: { type: "project", ...getProjectProgress(state) },
      events: [],
    };
  }

  if (target === "market") {
    return {
      success: true,
      message: "Market overview.",
      data: { type: "market", listings: state.market.listings.map(l => ({ ...l })) },
      events: [],
    };
  }

  const law = state.laws.find(l => l.id === makeLawId(target) || l.title.toLowerCase().includes(target.toLowerCase()));
  if (law) {
    return { success: true, message: `Law: ${law.title}`, data: { type: "law", ...law }, events: [] };
  }

  return { success: false, message: `Cannot find "${target}".`, data: {} };
}

function requireIdle(citizen: Citizen): string | null {
  if (citizen.currentTask) {
    return `Busy with ${citizen.currentTask.action} (${citizen.currentTask.ticksRemaining} ticks remaining). Cancel current task first.`;
  }
  return null;
}

export function travel(state: SeasonState, citizenId: CitizenId, destinationId: RegionId): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };
  const currentRegion = state.regions.get(citizen.regionId)!;
  if (!currentRegion.connections.includes(destinationId)) {
    return { success: false, message: `${state.regions.get(destinationId)?.name ?? destinationId} is not connected to ${currentRegion.name}.` };
  }
  citizen.regionId = destinationId;
  const destRegion = state.regions.get(destinationId)!;
  citizen.hunger = Math.min(100, citizen.hunger + 1);
  const event = logEvent(state, "travel", { citizenId, from: currentRegion.id, to: destinationId });
  return { success: true, message: `Traveled to ${destRegion.name}.`, events: [event] };
}

const GATHER_YIELD: Record<BiomeType, Partial<Record<ResourceType, number>>> = {
  forest: { wood: 5, food: 2 },
  marsh: { food: 3 },
  plains: { food: 6 },
  coast: { food: 4, energy: 2 },
  mountains: { ore: 5, energy: 2 },
  settlement: { energy: 1 },
};

const GATHER_POLLUTION: Record<ResourceType, PollutionLevels> = {
  ore: { air: 2, water: 0.5, ground: 3 },
  energy: { air: 1.5, water: 0, ground: 0.5 },
  wood: { air: 0, water: 0, ground: 0.5 },
  food: { air: 0, water: 0.2, ground: 0.1 },
};

const GATHER_SKILL: Record<ResourceType, SkillType> = {
  food: "farming",
  wood: "forestry",
  ore: "mining",
  energy: "engineering",
};

export function gather(state: SeasonState, citizenId: CitizenId, resourceType: ResourceType): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };
  const region = state.regions.get(citizen.regionId)!;
  const available = GATHER_YIELD[region.biome];
  if (!available || !available[resourceType]) {
    return { success: false, message: `Cannot gather ${resourceType} in ${region.name} (${region.biome}).` };
  }
  if (region.deposits[resourceType] <= 0) {
    return { success: false, message: `No ${resourceType} deposits remaining in ${region.name}.` };
  }

  for (const law of state.laws) {
    if (law.stringParams["protectedRegion"] === region.id) {
      const fine = applyLawFine(state, law, citizenId, 5);
      const fineMsg = fine > 0 ? ` Fined ${fine} credits for violating protected region law.` : "";
      return { success: false, message: `Gathering prohibited in ${region.name} by "${law.title}".${fineMsg}` };
    }
    if (law.parameters["extractionCap"] !== undefined && law.stringParams["extractionResource"] === resourceType) {
      const alreadyGathered = (law as unknown as { _gatheredThisTick: Record<string, number> })._gatheredThisTick?.[citizenId] ?? 0;
      if (alreadyGathered >= law.parameters["extractionCap"]) {
        const fine = applyLawFine(state, law, citizenId, 3);
        const fineMsg = fine > 0 ? ` Fined ${fine} credits for exceeding extraction cap.` : "";
        return { success: false, message: `Extraction cap of ${law.parameters["extractionCap"]} ${resourceType}/day reached.${fineMsg}` };
      }
    }
  }

  const claimOnResource = [...state.claims.values()].find(
    c => c.regionId === region.id && c.resourceType === resourceType,
  );
  if (claimOnResource && claimOnResource.citizenId !== citizenId) {
    const owner = state.citizens.get(claimOnResource.citizenId);
    return { success: false, message: `${resourceType} in ${region.name} is claimed by ${owner?.name ?? claimOnResource.citizenId}. You cannot gather it.` };
  }

  const skillLevel = citizen.skills[GATHER_SKILL[resourceType]];
  const baseYield = available[resourceType]!;
  let yield_ = Math.floor(baseYield * (1 + skillLevel * 0.15));

  for (const law of state.laws) {
    if (law.parameters["extractionCap"] !== undefined && law.stringParams["extractionResource"] === resourceType) {
      const alreadyGathered = (law as unknown as { _gatheredThisTick: Record<string, number> })._gatheredThisTick?.[citizenId] ?? 0;
      const remaining = Math.max(0, law.parameters["extractionCap"]! - alreadyGathered);
      yield_ = Math.min(yield_, remaining);
      if (yield_ > 0) {
        if (!(law as unknown as { _gatheredThisTick: Record<string, number> })._gatheredThisTick) {
          (law as unknown as { _gatheredThisTick: Record<string, number> })._gatheredThisTick = {};
        }
        (law as unknown as { _gatheredThisTick: Record<string, number> })._gatheredThisTick[citizenId] = alreadyGathered + yield_;
      }
    }
  }

  const actualYield = Math.min(yield_, region.deposits[resourceType]);
  if (actualYield <= 0) {
    return { success: false, message: `No ${resourceType} available to gather (possibly limited by law).` };
  }

  region.deposits[resourceType] -= actualYield;
  addToInventory(citizen.inventory, resourceType, actualYield);

  const pollMult = 1 + actualYield * 0.1;
  const pollAdded = GATHER_POLLUTION[resourceType];
  region.pollution.air += pollAdded.air * pollMult;
  region.pollution.water += pollAdded.water * pollMult;
  region.pollution.ground += pollAdded.ground * pollMult;
  const totalPollAdded = (pollAdded.air + pollAdded.water + pollAdded.ground) * pollMult;
  state.globalFootprint += totalPollAdded;

  if (resourceType === "ore") {
    region.fertility = Math.max(0, region.fertility - 0.5);
    region.soilDepth = Math.max(0, region.soilDepth - 0.2);
  } else {
    region.fertility = Math.max(0, region.fertility - 0.1);
  }
  if (resourceType === "food") {
    region.soilDepth = Math.max(0, region.soilDepth - 0.1);
  }
  improveSkill(citizen, GATHER_SKILL[resourceType], 0.05);
  citizen.hunger = Math.min(100, citizen.hunger + 3);

  const airP = (pollAdded.air * pollMult).toFixed(1);
  const waterP = (pollAdded.water * pollMult).toFixed(1);
  const groundP = (pollAdded.ground * pollMult).toFixed(1);
  const event = logEvent(state, "gather", { citizenId, regionId: region.id, resourceType, amount: actualYield, pollutionAdded: totalPollAdded, pollutionBreakdown: { air: pollAdded.air * pollMult, water: pollAdded.water * pollMult, ground: pollAdded.ground * pollMult } });
  return { success: true, message: `Gathered ${actualYield} ${resourceType} from ${region.name}. Pollution +${totalPollAdded.toFixed(1)} (air:${airP} water:${waterP} ground:${groundP}).`, events: [event] };
}

const CRAFT_RECIPES: Record<string, { input: Partial<Inventory>; output: { type: ResourceType; amount: number }; skill: SkillType; pollution: PollutionLevels }> = {
  refined_ore: { input: { ore: 3 }, output: { type: "ore", amount: 2 }, skill: "crafting", pollution: { air: 1.5, water: 0.5, ground: 0 } },
  processed_energy: { input: { ore: 1, wood: 1 }, output: { type: "energy", amount: 3 }, skill: "engineering", pollution: { air: 2, water: 0, ground: 0.5 } },
  preserved_food: { input: { food: 3, wood: 1 }, output: { type: "food", amount: 2 }, skill: "crafting", pollution: { air: 0, water: 0.2, ground: 0.3 } },
};

export function craft(state: SeasonState, citizenId: CitizenId, recipe: string): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };

  const r = CRAFT_RECIPES[recipe];
  if (!r) return { success: false, message: `Unknown recipe: ${recipe}. Available: ${Object.keys(CRAFT_RECIPES).join(", ")}` };

  for (const [res, amount] of Object.entries(r.input)) {
    if (!inventoryHas(citizen.inventory, res as ResourceType, amount!)) {
      return { success: false, message: `Not enough ${res}. Need ${amount}, have ${citizen.inventory[res as ResourceType]}.` };
    }
  }

  for (const [res, amount] of Object.entries(r.input)) {
    removeFromInventory(citizen.inventory, res as ResourceType, amount!);
  }

  const skillLevel = citizen.skills[r.skill];
  const outputAmount = Math.floor(r.output.amount * (1 + skillLevel * 0.1));
  addToInventory(citizen.inventory, r.output.type, outputAmount);

  const region = state.regions.get(citizen.regionId)!;
  region.pollution.air += r.pollution.air;
  region.pollution.water += r.pollution.water;
  region.pollution.ground += r.pollution.ground;
  state.globalFootprint += r.pollution.air + r.pollution.water + r.pollution.ground;

  improveSkill(citizen, r.skill, 0.08);
  citizen.hunger = Math.min(100, citizen.hunger + 2);

  const pollTotal = r.pollution.air + r.pollution.water + r.pollution.ground;
  const event = logEvent(state, "craft", { citizenId, recipe, outputType: r.output.type, outputAmount, pollutionAdded: pollTotal });
  return { success: true, message: `Crafted ${outputAmount} ${r.output.type} using ${recipe}.`, events: [event] };
}

export function contribute(state: SeasonState, citizenId: CitizenId, resourceType: ResourceType, amount: number, laborHours: number): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };
  if (state.project.completed) return { success: false, message: "The collective project is already complete." };

  const stage = state.project.stages[state.project.currentStageIndex];
  if (!stage || stage.completed) return { success: false, message: "No active stage to contribute to." };

  if (amount > 0) {
    if (!inventoryHas(citizen.inventory, resourceType, amount)) {
      return { success: false, message: `Not enough ${resourceType}. Have ${citizen.inventory[resourceType]}, need ${amount}.` };
    }
    removeFromInventory(citizen.inventory, resourceType, amount);
    stage.contributedResources[resourceType] = (stage.contributedResources[resourceType] ?? 0) + amount;
  }

  if (laborHours > 0) {
    let laborMultiplier = 1 + citizen.skills.engineering * 0.1;
    if (state.projectPriorityResource && resourceType === state.projectPriorityResource) {
      laborMultiplier *= 1.2;
    }
    const effectiveLabor = laborHours * laborMultiplier;
    stage.contributedLabor += effectiveLabor;
  }

  improveSkill(citizen, "engineering", 0.03);

  const event = logEvent(state, "contribute", { citizenId, stageId: stage.id, resourceType, amount, laborHours });
  return { success: true, message: `Contributed ${amount} ${resourceType} and ${laborHours} labor to ${stage.name}.`, events: [event] };
}

export function trade(state: SeasonState, citizenId: CitizenId, listingId: string): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };

  const listingIndex = state.market.listings.findIndex(l => l.id === listingId);
  if (listingIndex === -1) return { success: false, message: "Listing not found." };
  const listing = state.market.listings[listingIndex]!;

  if (listing.seller === citizenId) return { success: false, message: "Cannot buy your own listing." };

  let totalCost = listing.quantity * listing.pricePerUnit;
  let tariffAmount = 0;
  for (const law of state.laws) {
    if (law.parameters["tradeTariff"] !== undefined) {
      tariffAmount = Math.ceil(totalCost * law.parameters["tradeTariff"]);
      totalCost += tariffAmount;
    }
  }

  if (citizen.credits < totalCost) return { success: false, message: `Not enough credits. Need ${totalCost} (including ${tariffAmount} tariff), have ${citizen.credits}.` };

  const seller = state.citizens.get(listing.seller);
  if (!seller) return { success: false, message: "Seller no longer exists." };

  citizen.credits -= totalCost;
  seller.credits += totalCost - tariffAmount;
  if (tariffAmount > 0) state.treasury += tariffAmount;
  addToInventory(citizen.inventory, listing.resourceType, listing.quantity);

  state.market.listings.splice(listingIndex, 1);

  const priceEntry = { day: state.day, avgPrice: listing.pricePerUnit };
  state.market.priceHistory[listing.resourceType].push(priceEntry);

  const eventData: Record<string, unknown> = { buyer: citizenId, seller: listing.seller, resourceType: listing.resourceType, quantity: listing.quantity, totalPrice: totalCost };
  if (tariffAmount > 0) eventData.tariffAmount = tariffAmount;
  const event = logEvent(state, "trade", eventData);
  return { success: true, message: `Bought ${listing.quantity} ${listing.resourceType} for ${totalCost} credits${tariffAmount > 0 ? ` (includes ${tariffAmount} tariff)` : ""}.`, events: [event] };
}

export function listOnMarket(state: SeasonState, citizenId: CitizenId, resourceType: ResourceType, quantity: number, pricePerUnit: number): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };
  if (!inventoryHas(citizen.inventory, resourceType, quantity)) {
    return { success: false, message: `Not enough ${resourceType}. Have ${citizen.inventory[resourceType]}, need ${quantity}.` };
  }

  removeFromInventory(citizen.inventory, resourceType, quantity);
  const listing: MarketListing = {
    id: `listing-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    seller: citizenId,
    resourceType,
    quantity,
    pricePerUnit,
    listedDay: state.day,
  };
  state.market.listings.push(listing);

  const event = logEvent(state, "list_market", { citizenId, resourceType, quantity, pricePerUnit });
  return { success: true, message: `Listed ${quantity} ${resourceType} at ${pricePerUnit} credits each.`, events: [event] };
}

export function give(state: SeasonState, fromId: CitizenId, toId: CitizenId, resourceType: ResourceType, amount: number): ActionResult {
  const from = state.citizens.get(fromId);
  const to = state.citizens.get(toId);
  if (!from || !from.alive) return { success: false, message: "Sender not found or dead." };
  if (!to || !to.alive) return { success: false, message: "Recipient not found or dead." };
  const busy = requireIdle(from);
  if (busy) return { success: false, message: busy };
  if (!inventoryHas(from.inventory, resourceType, amount)) {
    return { success: false, message: `Not enough ${resourceType}.` };
  }

  removeFromInventory(from.inventory, resourceType, amount);
  addToInventory(to.inventory, resourceType, amount);

  const event = logEvent(state, "give", { from: fromId, to: toId, resourceType, amount });
  return { success: true, message: `Gave ${amount} ${resourceType} to ${to.name}.`, events: [event] };
}

export function propose(state: SeasonState, citizenId: CitizenId, title: string, description: string, category: LawCategory, parameters: Record<string, number>, stringParams?: Record<string, string>): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };

  const proposal: Proposal = {
    id: makeProposalId(`proposal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    title,
    description,
    category,
    proposer: citizenId,
    proposedDay: state.day,
    votesFor: new Set(),
    votesAgainst: new Set(),
    status: "active",
    parameters,
    stringParams: stringParams ?? {},
  };
  state.proposals.set(proposal.id, proposal);

  improveSkill(citizen, "governance", 0.05);

  const event = logEvent(state, "propose", { citizenId, proposalId: proposal.id, title, category, parameters, stringParams: stringParams ?? {} });
  return { success: true, message: `Proposal "${title}" submitted. Vote pending.`, events: [event] };
}

export function vote(state: SeasonState, citizenId: CitizenId, proposalId: ProposalId, support: boolean): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };

  const proposal = state.proposals.get(proposalId);
  if (!proposal || proposal.status !== "active") return { success: false, message: "Proposal not found or no longer active." };

  proposal.votesFor.delete(citizenId);
  proposal.votesAgainst.delete(citizenId);

  if (support) {
    proposal.votesFor.add(citizenId);
  } else {
    proposal.votesAgainst.add(citizenId);
  }

  improveSkill(citizen, "governance", 0.02);

  const totalVotes = proposal.votesFor.size + proposal.votesAgainst.size;
  const aliveCount = [...state.citizens.values()].filter(c => c.alive).length;

  if (totalVotes >= Math.ceil(aliveCount * 0.5) && totalVotes > 0) {
    if (proposal.votesFor.size > proposal.votesAgainst.size) {
      enactProposal(state, proposal);
      const event = logEvent(state, "vote_resolution", { proposalId, result: "enacted", votesFor: proposal.votesFor.size, votesAgainst: proposal.votesAgainst.size });
      return { success: true, message: `Voted ${support ? "for" : "against"}. Proposal "${proposal.title}" enacted!`, events: [event] };
    } else {
      proposal.status = "rejected";
      const event = logEvent(state, "vote_resolution", { proposalId, result: "rejected", votesFor: proposal.votesFor.size, votesAgainst: proposal.votesAgainst.size });
      return { success: true, message: `Voted ${support ? "for" : "against"}. Proposal "${proposal.title}" rejected.`, events: [event] };
    }
  }

  const event = logEvent(state, "vote", { citizenId, proposalId, support });
  return { success: true, message: `Voted ${support ? "for" : "against"} "${proposal.title}". ${proposal.votesFor.size} for, ${proposal.votesAgainst.size} against.`, events: [event] };
}

function enactProposal(state: SeasonState, proposal: Proposal): void {
  proposal.status = "enacted";
  const law: Law = {
    id: makeLawId(proposal.id),
    title: proposal.title,
    description: proposal.description,
    category: proposal.category,
    proposer: proposal.proposer,
    enactedDay: state.day,
    parameters: { ...proposal.parameters },
    stringParams: { ...proposal.stringParams },
    violations: {},
  };
  state.laws.push(law);
}

export function campaign(state: SeasonState, citizenId: CitizenId, platform?: string): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };
  if (!state.electionActive) return { success: false, message: "No active election." };
  if (state.electionCandidates.includes(citizenId)) return { success: false, message: "Already a candidate." };

  state.electionCandidates.push(citizenId);
  improveSkill(citizen, "governance", 0.03);
  if (platform) state.campaignPlatforms.set(citizenId, platform);

  const eventData: Record<string, unknown> = { citizenId, office: state.electionOffice };
  if (platform) eventData.platform = platform;
  const event = logEvent(state, "campaign", eventData);
  return { success: true, message: `${citizen.name} is now running for ${state.electionOffice}.${platform ? ` Platform: "${platform}"` : ""}`, events: [event] };
}

export function voteInElection(state: SeasonState, citizenId: CitizenId, candidateId: CitizenId): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  if (!state.electionActive) return { success: false, message: "No active election." };
  if (!state.electionCandidates.includes(candidateId)) return { success: false, message: "Not a valid candidate." };

  state.electionVotes.set(citizenId, candidateId);
  const event = logEvent(state, "election_vote", { voter: citizenId, candidate: candidateId });
  return { success: true, message: `Voted for ${state.citizens.get(candidateId)?.name ?? candidateId}.`, events: [event] };
}

export function startElection(state: SeasonState, office?: OfficeType): ActionResult {
  if (state.electionActive) return { success: false, message: "Election already active." };
  state.electionActive = true;
  state.electionOffice = office ?? "coordinator";
  state.electionCandidates = [];
  state.electionVotes = new Map();
  const event = logEvent(state, "election_started", { day: state.day, office: state.electionOffice });
  return { success: true, message: `Election started for ${state.electionOffice}. Citizens may now campaign and vote.`, events: [event] };
}

export function closeElection(state: SeasonState): ActionResult {
  if (!state.electionActive) return { success: false, message: "No active election." };
  if (state.electionCandidates.length === 0) {
    state.electionActive = false;
    return { success: false, message: "No candidates. Election closed without result." };
  }

  const tally = new Map<CitizenId, number>();
  for (const candidate of state.electionCandidates) {
    tally.set(candidate, 0);
  }
  for (const candidate of state.electionVotes.values()) {
    tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
  }

  let winnerId = state.electionCandidates[0]!;
  let maxVotes = 0;
  for (const [cand, count] of tally) {
    if (count > maxVotes) {
      maxVotes = count;
      winnerId = cand;
    }
  }

  const office = state.electionOffice;
  const prevHolderId = getOfficeHolderId(state, office);
  if (prevHolderId) {
    const prev = state.citizens.get(prevHolderId);
    if (prev) prev.office = null;
  }

  const winner = state.citizens.get(winnerId);
  if (winner) winner.office = office;

  switch (office) {
    case "coordinator": state.coordinatorId = winnerId; break;
    case "ecology_steward": state.ecologyStewardId = winnerId; break;
    case "project_director": state.projectDirectorId = winnerId; break;
  }

  state.lastElectionDay = Math.max(1, state.day);
  state.electionActive = false;

  const event = logEvent(state, "election_closed", { winnerId, votes: maxVotes, office });
  return { success: true, message: `${winner?.name ?? winnerId} elected ${office} with ${maxVotes} votes.`, events: [event] };
}

export type GovernAction = "allocate_treasury" | "set_project_priority" | "emergency_pollution_cap" | "call_levy_vote";

export function govern(state: SeasonState, citizenId: CitizenId, action: GovernAction, params: Record<string, number>, stringParams?: Record<string, string>): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };

  if (action === "allocate_treasury") {
    if (citizen.office !== "coordinator") return { success: false, message: "Only the coordinator can allocate treasury." };
    const amount = params["amount"] ?? 0;
    const targetId = makeCitizenId(String(params["targetCitizen"] ?? ""));
    const target = state.citizens.get(targetId);
    if (!target) return { success: false, message: "Target citizen not found." };
    if (amount > state.treasury) return { success: false, message: `Treasury has ${state.treasury} credits. Cannot allocate ${amount}.` };

    state.treasury -= amount;
    target.credits += amount;
    const event = logEvent(state, "govern_allocate", { coordinatorId: citizenId, targetId, amount });
    return { success: true, message: `Allocated ${amount} credits from treasury to ${target.name}.`, events: [event] };
  }

  if (action === "set_project_priority") {
    if (citizen.office !== "project_director" && citizen.office !== "coordinator") {
      return { success: false, message: "Only the project director or coordinator can set project priority." };
    }
    const resType = stringParams?.["resource"] ?? "";
    if (!RESOURCE_TYPES.includes(resType as ResourceType)) {
      return { success: false, message: `Invalid resource type: ${resType}. Must be one of: ${RESOURCE_TYPES.join(", ")}` };
    }
    state.projectPriorityResource = resType as ResourceType;
    const event = logEvent(state, "govern_project_priority", { citizenId, resource: resType });
    return { success: true, message: `Project priority set to ${resType}. Contributors working on ${resType} stages receive a 20% efficiency bonus.`, events: [event] };
  }

  if (action === "emergency_pollution_cap") {
    if (citizen.office !== "ecology_steward") {
      return { success: false, message: "Only the ecology steward can declare emergency pollution caps." };
    }
    const cap = params["emissionCap"] ?? 10;
    const regionId = stringParams?.["regionId"] ?? "";
    const pollutionType = (stringParams?.["pollutionType"] ?? "air") as PollutionType;
    const law: Law = {
      id: makeLawId(`emergency-cap-${Date.now()}`),
      title: `Emergency ${pollutionType} Cap (${regionId || "global"})`,
      description: `Emergency ${pollutionType} emission cap of ${cap} set by ecology steward.`,
      category: "environmental",
      proposer: citizenId,
      enactedDay: state.day,
      parameters: { emissionCap: cap },
      stringParams: { ...(regionId ? { targetRegion: regionId } : {}), pollutionType },
      violations: {},
    };
    state.laws.push(law);
    const event = logEvent(state, "govern_emergency_cap", { citizenId, cap, regionId, pollutionType });
    return { success: true, message: `Emergency ${pollutionType} cap of ${cap} enacted${regionId ? ` for region ${regionId}` : " globally"}.`, events: [event] };
  }

  if (action === "call_levy_vote") {
    if (citizen.office !== "project_director" && citizen.office !== "coordinator") {
      return { success: false, message: "Only the project director or coordinator can call for a levy vote." };
    }
    const levyAmount = params["levyAmount"] ?? 5;
    const levyResource = stringParams?.["levyResource"] ?? "ore";
    const result = propose(state, citizenId, `Resource Levy: ${levyAmount} ${levyResource}`, `Mandatory contribution of ${levyAmount} ${levyResource} per citizen to the collective project.`, "project", { levyAmount, levyResource: 0 }, { levyResource });
    return result;
  }

  return { success: false, message: `Unknown govern action: ${action}` };
}

export interface ModerationConfig {
  enabled: boolean;
  maxMessageLength: number;
  blockedPatterns: RegExp[];
  cooldownMs: number;
  profanityFilter: boolean;
  repeatFilter: boolean;
  repeatWindowMs: number;
  maxRepeats: number;
}

const PROFANITY_LIST = [
  /\b(damn|hell|crap|shit|fuck|bitch|bastard|asshole|dickhead)\b/i,
];

export const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
  enabled: true,
  maxMessageLength: 500,
  blockedPatterns: [
    /\b(?:https?:\/\/|www\.)\S+/i,
  ],
  cooldownMs: 2000,
  profanityFilter: true,
  repeatFilter: true,
  repeatWindowMs: 30000,
  maxRepeats: 3,
};

export const DEFAULT_MODERATION_MESSAGES = {
  tooLong: "Message exceeds maximum length.",
  blocked: "Message blocked by content policy.",
  cooldown: "You are sending messages too quickly. Wait a moment.",
  profanity: "Message contains prohibited language.",
  repeat: "You have sent this message too many times.",
};

export function moderateMessage(message: string, config: ModerationConfig, recentMessages?: string[]): { allowed: boolean; reason?: string } {
  if (!config.enabled) return { allowed: true };
  if (message.length > config.maxMessageLength) {
    return { allowed: false, reason: DEFAULT_MODERATION_MESSAGES.tooLong };
  }
  for (const pattern of config.blockedPatterns) {
    if (pattern.test(message)) {
      return { allowed: false, reason: DEFAULT_MODERATION_MESSAGES.blocked };
    }
  }
  if (config.profanityFilter) {
    for (const pattern of PROFANITY_LIST) {
      if (pattern.test(message)) {
        return { allowed: false, reason: DEFAULT_MODERATION_MESSAGES.profanity };
      }
    }
  }
  if (config.repeatFilter && recentMessages && recentMessages.length > 0) {
    const now = Date.now();
    const normalized = message.toLowerCase().trim();
    const recentSame = recentMessages.filter(m => m.toLowerCase().trim() === normalized).length;
    if (recentSame >= config.maxRepeats) {
      return { allowed: false, reason: DEFAULT_MODERATION_MESSAGES.repeat };
    }
  }
  return { allowed: true };
}

export function say(state: SeasonState, citizenId: CitizenId, channel: string, message: string, moderationConfig: ModerationConfig = DEFAULT_MODERATION_CONFIG): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };

  const recentMessages: string[] = [];
  if (moderationConfig.repeatFilter) {
    const cutoff = Date.now() - moderationConfig.repeatWindowMs;
    for (const ch of Object.values(state.channels)) {
      for (const m of ch) {
        if (m.citizenId === citizenId && m.timestamp >= cutoff) {
          recentMessages.push(m.message);
        }
      }
    }
  }

  const modResult = moderateMessage(message, moderationConfig, recentMessages);
  if (!modResult.allowed) {
    return { success: false, message: modResult.reason ?? "Message blocked by content policy." };
  }

  if (!state.channels[channel]) state.channels[channel] = [];
  const channelMsg: ChannelMessage = {
    day: state.day,
    citizenId,
    citizenName: citizen.name,
    channel,
    message,
    timestamp: Date.now(),
  };
  state.channels[channel].push(channelMsg);
  if (state.channels[channel].length > 200) {
    state.channels[channel] = state.channels[channel].slice(-200);
  }

  const event = logEvent(state, "say", { citizenId, citizenName: citizen.name, channel, message });
  return { success: true, message: `Message sent to ${channel}.`, events: [event] };
}

export function journal(state: SeasonState, citizenId: CitizenId, entry: string): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };

  const event = logEvent(state, "journal", { citizenId, entry });
  return { success: true, message: "Journal entry recorded.", events: [event] };
}

export function readChannels(state: SeasonState, citizenId: CitizenId, channels: string[], limit?: number): ActionResult & { data: Record<string, unknown> } {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead.", data: {} };

  const maxMessages = limit ?? 20;
  const result: Record<string, ChannelMessage[]> = {};
  const subscribedChannels = channels.length > 0 ? channels : ["global", citizen.regionId];

  for (const ch of subscribedChannels) {
    if (state.channels[ch]) {
      result[ch] = state.channels[ch].slice(-maxMessages);
    } else {
      result[ch] = [];
    }
  }

  return {
    success: true,
    message: `Read ${Object.keys(result).length} channel(s).`,
    data: { channels: result },
    events: [],
  };
}

export function buyFood(state: SeasonState, citizenId: CitizenId, amount: number): ActionResult {
 const citizen = state.citizens.get(citizenId);
 if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
 // Allow buying food while busy — survival shouldn't be blocked by task queue
 // (buy_food is instant, so it doesn't conflict with the current task)
 if (amount <= 0) return { success: false, message: "Amount must be positive." };

  const region = state.regions.get(citizen.regionId)!;
  const maxAvailable = Math.max(1, Math.floor(region.deposits.food * 0.5));
  const available = Math.min(amount, maxAvailable);
  if (available <= 0) return { success: false, message: `No food available for purchase in ${region.name}.` };

  const scarcityMultiplier = 1 + (totalPollution(region.pollution) * 0.05) + Math.max(0, (100 - region.fertility) * 0.02);
  const pricePerUnit = Math.ceil(3 * scarcityMultiplier);

  // Allow buying just 1 unit if agent can't afford the full amount
  const affordable = Math.min(available, Math.floor(citizen.credits / pricePerUnit));
  if (affordable <= 0) return { success: false, message: `Not enough credits. Food costs ${pricePerUnit}/unit. Have ${citizen.credits}.` };

  const totalCost = pricePerUnit * affordable;

  if (citizen.credits < totalCost) return { success: false, message: `Not enough credits. ${affordable} food costs ${totalCost} credits (scarcity-adjusted price: ${pricePerUnit}/unit). Have ${citizen.credits}.` };

  citizen.credits -= totalCost;
  state.treasury += totalCost;
  region.deposits.food -= affordable;
  addToInventory(citizen.inventory, "food", affordable);

  const event = logEvent(state, "buy_food", { citizenId, regionId: region.id, amount: affordable, totalCost, pricePerUnit });
  return { success: true, message: `Bought ${affordable} food for ${totalCost} credits (${pricePerUnit}/unit).`, events: [event] };
}

export function claim(state: SeasonState, citizenId: CitizenId, regionId: RegionId, resourceType: ResourceType): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };

  const region = state.regions.get(regionId);
  if (!region) return { success: false, message: "Region not found." };

  if (citizen.regionId !== regionId) {
    return { success: false, message: `You must be in ${region.name} to claim resources there.` };
  }

  const existingClaim = [...state.claims.values()].find(
    c => c.regionId === regionId && c.resourceType === resourceType,
  );
  if (existingClaim) {
    const owner = state.citizens.get(existingClaim.citizenId);
    return { success: false, message: `${resourceType} in ${region.name} is already claimed by ${owner?.name ?? existingClaim.citizenId}.` };
  }

  const citizenClaims = [...state.claims.values()].filter(c => c.citizenId === citizenId);
  if (citizenClaims.length >= state.maxClaimsPerCitizen) {
    return { success: false, message: `You already have ${citizenClaims.length} claims (max ${state.maxClaimsPerCitizen}). Relinquish one first.` };
  }

  const claimId = makeClaimId(`claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const newClaim: PropertyClaim = {
    id: claimId,
    regionId,
    citizenId,
    resourceType,
    claimedDay: state.day,
  };
  state.claims.set(claimId, newClaim);

  const event = logEvent(state, "claim", { claimId, citizenId, regionId, resourceType });
  return { success: true, message: `Claimed ${resourceType} extraction rights in ${region.name}.`, events: [event] };
}

export function relinquishClaim(state: SeasonState, citizenId: CitizenId, claimId: ClaimId): ActionResult {
  const citizen = state.citizens.get(citizenId);
  if (!citizen || !citizen.alive) return { success: false, message: "Citizen not found or dead." };
  const busy = requireIdle(citizen);
  if (busy) return { success: false, message: busy };

  const existing = state.claims.get(claimId);
  if (!existing) return { success: false, message: "Claim not found." };
  if (existing.citizenId !== citizenId) return { success: false, message: "You can only relinquish your own claims." };

  state.claims.delete(claimId);
  const event = logEvent(state, "relinquish_claim", { claimId, citizenId, regionId: existing.regionId, resourceType: existing.resourceType });
  return { success: true, message: `Relinquished ${existing.resourceType} claim in ${state.regions.get(existing.regionId)?.name ?? existing.regionId}.`, events: [event] };
}

export function tick(state: SeasonState): EventLogEntry[] {
  const events: EventLogEntry[] = [];
  state.day++;

  const taskEvents = processTasks(state);
  events.push(...taskEvents);

  for (const law of state.laws) {
    if ((law as unknown as { _gatheredThisTick: Record<string, number> })._gatheredThisTick) {
      (law as unknown as { _gatheredThisTick: Record<string, number> })._gatheredThisTick = {};
    }
  }

  for (const region of state.regions.values()) {
    for (const pt of POLLUTION_TYPES) {
      if (region.pollution[pt] > 0) {
        const decay = pt === "air" ? 0.15 : pt === "water" ? 0.08 : 0.05;
        region.pollution[pt] = Math.max(0, region.pollution[pt] - decay);
      }
    }

 const totalPoll = totalPollution(region.pollution);
 const pollutionFertilityPenalty = totalPoll * 0.015;
 const soilRecovery = region.soilDepth < 80 ? 0.05 * (region.fertility / 100) : 0;
 region.soilDepth = Math.min(100, region.soilDepth + soilRecovery);
 region.fertility = Math.min(100, region.fertility + 0.05 * (region.soilDepth / 100) - pollutionFertilityPenalty);
 if (region.pollution.ground > 5) {
  region.fertility -= region.pollution.ground * 0.005;
  region.fertility = Math.max(0, region.fertility);
 }

 // Resource deposit regeneration
 const f = region.fertility / 100;
 const s = region.soilDepth / 100;
 const rainfallMult = region.climate.rainfall > 30 ? 1 : region.climate.rainfall / 30;
 // Food regrows based on fertility, soil, rainfall (biome-dependent base rate)
 const foodRegenRate = (region.biome === "marsh" || region.biome === "coast" ? 0.8 : 0.5) * f * s * rainfallMult;
 region.deposits.food = Math.min(region.deposits.food + foodRegenRate, region.biome === "forest" ? 400 : region.biome === "marsh" || region.biome === "coast" ? 150 : 300);
 // Wood regrows slowly in forests, very slowly elsewhere
 const woodRegenRate = (region.biome === "forest" ? 0.3 : 0.05) * f * s;
 region.deposits.wood = Math.min(region.deposits.wood + woodRegenRate, region.biome === "forest" ? 300 : 100);
 // Ore regenerates extremely slowly (geological processes)
 region.deposits.ore = Math.min(region.deposits.ore + 0.02, region.biome === "mountains" ? 200 : 100);
 // Energy regenerates from solar/wind (biome-dependent)
 const energyRegenRate = (region.biome === "mountains" || region.biome === "coast" ? 0.15 : 0.05);
 region.deposits.energy = Math.min(region.deposits.energy + energyRegenRate, 150);

    const carryingCapacity = (region: Region): Partial<SpeciesPopulation> => {
      const base: Partial<SpeciesPopulation> = {};
      const f = region.fertility / 100;
      const s = region.soilDepth / 100;
      const rainfallMult = region.climate.rainfall > 30 ? 1 : region.climate.rainfall / 30;
      base.plants = Math.floor(120 * f * s * rainfallMult);
      base.insects = Math.floor((base.plants ?? 0) * 0.6);
      base.herbivores = Math.floor((base.plants ?? 0) * 0.5);
      base.fish = region.biome === "coast" || region.biome === "marsh"
        ? Math.floor(80 * f * (region.climate.rainfall / 100))
        : Math.floor(15 * f * (region.climate.rainfall / 100));
      base.predators = Math.floor(((base.herbivores ?? 0) + (base.fish ?? 0)) * 0.3);
      return base;
    };

    const cc = carryingCapacity(region);

    for (const sp of SPECIES_NAMES) {
      const current = region.species[sp];
      const max = cc[sp] ?? 50;
      const foodSources = FOOD_WEB[sp];
      let foodAvailable = Infinity;
      for (const prey of foodSources) {
        foodAvailable = Math.min(foodAvailable, region.species[prey] * 0.5);
      }
      if (foodSources.length === 0) {
        foodAvailable = max;
      }

      const pollutionPenalty = totalPoll > 10 ? 1 - (totalPoll - 10) * 0.01 : 1;
      const growthRate = sp === "plants" ? 0.08 : sp === "insects" ? 0.06 : 0.04;
      const effectiveCapacity = Math.min(max, foodAvailable) * pollutionPenalty;

      if (current < effectiveCapacity) {
        const growth = Math.min(growthRate * current * (1 - current / effectiveCapacity), effectiveCapacity - current);
        region.species[sp] = Math.max(0, current + Math.floor(growth));
      } else if (current > effectiveCapacity) {
        const decline = (current - effectiveCapacity) * 0.05;
        region.species[sp] = Math.max(0, current - Math.floor(decline));
      }
    }

    for (const neighborId of region.connections) {
      const neighbor = state.regions.get(neighborId)!;
      for (const pt of POLLUTION_TYPES) {
        if (region.pollution[pt] > neighbor.pollution[pt]) {
          const spreadRate = pt === "water" ? 0.1 : pt === "air" ? 0.08 : 0.03;
          const spread = (region.pollution[pt] - neighbor.pollution[pt]) * spreadRate;
          neighbor.pollution[pt] += spread;
          region.pollution[pt] -= spread;
        }
      }
    }

    const tempAnomaly = state.climate.temperature - state.climate.baselineTemperature;
    region.climate.temperature = (region.climate.temperature + tempAnomaly * 0.01);
    if (region.pollution.air > 5) {
      region.climate.rainfall = Math.max(0, region.climate.rainfall - region.pollution.air * 0.01);
    }
  }

  const totalAirPollution = [...state.regions.values()].reduce((s, r) => s + r.pollution.air, 0);
  state.climate.temperature = state.climate.baselineTemperature + totalAirPollution * state.climate.warmingRate;


  for (const citizen of state.citizens.values()) {
    if (!citizen.alive) continue;

    citizen.hunger += state.config.hungerPerTick;

  // Basic income: 5 credits per tick to ensure agents can afford food
  citizen.credits += 5;

    if (citizen.inventory.food > 0) {
      const eaten = Math.min(2, citizen.inventory.food);
      citizen.inventory.food -= eaten;
      citizen.hunger = Math.max(0, citizen.hunger - eaten * 5);
    }

    if (citizen.hunger >= 80) {
      citizen.health -= 5;
    } else if (citizen.hunger < 20) {
      citizen.health = Math.min(100, citizen.health + 1);
    }

    const region = state.regions.get(citizen.regionId)!;
    const totalPoll = totalPollution(region.pollution);
    if (totalPoll > 20) {
      citizen.health -= Math.floor(totalPoll * 0.1);
    }

    if (citizen.health <= 0) {
      citizen.alive = false;
      citizen.health = 0;
      events.push(logEvent(state, "citizen_died", { citizenId: citizen.id, cause: citizen.hunger >= 80 ? "starvation" : "pollution" }));
    }
  }

  for (const law of state.laws) {
    if (law.category === "environmental" && law.parameters["emissionCap"] !== undefined) {
      const targetRegion = law.stringParams["targetRegion"];
      const targetPollutionType = (law.stringParams["pollutionType"] ?? "air") as PollutionType;
      for (const region of state.regions.values()) {
        if (targetRegion && region.id !== targetRegion) continue;
        if (region.pollution[targetPollutionType] > law.parameters["emissionCap"]!) {
          const fine = Math.floor((region.pollution[targetPollutionType] - law.parameters["emissionCap"]!) * 2);
          for (const citizen of state.citizens.values()) {
            if (citizen.regionId === region.id && citizen.alive) {
              const regionCitizenCount = [...state.citizens.values()].filter(c => c.regionId === region.id && c.alive).length;
              const deducted = Math.min(citizen.credits, Math.ceil(fine / regionCitizenCount));
              citizen.credits -= deducted;
              state.treasury += deducted;
            }
          }
        }
      }
    }
    if (law.category === "resource" && law.parameters["rationAmount"] !== undefined) {
      const rationAmount = law.parameters["rationAmount"]!;
      const rationResource = (law.stringParams["rationResource"] ?? "food") as ResourceType;
      for (const citizen of state.citizens.values()) {
        if (citizen.alive && citizen.inventory[rationResource] > rationAmount) {
          const excess = citizen.inventory[rationResource] - rationAmount;
          removeFromInventory(citizen.inventory, rationResource, excess);
          state.treasury += excess;
        }
      }
    }
    if (law.category === "economic" && law.parameters["taxRate"] !== undefined) {
      const taxRate = law.parameters["taxRate"]!;
      for (const citizen of state.citizens.values()) {
        if (citizen.alive && citizen.credits > 0) {
          const tax = Math.ceil(citizen.credits * taxRate);
          citizen.credits -= tax;
          state.treasury += tax;
        }
      }
    }
    if (law.category === "project" && law.parameters["levyAmount"] !== undefined) {
      const levy = law.parameters["levyAmount"]!;
      const levyResource = (law.stringParams["levyResource"] ?? "ore") as ResourceType;
      for (const citizen of state.citizens.values()) {
        if (citizen.alive && citizen.inventory[levyResource] >= levy) {
          removeFromInventory(citizen.inventory, levyResource, levy);
          if (!state.project.completed && state.project.currentStageIndex < state.project.stages.length) {
            const stage = state.project.stages[state.project.currentStageIndex]!;
            stage.contributedResources[levyResource] = (stage.contributedResources[levyResource] ?? 0) + levy;
          }
        }
      }
    }
    if (law.parameters["enforcementFine"] !== undefined) {
      for (const [cid, violationCount] of Object.entries(law.violations)) {
        const citizen = state.citizens.get(cid as CitizenId);
        if (citizen && citizen.alive && violationCount > 0) {
          const scalingFine = Math.floor(law.parameters["enforcementFine"] * Math.pow(1.5, violationCount - 1));
          const deducted = Math.min(citizen.credits, scalingFine);
          citizen.credits -= deducted;
          state.treasury += deducted;
          if (deducted > 0) {
            events.push(logEvent(state, "law_fine", { citizenId: cid, lawId: law.id, fine: deducted, violations: violationCount }));
          }
        }
      }
      law.violations = {};
    }
  }

 if (!state.project.completed) {
 checkStageCompletion(state);
 // Compute which resource the project needs most — guides agents to prioritize
 if (!state.project.completed && state.project.currentStageIndex < state.project.stages.length) {
 const stage = state.project.stages[state.project.currentStageIndex]!;
 let bestResource: ResourceType | null = null;
 let bestDeficit = 0;
 for (const [res, needed] of Object.entries(stage.requiredResources)) {
 const contributed = stage.contributedResources[res as ResourceType] ?? 0;
 const deficit = needed - contributed;
 if (deficit > bestDeficit) {
 bestDeficit = deficit;
 bestResource = res as ResourceType;
 }
 }
 state.projectPriorityResource = bestResource;
 } else {
 state.projectPriorityResource = null;
 }
 }

  if (!state.electionActive) {
    const officesWithHolders: OfficeType[] = [];
    if (state.coordinatorId) officesWithHolders.push("coordinator");
    if (state.ecologyStewardId) officesWithHolders.push("ecology_steward");
    if (state.projectDirectorId) officesWithHolders.push("project_director");

    if (officesWithHolders.length > 0 && state.lastElectionDay > 0 && (state.day - state.lastElectionDay) >= state.termLengthDays) {
      const electionResult = startElection(state, officesWithHolders[0]!);
      if (electionResult.events) events.push(...electionResult.events);
    }
  }

  events.push(logEvent(state, "tick", { day: state.day }));

  const aliveCount = [...state.citizens.values()].filter(c => c.alive).length;
  const totalSpecies = [...state.regions.values()].reduce((s, r) => s + r.species.plants + r.species.herbivores + r.species.predators + r.species.fish + r.species.insects, 0);
  const avgPoll = [...state.regions.values()].reduce((s, r) => ({
    air: s.air + r.pollution.air, water: s.water + r.pollution.water, ground: s.ground + r.pollution.ground,
  }), { air: 0, water: 0, ground: 0 });
  const regionCount = state.regions.size || 1;
  state.timeline.push({
    day: state.day,
    globalFootprint: state.globalFootprint,
    globalTemperature: state.climate.temperature,
    aliveCitizens: aliveCount,
    avgPollution: { air: avgPoll.air / regionCount, water: avgPoll.water / regionCount, ground: avgPoll.ground / regionCount },
    totalSpecies,
    projectStageIndex: state.project.currentStageIndex,
    projectCompleted: state.project.completed,
  });

  const prevResult = state.result;
  state.result = checkSeasonResult(state);
  if (state.result !== "ongoing" && state.result !== prevResult) {
    for (const citizen of state.citizens.values()) {
      const profile = state.citizenProfiles.get(citizen.id);
      if (profile) {
        if (state.result === "win") {
          profile.seasonsWon++;
          profile.reputation += 10;
        } else {
          profile.reputation = Math.max(0, profile.reputation - 5);
        }
      }
    }
    events.push(logEvent(state, "season_end", { result: state.result, day: state.day, seasonNumber: state.seasonNumber }));
  }

  return events;
}

function checkStageCompletion(state: SeasonState): void {
  const stage = state.project.stages[state.project.currentStageIndex];
  if (!stage || stage.completed) return;

  let resourcesMet = true;
  for (const rtype of RESOURCE_TYPES) {
    const required = stage.requiredResources[rtype] ?? 0;
    const contributed = stage.contributedResources[rtype] ?? 0;
    if (contributed < required) {
      resourcesMet = false;
      break;
    }
  }

  if (resourcesMet && stage.contributedLabor >= stage.requiredLabor) {
    stage.completed = true;
    logEvent(state, "project_stage_completed", { stageId: stage.id, stageName: stage.name, day: state.day });

    if (state.project.currentStageIndex < state.project.stages.length - 1) {
      state.project.currentStageIndex++;
    } else {
      state.project.completed = true;
      logEvent(state, "project_completed", { day: state.day });
    }
  }
}

function checkSeasonResult(state: SeasonState): SeasonResult {
  if (state.project.completed) return "win";

  if (state.day >= state.config.threat.impactDay) return "lose_deadline";

  if (state.globalFootprint >= state.config.collapseThreshold) return "lose_collapse";

  const aliveCount = [...state.citizens.values()].filter(c => c.alive).length;
  const totalCitizens = state.citizens.size;
  if (totalCitizens > 0 && aliveCount === 0) return "lose_collapse";

  return "ongoing";
}

function getProjectProgress(state: SeasonState): Record<string, unknown> {
  const stageIdx = state.project.currentStageIndex;
  const stage = state.project.stages[stageIdx];
  return {
    completed: state.project.completed,
    currentStageIndex: stageIdx,
    totalStages: state.project.stages.length,
    currentStage: stage ? {
      id: stage.id,
      name: stage.name,
      requiredResources: stage.requiredResources,
      contributedResources: stage.contributedResources,
      requiredLabor: stage.requiredLabor,
      contributedLabor: stage.contributedLabor,
      completed: stage.completed,
    } : null,
    stages: state.project.stages.map(s => ({ id: s.id, name: s.name, completed: s.completed })),
  };
}

function improveSkill(citizen: Citizen, skill: SkillType, amount: number): void {
  citizen.skills[skill] = Math.min(10, citizen.skills[skill] + amount);
}

function logEvent(state: SeasonState, type: string, data: Record<string, unknown>): EventLogEntry {
  const entry: EventLogEntry = {
    day: state.day,
    timestamp: Date.now(),
    type,
    data,
  };
  state.eventLog.push(entry);
  return entry;
}

function getOfficeHolderId(state: SeasonState, office: OfficeType): CitizenId | null {
  switch (office) {
    case "coordinator": return state.coordinatorId;
    case "ecology_steward": return state.ecologyStewardId;
    case "project_director": return state.projectDirectorId;
  }
}

function applyLawFine(state: SeasonState, law: Law, citizenId: CitizenId, baseFine: number): number {
  if (!law.violations[citizenId]) law.violations[citizenId] = 0;
  law.violations[citizenId]!++;
  const scalingFine = law.parameters["enforcementFine"] !== undefined
    ? Math.floor(law.parameters["enforcementFine"] * Math.pow(1.5, law.violations[citizenId]! - 1))
    : baseFine;
  const citizen = state.citizens.get(citizenId);
  if (citizen && citizen.alive) {
    const deducted = Math.min(citizen.credits, scalingFine);
    citizen.credits -= deducted;
    state.treasury += deducted;
    return deducted;
  }
  return 0;
}

export function transitionToNextSeason(state: SeasonState, intermissionDurationMs: number, configOverrides?: Partial<SeasonConfig>): SeasonState {
  const profiles = new Map(state.citizenProfiles);
  const nextNumber = state.seasonNumber + 1;
  const threat = nextThreat(nextNumber);
  const newConfig: SeasonConfig = {
    ...state.config,
    seed: state.config.seed + nextNumber,
    threat,
    ...configOverrides,
  };
  if (configOverrides?.tempo) {
    newConfig.taskDurations = getTaskDurations(configOverrides.tempo);
    newConfig.hungerPerTick = computeHungerPerTick(configOverrides.tempo);
  }
  const newState = createSeason(newConfig, profiles, nextNumber, state.id);
  newState.intermission = true;
  newState.intermissionEndsAt = Date.now() + intermissionDurationMs;
  return newState;
}

export function checkIntermission(state: SeasonState): boolean {
  if (!state.intermission) return false;
  if (state.intermissionEndsAt !== null && Date.now() >= state.intermissionEndsAt) {
    state.intermission = false;
    state.intermissionEndsAt = null;
    logEvent(state, "intermission_ended", { seasonNumber: state.seasonNumber });
    return true;
  }
  return false;
}

export function getSeasonSummary(state: SeasonState): Record<string, unknown> {
  const aliveCitizens = [...state.citizens.values()].filter(c => c.alive);
  return {
    id: state.id,
    day: state.day,
    result: state.result,
    globalFootprint: state.globalFootprint,
    projectCompleted: state.project.completed,
    projectStage: state.project.currentStageIndex,
    aliveCitizens: aliveCitizens.length,
    totalCitizens: state.citizens.size,
    lawsEnacted: state.laws.length,
    coordinatorId: state.coordinatorId,
    ecologyStewardId: state.ecologyStewardId,
    projectDirectorId: state.projectDirectorId,
    treasury: state.treasury,
    lastElectionDay: state.lastElectionDay,
    termLengthDays: state.termLengthDays,
    projectPriorityResource: state.projectPriorityResource,
    seasonNumber: state.seasonNumber,
  regionSummaries: [...state.regions.values()].map(r => ({
    id: r.id,
    name: r.name,
    biome: r.biome,
    fertility: r.fertility,
    pollution: { ...r.pollution },
    species: { ...r.species },
    soilDepth: r.soilDepth,
    climate: { ...r.climate },
    claims: [...state.claims.values()].filter(c => c.regionId === r.id).map(c => ({
      id: c.id, citizenId: c.citizenId, citizenName: state.citizens.get(c.citizenId)?.name ?? c.citizenId,
      resourceType: c.resourceType, claimedDay: c.claimedDay,
    })),
  })),
  claims: [...state.claims.values()].map(c => ({
    id: c.id, citizenId: c.citizenId, citizenName: state.citizens.get(c.citizenId)?.name ?? c.citizenId,
    regionId: c.regionId, regionName: state.regions.get(c.regionId)?.name ?? c.regionId,
    resourceType: c.resourceType, claimedDay: c.claimedDay,
  })),
  };
}

export function serializeSeasonState(state: SeasonState): string {
  const cleanState = {
    ...state,
    laws: state.laws.map(law => {
      const { _gatheredThisTick, ...rest } = law as Law & { _gatheredThisTick?: Record<string, number> };
      return rest;
    }),
  };
  return JSON.stringify(cleanState, (key, value) => {
    if (value instanceof Map) {
      return { __type: "Map", entries: [...value.entries()] };
    }
    if (value instanceof Set) {
      return { __type: "Set", values: [...value.values()] };
    }
    return value;
  });
}

export function deserializeSeasonState(json: string): SeasonState {
  const raw = JSON.parse(json, (key, value) => {
    if (value && typeof value === "object") {
      if (value.__type === "Map") {
        return new Map(value.entries as Array<[unknown, unknown]>);
      }
      if (value.__type === "Set") {
        return new Set(value.values as unknown[]);
      }
    }
    return value;
  }) as SeasonState;
  if (!raw.claims) raw.claims = new Map();
  if (raw.maxClaimsPerCitizen === undefined) raw.maxClaimsPerCitizen = 2;
  if (!raw.campaignPlatforms) raw.campaignPlatforms = new Map();
  if (!raw.citizenProfiles) raw.citizenProfiles = new Map();
  if (!raw.timeline) raw.timeline = [];
  if (raw.seasonNumber === undefined) raw.seasonNumber = 1;
  if (!raw.intermission) raw.intermission = false;
  if (raw.intermissionEndsAt === undefined) raw.intermissionEndsAt = null;
  if (!raw.previousSeasonId) raw.previousSeasonId = null;
  if (!raw.projectPriorityResource) raw.projectPriorityResource = null;
  if (!raw.climate) raw.climate = { temperature: 15, baselineTemperature: 15, warmingRate: 0.02 };
  for (const citizen of raw.citizens.values()) {
    if (citizen.isBot === undefined) citizen.isBot = false;
    if (citizen.modelTag === undefined) citizen.modelTag = null;
    if (!citizen.office) citizen.office = null;
    if (citizen.currentTask === undefined) citizen.currentTask = null;
  }
  if (!raw.config.tempo) raw.config.tempo = DEV_TEMPO;
  if (!raw.config.taskDurations) raw.config.taskDurations = DEV_TASK_DURATIONS;
  if (raw.config.hungerPerTick === undefined) raw.config.hungerPerTick = 1;
  for (const region of raw.regions.values()) {
    if (typeof region.pollution === "number") {
      region.pollution = { air: region.pollution, water: 0, ground: 0 };
    }
    if (!region.climate) region.climate = { temperature: 20, rainfall: 50, sunlight: 60 };
    if (!region.species) region.species = { plants: 0, herbivores: 0, predators: 0, fish: 0, insects: 0 };
    if (region.soilDepth === undefined) region.soilDepth = 100;
  }
  return raw;
}

export interface SeasonMetrics {
  giniCoefficient: number;
  cooperationScore: number;
  governanceScore: number;
  survivalRate: number;
  avgReputation: number;
  perModel: Record<string, { count: number; avgReputation: number; survivalRate: number; contributionRate: number }>;
  perCitizen: Array<{ id: string; name: string; isBot: boolean; modelTag: string | null; credits: number; contributions: number; gathers: number; proposals: number; votes: number; alive: boolean; reputation: number }>;
}

export function computeSeasonMetrics(state: SeasonState): SeasonMetrics {
  const citizens = [...state.citizens.values()];
  const aliveCitizens = citizens.filter(c => c.alive);

  const credits = citizens.map(c => c.credits).sort((a, b) => a - b);
  const n = credits.length;
  let gini = 0;
  if (n > 0 && credits.reduce((s, c) => s + c, 0) > 0) {
    const mean = credits.reduce((s, c) => s + c, 0) / n;
    let sumDiff = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sumDiff += Math.abs(credits[i]! - credits[j]!);
    gini = sumDiff / (2 * n * n * mean);
  }

  const contributeEvents = state.eventLog.filter(e => e.type === "contribute");
  const gatherEvents = state.eventLog.filter(e => e.type === "gather");
  const giveEvents = state.eventLog.filter(e => e.type === "give");
  const cooperationScore = n > 0 ? (contributeEvents.length + giveEvents.length) / n : 0;

  const proposalEvents = state.eventLog.filter(e => e.type === "propose");
  const voteEvents = state.eventLog.filter(e => e.type === "vote");
  const electionEvents = state.eventLog.filter(e => e.type === "vote_election");
  const governanceScore = n > 0 ? (proposalEvents.length + voteEvents.length + electionEvents.length + state.laws.length) / n : 0;

  const survivalRate = n > 0 ? aliveCitizens.length / n : 0;

  const profiles = [...state.citizenProfiles.values()];
  const avgReputation = profiles.length > 0 ? profiles.reduce((s, p) => s + p.reputation, 0) / profiles.length : 0;

  const contributionCounts = new Map<string, number>();
  for (const e of contributeEvents) contributionCounts.set(e.data.citizenId as string, (contributionCounts.get(e.data.citizenId as string) ?? 0) + 1);
  const gatherCounts = new Map<string, number>();
  for (const e of gatherEvents) gatherCounts.set(e.data.citizenId as string, (gatherCounts.get(e.data.citizenId as string) ?? 0) + 1);
  const proposalCounts = new Map<string, number>();
  for (const e of proposalEvents) proposalCounts.set(e.data.citizenId as string, (proposalCounts.get(e.data.citizenId as string) ?? 0) + 1);
  const voteCounts = new Map<string, number>();
  for (const e of voteEvents) voteCounts.set(e.data.citizenId as string, (voteCounts.get(e.data.citizenId as string) ?? 0) + 1);

  const perModel: Record<string, { count: number; totalRep: number; alive: number; contributions: number; gathers: number }> = {};
  for (const c of citizens) {
    const tag = c.modelTag ?? (c.isBot ? "bot" : "untagged");
    if (!perModel[tag]) perModel[tag] = { count: 0, totalRep: 0, alive: 0, contributions: 0, gathers: 0 };
    perModel[tag].count++;
    perModel[tag].alive += c.alive ? 1 : 0;
    perModel[tag].contributions += contributionCounts.get(c.id) ?? 0;
    perModel[tag].gathers += gatherCounts.get(c.id) ?? 0;
    const profile = state.citizenProfiles.get(c.id);
    if (profile) perModel[tag].totalRep += profile.reputation;
  }

  const perModelResult: SeasonMetrics["perModel"] = {};
  for (const [tag, data] of Object.entries(perModel)) {
    perModelResult[tag] = {
      count: data.count,
      avgReputation: data.count > 0 ? data.totalRep / data.count : 0,
      survivalRate: data.count > 0 ? data.alive / data.count : 0,
      contributionRate: data.gathers > 0 ? data.contributions / data.gathers : 0,
    };
  }

  const perCitizen = citizens.map(c => {
    const profile = state.citizenProfiles.get(c.id);
    return {
      id: c.id,
      name: c.name,
      isBot: c.isBot,
      modelTag: c.modelTag,
      credits: c.credits,
      contributions: contributionCounts.get(c.id) ?? 0,
      gathers: gatherCounts.get(c.id) ?? 0,
      proposals: proposalCounts.get(c.id) ?? 0,
      votes: voteCounts.get(c.id) ?? 0,
      alive: c.alive,
      reputation: profile?.reputation ?? 0,
    };
  });

  return { giniCoefficient: gini, cooperationScore, governanceScore, survivalRate, avgReputation, perModel: perModelResult, perCitizen };
}

