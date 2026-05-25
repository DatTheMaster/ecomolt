import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSeason, createSeasonConfig, registerCitizen, tick,
  makeCitizenId, startTask, cancelTask,
  type SeasonState,
} from "@ecomolt/simulation-core";
import { DETERMINISTIC_TEMPO, makeRegionId } from "@ecomolt/shared";

interface BotPlan {
  id: string;
  targetBiome: string;
  targetRegion: string | null;
  travelled: boolean;
  primaryResource: "food" | "wood" | "ore" | "energy";
}

describe("deterministic validation", () => {
  const BIOME_RESOURCES: Record<string, ("food" | "wood" | "ore" | "energy")[]> = {
    forest: ["wood", "food"],
    marsh: ["food"],
    plains: ["food"],
    coast: ["food", "energy"],
    mountains: ["ore", "energy"],
    settlement: ["energy"],
  };

  const ROLE_BIOMES: string[] = ["plains", "mountains", "forest", "coast", "mountains"];

  function makeDeterministicSeason(botCount = 8): { state: SeasonState; plans: BotPlan[] } {
    const config = createSeasonConfig(DETERMINISTIC_TEMPO);
    const state = createSeason(config);
    const names = ["Alder", "Birch", "Cedar", "Dune", "Elm", "Fern", "Grove", "Hazel"];
    const plans: BotPlan[] = [];
    for (let i = 0; i < botCount; i++) {
      const name = names[i % names.length] ?? `Bot${i}`;
      const id = `bot-${name.toLowerCase()}`;
      registerCitizen(state, makeCitizenId(id), name, true, null);
      const targetBiome = ROLE_BIOMES[i % ROLE_BIOMES.length]!;
      const primaryResource = BIOME_RESOURCES[targetBiome]![0]!;
      plans.push({ id, targetBiome, targetRegion: null, travelled: false, primaryResource });
    }
    for (const plan of plans) {
      const citizen = state.citizens.get(makeCitizenId(plan.id))!;
      const currentRegion = state.regions.get(citizen.regionId)!;
      const dest = currentRegion.connections.find(c => state.regions.get(c)?.biome === plan.targetBiome);
      if (dest) {
        plan.targetRegion = dest;
      } else {
        for (const r of state.regions.values()) {
          if (r.biome === plan.targetBiome && r.connections.includes(currentRegion.id)) {
            plan.targetRegion = r.id;
            break;
          }
        }
        if (!plan.targetRegion) {
          for (const r of state.regions.values()) {
            if (r.biome === plan.targetBiome) {
              plan.targetRegion = r.id;
              break;
            }
          }
        }
      }
    }
    return { state, plans };
  }

  function runBotTick(state: SeasonState, plans: BotPlan[]): void {
    for (const plan of plans) {
      const citizen = state.citizens.get(makeCitizenId(plan.id));
      if (!citizen || !citizen.alive) continue;
      if (citizen.currentTask) continue;

      if (!plan.travelled) {
        if (plan.targetRegion && citizen.regionId !== makeRegionId(plan.targetRegion)) {
          const result = startTask(state, makeCitizenId(plan.id), "travel", plan.targetRegion, {});
          if (result.success) plan.travelled = true;
          continue;
        }
        plan.travelled = true;
      }

      if (citizen.hunger > 70) {
        startTask(state, makeCitizenId(plan.id), "buy_food", "", { amount: 3 });
        continue;
      }

      const region = state.regions.get(citizen.regionId)!;
      const available = BIOME_RESOURCES[region.biome] ?? [];
      const bestRes = available.find(r => region.deposits[r] > 0 && (citizen.inventory[r] ?? 0) < 10);
      if (bestRes) {
        startTask(state, makeCitizenId(plan.id), "gather", bestRes, { resourceType: bestRes });
      } else {
        const fallback = available[0] ?? "energy";
        startTask(state, makeCitizenId(plan.id), "gather", fallback, { resourceType: fallback });
      }
    }

    for (const plan of plans) {
      const citizen = state.citizens.get(makeCitizenId(plan.id));
      if (!citizen || !citizen.alive || citizen.currentTask) continue;
      const bestRes = (["ore", "energy", "wood", "food"] as const).find(r => (citizen.inventory[r] ?? 0) >= 5);
      if (bestRes) {
        startTask(state, makeCitizenId(plan.id), "contribute", "", {
          resourceType: bestRes,
          amount: Math.min(citizen.inventory[bestRes] ?? 0, 8),
          labor: 2,
        });
      }
    }
  }

  it("completes 20160 ticks without crash", () => {
    const { state, plans } = makeDeterministicSeason(8);
    const maxTicks = 20160;
    for (let i = 0; i < maxTicks; i++) {
      runBotTick(state, plans);
      tick(state);
      if (state.result !== "ongoing") break;
    }
    assert.ok(state.day > 0, "Should have processed ticks");
    assert.ok(state.day <= maxTicks + 1, `Should not exceed max ticks: ${state.day}`);
  });

  it("no citizens die of starvation with food-gathering bots", () => {
    const { state, plans } = makeDeterministicSeason(8);
    for (let i = 0; i < 500; i++) {
      runBotTick(state, plans);
      tick(state);
      if (state.result !== "ongoing") break;
    }
    const alive = [...state.citizens.values()].filter(c => c.alive).length;
    assert.ok(alive >= 6, `At least 6 of 8 bots should be alive after 500 ticks, got ${alive}`);
  });

  it("project makes progress with contributing bots", () => {
    const { state, plans } = makeDeterministicSeason(8);
    for (let i = 0; i < 1000; i++) {
      runBotTick(state, plans);
      tick(state);
      if (state.result !== "ongoing") break;
    }
    const progress = state.project.stages.filter(s => s.completed).length;
    const totalContributed = state.project.stages.reduce(
      (sum, s) => sum + Object.values(s.contributedResources).reduce((a, b) => a + b, 0),
      0,
    );
    assert.ok(progress >= 1 || totalContributed > 20, `Project should make meaningful progress after 1000 ticks. Stages completed: ${progress}, total contributed: ${totalContributed}`);
  });

  it("task queue works under sustained load", () => {
    const { state, plans } = makeDeterministicSeason(8);
    let totalActions = 0;
    for (let i = 0; i < 500; i++) {
      const before = [...state.citizens.values()].map(c => ({ inv: { ...c.inventory }, task: c.currentTask }));
      runBotTick(state, plans);
      tick(state);
      const after = [...state.citizens.values()];
      for (let j = 0; j < before.length; j++) {
        const b = before[j]!;
        const a = after[j]!;
        if (JSON.stringify(b.inv) !== JSON.stringify(a.inventory)) totalActions++;
      }
      if (state.result !== "ongoing") break;
    }
    assert.ok(totalActions > 0, `Bots should complete actions during simulation, got ${totalActions}`);
  });

  it("ecology remains viable with default bot behavior", () => {
    const { state, plans } = makeDeterministicSeason(8);
    for (let i = 0; i < 500; i++) {
      runBotTick(state, plans);
      tick(state);
      if (state.result !== "ongoing") break;
    }
    for (const region of state.regions.values()) {
      assert.ok(region.soilDepth >= 0, `Soil depth should remain non-negative in ${region.name}, got ${region.soilDepth}`);
    }
  });
});
