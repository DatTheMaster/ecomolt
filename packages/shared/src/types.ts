export type CitizenId = string & { readonly __brand: "CitizenId" };
export type RegionId = string & { readonly __brand: "RegionId" };
export type LawId = string & { readonly __brand: "LawId" };
export type ProposalId = string & { readonly __brand: "ProposalId" };
export type SeasonId = string & { readonly __brand: "SeasonId" };
export type ClaimId = string & { readonly __brand: "ClaimId" };
export type SessionId = string & { readonly __brand: "SessionId" };

export function makeCitizenId(id: string): CitizenId { return id as CitizenId; }
export function makeRegionId(id: string): RegionId { return id as RegionId; }
export function makeLawId(id: string): LawId { return id as LawId; }
export function makeProposalId(id: string): ProposalId { return id as ProposalId; }
export function makeSeasonId(id: string): SeasonId { return id as SeasonId; }
export function makeClaimId(id: string): ClaimId { return id as ClaimId; }
export function makeSessionId(id: string): SessionId { return id as SessionId; }

export interface PropertyClaim {
  id: ClaimId;
  regionId: RegionId;
  citizenId: CitizenId;
  resourceType: ResourceType;
  claimedDay: number;
}

export type ResourceType = "food" | "wood" | "ore" | "energy";
export type SkillType = "farming" | "forestry" | "mining" | "crafting" | "engineering" | "science" | "governance";
export type BiomeType = "forest" | "marsh" | "plains" | "coast" | "mountains" | "settlement";
export type PollutionType = "air" | "water" | "ground";

export const POLLUTION_TYPES: PollutionType[] = ["air", "water", "ground"];

export interface PollutionLevels {
  air: number;
  water: number;
  ground: number;
}

export function emptyPollution(): PollutionLevels {
  return { air: 0, water: 0, ground: 0 };
}

export function totalPollution(p: PollutionLevels): number {
  return p.air + p.water + p.ground;
}
export type ThreatType = "meteor" | "pandemic" | "warming" | "blight" | "hostile_force";

export const RESOURCE_TYPES: ResourceType[] = ["food", "wood", "ore", "energy"];
export const SKILL_TYPES: SkillType[] = ["farming", "forestry", "mining", "crafting", "engineering", "science", "governance"];
export const BIOME_TYPES: BiomeType[] = ["forest", "marsh", "plains", "coast", "mountains", "settlement"];

export interface ResourceStack {
  type: ResourceType;
  quantity: number;
}

export interface Inventory {
  food: number;
  wood: number;
  ore: number;
  energy: number;
}

export function emptyInventory(): Inventory {
  return { food: 0, wood: 0, ore: 0, energy: 0 };
}

export function addToInventory(inv: Inventory, type: ResourceType, amount: number): void {
  inv[type] += amount;
}

export function removeFromInventory(inv: Inventory, type: ResourceType, amount: number): boolean {
  if (inv[type] < amount) return false;
  inv[type] -= amount;
  return true;
}

export function inventoryHas(inv: Inventory, type: ResourceType, amount: number): boolean {
  return inv[type] >= amount;
}

export interface SkillLevels {
  farming: number;
  forestry: number;
  mining: number;
  crafting: number;
  engineering: number;
  science: number;
  governance: number;
}

export type TaskActionType =
  | "travel" | "gather" | "craft" | "contribute"
  | "propose" | "campaign" | "govern" | "buy_food"
  | "claim" | "relinquish_claim"
  | "trade" | "list_on_market" | "give" | "vote";

export const INSTANT_ACTIONS = new Set(["observe", "look_at", "say", "journal", "read_channels"]);

export interface CitizenTask {
  action: TaskActionType;
  target: string;
  params: Record<string, unknown>;
  ticksTotal: number;
  ticksRemaining: number;
  startedDay: number;
}

export type TempoMode = "live" | "dev" | "ci" | "deterministic";

export interface TempoConfig {
  mode: TempoMode;
  tickIntervalMs: number;
  seasonDurationDays: number;
  yearDurationDays: number;
  intermissionDurationMs: number;
}

export const LIVE_TEMPO: TempoConfig = {
  mode: "live",
  tickIntervalMs: 30000,
  seasonDurationDays: 7,
  yearDurationDays: 1,
  intermissionDurationMs: 4 * 3600 * 1000,
};

export const DEV_TEMPO: TempoConfig = {
  mode: "dev",
  tickIntervalMs: 5000,
  seasonDurationDays: 2,  // 60 game-days ≈ 52 min — enough for a test run
  yearDurationDays: 1,
  intermissionDurationMs: 30000,
};

export const CI_TEMPO: TempoConfig = {
  mode: "ci",
  tickIntervalMs: 10,
  seasonDurationDays: 7,
  yearDurationDays: 1,
  intermissionDurationMs: 0,
};

export const DETERMINISTIC_TEMPO: TempoConfig = {
  mode: "deterministic",
  tickIntervalMs: 0,
  seasonDurationDays: 7,
  yearDurationDays: 1,
  intermissionDurationMs: 0,
};

export function tempoFromEnv(env?: string): TempoConfig {
  switch (env ?? process.env.TEMPO ?? "dev") {
    case "live": return LIVE_TEMPO;
    case "ci": return CI_TEMPO;
    case "deterministic": return DETERMINISTIC_TEMPO;
    default: return DEV_TEMPO;
  }
}

export interface TaskDurationSeconds {
  travelMin: number;
  travelMax: number;
  gatherMin: number;
  gatherMax: number;
  craftMin: number;
  craftMax: number;
  contributeMin: number;
  contributeMax: number;
  proposeMin: number;
  proposeMax: number;
  campaignMin: number;
  campaignMax: number;
  governMin: number;
  governMax: number;
  buyFoodMin: number;
  buyFoodMax: number;
  claimMin: number;
  claimMax: number;
  voteMin: number;
  voteMax: number;
  tradeMin: number;
  tradeMax: number;
}

export const LIVE_TASK_DURATIONS: TaskDurationSeconds = {
  travelMin: 300, travelMax: 600,
  gatherMin: 240, gatherMax: 450,
  craftMin: 300, craftMax: 600,
  contributeMin: 150, contributeMax: 240,
  proposeMin: 150, proposeMax: 300,
  campaignMin: 90, campaignMax: 150,
  governMin: 240, governMax: 360,
 buyFoodMin: 0, buyFoodMax: 0,
 claimMin: 60, claimMax: 120,
 voteMin: 30, voteMax: 60,
 tradeMin: 60, tradeMax: 120,
};

export const DEV_TASK_DURATIONS: TaskDurationSeconds = {
  travelMin: 0, travelMax: 0,
  gatherMin: 0, gatherMax: 0,
  craftMin: 0, craftMax: 0,
  contributeMin: 0, contributeMax: 0,
  proposeMin: 0, proposeMax: 0,
  campaignMin: 0, campaignMax: 0,
  governMin: 0, governMax: 0,
  buyFoodMin: 0, buyFoodMax: 0,
  claimMin: 0, claimMax: 0,
  voteMin: 0, voteMax: 0,
  tradeMin: 0, tradeMax: 0,
};

export function secondsToTicks(seconds: number, tickIntervalMs: number): number {
  if (tickIntervalMs <= 0) return 0;
  return Math.ceil(seconds / (tickIntervalMs / 1000));
}

export function randomTicks(minSeconds: number, maxSeconds: number, tickIntervalMs: number): number {
  if (minSeconds <= 0 && maxSeconds <= 0) return 0;
  if (tickIntervalMs <= 0) return 0;
  const seconds = minSeconds + Math.random() * (maxSeconds - minSeconds);
  return Math.max(1, secondsToTicks(seconds, tickIntervalMs));
}

export function ticksToSeconds(ticks: number, tickIntervalMs: number): number {
  return ticks * (tickIntervalMs / 1000);
}
