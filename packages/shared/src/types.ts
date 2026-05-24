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
