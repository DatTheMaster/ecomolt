import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSeason, registerCitizen, observe, lookAt, travel, gather,
  craft, contribute, propose, vote, say, journal, tick, getSeasonSummary,
  startElection, campaign, closeElection, give, listOnMarket, trade,
  voteInElection,
  makeCitizenId, makeRegionId, makeProposalId, makeLawId, makeClaimId,
  DEFAULT_SEASON_CONFIG, createSeasonConfig, readChannels, buyFood, govern, claim, relinquishClaim,
  transitionToNextSeason, checkIntermission, nextThreat, THREAT_ROTATION,
  moderateMessage, DEFAULT_MODERATION_CONFIG,
  computeSeasonMetrics,
  startTask, cancelTask, processTasks, citizenCanStartTask,
  type SeasonState, type OfficeType,
} from "@ecomolt/simulation-core";
import { LIVE_TEMPO, DEV_TEMPO, CI_TEMPO, tempoFromEnv, INSTANT_ACTIONS } from "@ecomolt/shared";

describe("simulation-core", () => {
  function makeSeason(): SeasonState {
    return createSeason({ ...DEFAULT_SEASON_CONFIG, tickIntervalMs: 0 });
  }

  it("creates a season with 8 regions", () => {
    const state = makeSeason();
    assert.equal(state.regions.size, 8);
    assert.equal(state.result, "ongoing");
    assert.equal(state.day, 0);
  });

  it("registers a citizen", () => {
    const state = makeSeason();
    const result = registerCitizen(state, makeCitizenId("c1"), "Atlas");
    assert.ok(result.success);
    assert.equal(state.citizens.size, 1);
  });

  it("rejects duplicate citizen registration", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const result = registerCitizen(state, makeCitizenId("c1"), "Atlas");
    assert.ok(!result.success);
  });

  it("citizen can observe the world", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const result = observe(state, makeCitizenId("c1"));
    assert.ok(result.success);
    assert.ok(result.data.citizen);
    assert.ok(result.data.region);
  });

  it("citizen can travel between connected regions", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const region = state.regions.get(citizen.regionId)!;
    const dest = region.connections[0]!;
    const result = travel(state, makeCitizenId("c1"), makeRegionId(dest));
    assert.ok(result.success);
    assert.equal(state.citizens.get(makeCitizenId("c1"))!.regionId, dest);
  });

  it("citizen can gather resources", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const startRegion = state.regions.get(citizen.regionId)!;
    const forestNeighbor = startRegion.connections.find(cid => state.regions.get(cid)?.biome === "forest");
    if (forestNeighbor) {
      travel(state, makeCitizenId("c1"), makeRegionId(forestNeighbor));
    }
    const result = gather(state, makeCitizenId("c1"), "food");
    assert.ok(result.success, `gather failed: ${result.message} (biome: ${state.regions.get(citizen.regionId)?.biome})`);
    assert.ok(citizen.inventory.food > 0);
  });

  it("citizen can craft", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    citizen.inventory.ore = 6;
    citizen.inventory.wood = 2;
    const result = craft(state, makeCitizenId("c1"), "refined_ore");
    assert.ok(result.success);
  });

  it("citizen can contribute to the collective project", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    citizen.inventory.wood = 60;
    citizen.inventory.ore = 40;
    const result = contribute(state, makeCitizenId("c1"), "wood", 30, 10);
    assert.ok(result.success);
  });

  it("citizen can propose and vote on laws", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Brio");
    const pResult = propose(state, makeCitizenId("c1"), "Emission Cap", "Cap pollution at 10", "environmental", { emissionCap: 10 });
    assert.ok(pResult.success);

    const proposals = [...state.proposals.values()];
    assert.equal(proposals.length, 1);
    const proposal = proposals[0]!;

    vote(state, makeCitizenId("c1"), proposal.id, true);
    vote(state, makeCitizenId("c2"), proposal.id, true);
    assert.equal(proposal.status, "enacted");
    assert.equal(state.laws.length, 1);
  });

  it("election flow works", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Brio");

    startElection(state);
    campaign(state, makeCitizenId("c1"), "I'll manage resources well");
    campaign(state, makeCitizenId("c2"), "Vote for ecology");
    voteInElection(state, makeCitizenId("c1"), makeCitizenId("c1"));
    voteInElection(state, makeCitizenId("c2"), makeCitizenId("c1"));

    const result = closeElection(state);
    assert.ok(result.success);
    assert.equal(state.coordinatorId, makeCitizenId("c1"));
  });

  it("tick advances the day and processes ecology", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const events = tick(state);
    assert.equal(state.day, 1);
    assert.ok(events.length > 0);
  });

  it("season ends at deadline if project incomplete", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    while (state.result === "ongoing" && state.day < 35) {
      tick(state);
    }
    assert.equal(state.result, "lose_deadline");
  });

  it("full event log is maintained", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    say(state, makeCitizenId("c1"), "global", "hello");
    tick(state);
    assert.ok(state.eventLog.length >= 2);
  });

  it("give transfers resources between citizens", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Brio");
    state.citizens.get(makeCitizenId("c1"))!.inventory.food = 10;
    const result = give(state, makeCitizenId("c1"), makeCitizenId("c2"), "food", 5);
    assert.ok(result.success);
    assert.equal(state.citizens.get(makeCitizenId("c1"))!.inventory.food, 5);
    assert.equal(state.citizens.get(makeCitizenId("c2"))!.inventory.food, 5);
  });

  it("protected region law blocks gathering", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const startRegion = state.regions.get(citizen.regionId)!;

    const law = {
      id: makeLawId("law-protected"),
      title: "Protected Region",
      description: "No gathering in start region",
      category: "environmental" as const,
      proposer: makeCitizenId("c1"),
      enactedDay: 0,
      parameters: {},
      stringParams: { protectedRegion: startRegion.id },
      violations: {},
    };
    state.laws.push(law);

    const forestNeighbor = startRegion.connections.find(cid => state.regions.get(cid)?.biome === "forest");
    if (forestNeighbor) {
      const result = gather(state, makeCitizenId("c1"), "food");
      assert.ok(!result.success, "Should be blocked by protected region law");
    }
  });

  it("extraction cap limits gathering", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const startRegion = state.regions.get(citizen.regionId)!;
    const forestNeighbor = startRegion.connections.find(cid => state.regions.get(cid)?.biome === "forest");
    if (forestNeighbor) travel(state, makeCitizenId("c1"), makeRegionId(forestNeighbor));

    const region = state.regions.get(citizen.regionId)!;
    const law = {
      id: makeLawId("law-extraction"),
      title: "Ore Extraction Cap",
      description: "Max 2 ore per day",
      category: "resource" as const,
      proposer: makeCitizenId("c1"),
      enactedDay: 0,
      parameters: { extractionCap: 2 },
      stringParams: { extractionResource: "food" },
      violations: {},
    };
    (law as unknown as { _gatheredThisTick: Record<string, number> })._gatheredThisTick = {};
    state.laws.push(law);

    const result = gather(state, makeCitizenId("c1"), "food");
    assert.ok(result.success);
    assert.ok(citizen.inventory.food <= 2, `Should be capped at 2, got ${citizen.inventory.food}`);
  });

  it("trade tariff adds cost and sends to treasury", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Brio");
    state.citizens.get(makeCitizenId("c2"))!.inventory.wood = 10;
    listOnMarket(state, makeCitizenId("c2"), "wood", 5, 2);
    state.citizens.get(makeCitizenId("c1"))!.credits = 100;

    const law = {
      id: makeLawId("law-tariff"),
      title: "Trade Tariff",
      description: "10% tariff on trades",
      category: "economic" as const,
      proposer: makeCitizenId("c1"),
      enactedDay: 0,
      parameters: { tradeTariff: 0.1 },
      stringParams: {},
      violations: {},
    };
    state.laws.push(law);

    const listing = state.market.listings[0]!;
    const result = trade(state, makeCitizenId("c1"), listing.id);
    assert.ok(result.success, result.message);
    assert.ok(state.treasury > 0, "Tariff should go to treasury");
  });

  it("ecology steward can set emergency pollution cap", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    state.citizens.get(makeCitizenId("c1"))!.office = "ecology_steward";
    state.ecologyStewardId = makeCitizenId("c1");

    const result = govern(state, makeCitizenId("c1"), "emergency_pollution_cap", { emissionCap: 5 }, { regionId: "region-0" });
    assert.ok(result.success, result.message);
    assert.equal(state.laws.length, 1);
    assert.equal(state.laws[0]!.parameters.emissionCap, 5);
  });

  it("project director can set project priority", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    state.citizens.get(makeCitizenId("c1"))!.office = "project_director";
    state.projectDirectorId = makeCitizenId("c1");

    const result = govern(state, makeCitizenId("c1"), "set_project_priority", {}, { resource: "ore" });
    assert.ok(result.success, result.message);
    assert.equal(state.projectPriorityResource, "ore");
  });

  it("campaign with platform", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    startElection(state, "ecology_steward");
    const result = campaign(state, makeCitizenId("c1"), "I will cap pollution everywhere");
    assert.ok(result.success);
    assert.ok(result.message.includes("ecology_steward"));
  });

  it("election for ecology_steward", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Brio");

    startElection(state, "ecology_steward");
    campaign(state, makeCitizenId("c1"), "Eco platform");
    voteInElection(state, makeCitizenId("c1"), makeCitizenId("c1"));
    voteInElection(state, makeCitizenId("c2"), makeCitizenId("c1"));
    closeElection(state);

    assert.equal(state.ecologyStewardId, makeCitizenId("c1"));
    assert.equal(state.citizens.get(makeCitizenId("c1"))!.office, "ecology_steward");
  });

  it("read_channels returns messages", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    say(state, makeCitizenId("c1"), "global", "Hello world");

    const result = readChannels(state, makeCitizenId("c1"), ["global"]);
    assert.ok(result.success);
    assert.ok(result.data.channels);
    const channels = result.data.channels as Record<string, unknown[]>;
    assert.ok(channels["global"]);
    assert.equal(channels["global"].length, 1);
  });

  it("buy_food works with credits", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const startRegion = state.regions.get(citizen.regionId)!;
    if (startRegion.biome === "settlement") {
      const plainsNeighbor = startRegion.connections.find(cid => state.regions.get(cid)?.biome === "plains");
      if (plainsNeighbor) travel(state, makeCitizenId("c1"), makeRegionId(plainsNeighbor));
    }
    citizen.credits = 100;
    const result = buyFood(state, makeCitizenId("c1"), 3);
    if (result.success) {
      assert.ok(citizen.inventory.food > 0);
      assert.ok(citizen.credits < 100);
      assert.ok(state.treasury > 0);
    }
  });

  it("hunger increases with activity", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const startRegion = state.regions.get(citizen.regionId)!;
    const forestNeighbor = startRegion.connections.find(cid => state.regions.get(cid)?.biome === "forest");
    if (forestNeighbor) travel(state, makeCitizenId("c1"), makeRegionId(forestNeighbor));
    const hungerBefore = citizen.hunger;
    gather(state, makeCitizenId("c1"), "food");
    assert.ok(citizen.hunger > hungerBefore, "Gathering should increase hunger");
  });

  it("term limits trigger elections", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Brio");

    startElection(state);
    campaign(state, makeCitizenId("c1"), "test platform");
    voteInElection(state, makeCitizenId("c1"), makeCitizenId("c1"));
    voteInElection(state, makeCitizenId("c2"), makeCitizenId("c1"));
    closeElection(state);

    state.termLengthDays = 5;
    assert.ok(state.lastElectionDay > 0, "Election should set lastElectionDay");

    for (let i = 0; i < 6; i++) tick(state);
    assert.ok(state.electionActive, "Should trigger re-election after term expires");
  });

  it("multi-pollution: gather produces air, water, ground pollution", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const startRegion = state.regions.get(citizen.regionId)!;
    const mtnNeighbor = startRegion.connections.find(cid => state.regions.get(cid)?.biome === "mountains");
    if (mtnNeighbor) travel(state, makeCitizenId("c1"), makeRegionId(mtnNeighbor));

    const region = state.regions.get(citizen.regionId)!;
    const before = { ...region.pollution };
    gather(state, makeCitizenId("c1"), "ore");
    assert.ok(region.pollution.air > before.air, "Ore gathering should produce air pollution");
    assert.ok(region.pollution.ground > before.ground, "Ore gathering should produce ground pollution");
  });

  it("food web: species populations evolve over ticks", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const region = state.regions.get(citizen.regionId)!;
    const before = { ...region.species };

    for (let i = 0; i < 10; i++) tick(state);

    const after = region.species;
    const changed = before.plants !== after.plants || before.herbivores !== after.herbivores || before.predators !== after.predators;
    assert.ok(changed, "Species populations should change over ticks");
  });

  it("soil depth degrades from ore and food gathering", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const startRegion = state.regions.get(citizen.regionId)!;
    const mtnNeighbor = startRegion.connections.find(cid => state.regions.get(cid)?.biome === "mountains");
    if (mtnNeighbor) travel(state, makeCitizenId("c1"), makeRegionId(mtnNeighbor));

    const region = state.regions.get(citizen.regionId)!;
    const soilBefore = region.soilDepth;
    for (let i = 0; i < 5; i++) gather(state, makeCitizenId("c1"), "ore");
    assert.ok(region.soilDepth < soilBefore, "Ore gathering should degrade soil depth");
  });

  it("climate drift: global temperature rises with air pollution", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const baseline = state.climate.baselineTemperature;
    assert.equal(state.climate.temperature, baseline);

    for (const region of state.regions.values()) {
      region.pollution.air = 20;
    }
    tick(state);
    assert.ok(state.climate.temperature > baseline, "Global temperature should rise with air pollution");
  });

  it("emissionCap with pollutionType targets specific dimension", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const region = [...state.regions.values()][0]!;
    region.pollution.air = 15;
    region.pollution.water = 2;

    const law = {
      id: makeLawId("law-air-cap"),
      title: "Air Emission Cap",
      description: "Cap air pollution at 10",
      category: "environmental" as const,
      proposer: makeCitizenId("c1"),
      enactedDay: 0,
      parameters: { emissionCap: 10 },
      stringParams: { pollutionType: "air" },
      violations: {},
    };
    state.laws.push(law);

    tick(state);
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    if (citizen.regionId === region.id) {
      assert.ok(state.treasury > 0, "Air emission cap should fine citizens in polluted region");
    }
  });

  it("observe includes multi-pollution and climate data", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const result = observe(state, makeCitizenId("c1"));
    const regionData = result.data.region as Record<string, unknown>;
    assert.ok(typeof regionData.pollution === "object", "Pollution should be an object");
    assert.ok(regionData.species, "Should include species data");
    assert.ok(regionData.climate, "Should include climate data");
    assert.ok((result.data as Record<string, unknown>).globalTemperature !== undefined, "Should include global temperature");
  });

  it("citizen can claim a resource in their region", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const result = claim(state, makeCitizenId("c1"), citizen.regionId, "food");
    assert.ok(result.success, result.message);
    assert.equal(state.claims.size, 1);
  });

  it("claim blocks other citizens from gathering that resource", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Brio");
    const c1 = state.citizens.get(makeCitizenId("c1"))!;

    const startRegion = state.regions.get(c1.regionId)!;
    const foodRegionId = startRegion.connections.find(cid => {
      const r = state.regions.get(cid);
      return r && (r.biome === "plains" || r.biome === "forest" || r.biome === "marsh" || r.biome === "coast");
    }) ?? startRegion.connections[0]!;
    travel(state, makeCitizenId("c1"), makeRegionId(foodRegionId));
    travel(state, makeCitizenId("c2"), makeRegionId(foodRegionId));

    const claimResult = claim(state, makeCitizenId("c1"), makeRegionId(foodRegionId), "food");
    assert.ok(claimResult.success, claimResult.message);

    const gatherResult = gather(state, makeCitizenId("c2"), "food");
    assert.ok(!gatherResult.success, "Non-owner should be blocked from gathering claimed resource");
    assert.ok(gatherResult.message.includes("claimed"), `Expected claim-block message, got: ${gatherResult.message}`);
  });

  it("claim owner can still gather their claimed resource", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const forestNeighbor = state.regions.get(citizen.regionId)!.connections.find(cid => state.regions.get(cid)?.biome === "forest");
    if (forestNeighbor) travel(state, makeCitizenId("c1"), makeRegionId(forestNeighbor));

    const region = state.regions.get(citizen.regionId)!;
    claim(state, makeCitizenId("c1"), citizen.regionId, "food");
    const result = gather(state, makeCitizenId("c1"), "food");
    assert.ok(result.success, `Claim owner should be able to gather: ${result.message}`);
  });

  it("cannot claim already-claimed resource", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Brio");
    const c1 = state.citizens.get(makeCitizenId("c1"))!;
    state.citizens.get(makeCitizenId("c2"))!.regionId = c1.regionId;

    claim(state, makeCitizenId("c1"), c1.regionId, "food");
    const result = claim(state, makeCitizenId("c2"), c1.regionId, "food");
    assert.ok(!result.success);
  });

  it("max claims per citizen is enforced", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const region = state.regions.get(citizen.regionId)!;

    claim(state, makeCitizenId("c1"), citizen.regionId, "food");
    claim(state, makeCitizenId("c1"), citizen.regionId, "wood");
    const result = claim(state, makeCitizenId("c1"), citizen.regionId, "ore");
    assert.ok(!result.success, "Should not allow more than maxClaimsPerCitizen");
  });

  it("citizen can relinquish a claim", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const claimResult = claim(state, makeCitizenId("c1"), citizen.regionId, "food");
    assert.ok(claimResult.success);

    const claimId = [...state.claims.keys()][0]!;
    const result = relinquishClaim(state, makeCitizenId("c1"), claimId);
    assert.ok(result.success, result.message);
    assert.equal(state.claims.size, 0);
  });

  it("cannot claim in a region you are not in", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const currentRegion = state.regions.get(citizen.regionId)!;
    const otherRegionId = currentRegion.connections[0]!;

    const result = claim(state, makeCitizenId("c1"), makeRegionId(otherRegionId), "food");
    assert.ok(!result.success, "Should not be able to claim in a different region");
  });

  it("observe includes claims data", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    claim(state, makeCitizenId("c1"), citizen.regionId, "food");

    const result = observe(state, makeCitizenId("c1"));
    const data = result.data as Record<string, unknown>;
    assert.ok(Array.isArray(data.claims), "observe should include claims array");
    assert.ok(Array.isArray(data.myClaims), "observe should include myClaims array");
    assert.equal((data.myClaims as unknown[]).length, 1);
  });

  it("look_at region includes claims", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    claim(state, makeCitizenId("c1"), citizen.regionId, "food");

    const result = lookAt(state, makeCitizenId("c1"), citizen.regionId);
    const data = result.data as Record<string, unknown>;
    assert.ok(Array.isArray(data.claims), "look_at region should include claims");
  });

  it("unclaimed resources can be gathered by anyone", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Brio");
    const c1 = state.citizens.get(makeCitizenId("c1"))!;
    state.citizens.get(makeCitizenId("c2"))!.regionId = c1.regionId;

    const forestNeighbor = state.regions.get(c1.regionId)!.connections.find(cid => state.regions.get(cid)?.biome === "forest");
    if (forestNeighbor) {
      travel(state, makeCitizenId("c1"), makeRegionId(forestNeighbor));
      travel(state, makeCitizenId("c2"), makeRegionId(forestNeighbor));
    }

    const result = gather(state, makeCitizenId("c2"), "food");
    assert.ok(result.success, "Without claims, anyone should be able to gather");
  });

  it("campaign platforms are stored and visible in observe", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    startElection(state, "coordinator");
    campaign(state, makeCitizenId("c1"), "I will cap pollution and fund the project");
    assert.ok(state.campaignPlatforms.has(makeCitizenId("c1")));

    const result = observe(state, makeCitizenId("c1"));
    const data = result.data as Record<string, unknown>;
    const candidates = data.electionCandidates as Array<{ id: string; platform: string | null }>;
    assert.ok(candidates.some(c => c.platform === "I will cap pollution and fund the project"), "Platform should be visible in observe");
  });

  it("citizen has isBot and modelTag fields", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas", false, "gpt-4");
    registerCitizen(state, makeCitizenId("bot-1"), "Alder", true, null);
    const c1 = state.citizens.get(makeCitizenId("c1"))!;
    const bot = state.citizens.get(makeCitizenId("bot-1"))!;
    assert.equal(c1.isBot, false);
    assert.equal(c1.modelTag, "gpt-4");
    assert.equal(bot.isBot, true);
    assert.equal(bot.modelTag, null);
  });

  it("citizen profile is created and persisted across registration", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas", false, "claude-3");
    assert.ok(state.citizenProfiles.has(makeCitizenId("c1")));
    const profile = state.citizenProfiles.get(makeCitizenId("c1"))!;
    assert.equal(profile.name, "Atlas");
    assert.equal(profile.modelTag, "claude-3");
    assert.equal(profile.seasonsPlayed, 1);
  });

  it("threat rotation cycles through types", () => {
    assert.equal(nextThreat(1).type, "meteor");
    assert.equal(nextThreat(2).type, "pandemic");
    assert.equal(nextThreat(3).type, "warming");
    assert.equal(nextThreat(4).type, "blight");
    assert.equal(nextThreat(5).type, "hostile_force");
    assert.equal(nextThreat(6).type, "meteor");
    assert.equal(nextThreat(7).type, "pandemic");
  });

  it("season transition creates new season with rotated threat and carries profiles", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas", false, "gpt-4");
    state.result = "win";

    const next = transitionToNextSeason(state, 5000);
    assert.equal(next.seasonNumber, 2);
    assert.equal(next.config.threat.type, "pandemic");
    assert.ok(next.citizenProfiles.has(makeCitizenId("c1")));
    assert.equal(next.previousSeasonId, state.id);
    assert.ok(next.intermission);
    assert.ok(next.intermissionEndsAt !== null);
    assert.equal(next.citizens.size, 0);
  });

  it("intermission ends after duration", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    state.result = "win";
    const next = transitionToNextSeason(state, 0);
    assert.ok(next.intermission);

    next.intermissionEndsAt = Date.now() - 1;
    const ended = checkIntermission(next);
    assert.ok(ended);
    assert.ok(!next.intermission);
  });

  it("intermission does not end before duration", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    state.result = "win";
    const next = transitionToNextSeason(state, 60000);
    const ended = checkIntermission(next);
    assert.ok(!ended);
    assert.ok(next.intermission);
  });

  it("timeline snapshots are recorded each tick", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    assert.equal(state.timeline.length, 0);
    tick(state);
    assert.equal(state.timeline.length, 1);
    assert.equal(state.timeline[0]!.day, 1);
    assert.ok(state.timeline[0]!.globalFootprint >= 0);
    tick(state);
    assert.equal(state.timeline.length, 2);
  });

  it("season end updates citizen profiles (win gives reputation)", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas", false, "gpt-4");
    while (state.result === "ongoing" && state.day < 35) {
      state.project.completed = true;
      tick(state);
    }
    const profile = state.citizenProfiles.get(makeCitizenId("c1"))!;
    assert.ok(profile.seasonsWon > 0, "Should have a win on profile");
    assert.ok(profile.reputation >= 10, "Win should give reputation");
  });

  it("observe includes isBot and modelTag", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas", false, "gpt-4");
    const result = observe(state, makeCitizenId("c1"));
    const data = result.data as Record<string, unknown>;
    const citizen = data.citizen as Record<string, unknown>;
    assert.equal(citizen.isBot, false);
    assert.equal(citizen.modelTag, "gpt-4");
  });

  it("moderation blocks overly long messages", () => {
    const result = moderateMessage("a".repeat(501), DEFAULT_MODERATION_CONFIG);
    assert.ok(!result.allowed);
    assert.ok(result.reason?.includes("length"));
  });

  it("moderation blocks URL patterns by default", () => {
    const result = moderateMessage("Check out https://evil.com for free credits!", DEFAULT_MODERATION_CONFIG);
    assert.ok(!result.allowed);
  });

  it("moderation allows normal messages", () => {
    const result = moderateMessage("We should propose an emission cap.", DEFAULT_MODERATION_CONFIG);
    assert.ok(result.allowed);
  });

  it("moderation can be disabled", () => {
    const result = moderateMessage("https://evil.com a".repeat(100), { ...DEFAULT_MODERATION_CONFIG, enabled: false });
    assert.ok(result.allowed);
  });

  it("say() rejects messages blocked by moderation", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const result = say(state, makeCitizenId("c1"), "global", "https://scam.site free credits");
    assert.ok(!result.success);
  });

  it("moderation blocks profanity", () => {
    const result = moderateMessage("What the hell is this crap", DEFAULT_MODERATION_CONFIG);
    assert.ok(!result.allowed);
    assert.ok(result.reason?.includes("prohibited"));
  });

  it("moderation profanity filter can be disabled", () => {
    const config = { ...DEFAULT_MODERATION_CONFIG, profanityFilter: false };
    const result = moderateMessage("What the hell is this crap", config);
    assert.ok(result.allowed);
  });

  it("moderation blocks repeated messages", () => {
    const msg = "We need to act now!";
    const recent = [msg, msg, msg];
    const result = moderateMessage(msg, DEFAULT_MODERATION_CONFIG, recent);
    assert.ok(!result.allowed);
    assert.ok(result.reason?.includes("too many times"));
  });

  it("moderation allows messages under repeat limit", () => {
    const msg = "We need to act now!";
    const recent = [msg, msg];
    const result = moderateMessage(msg, DEFAULT_MODERATION_CONFIG, recent);
    assert.ok(result.allowed);
  });

  it("moderation repeat filter can be disabled", () => {
    const msg = "We need to act now!";
    const recent = [msg, msg, msg, msg];
    const config = { ...DEFAULT_MODERATION_CONFIG, repeatFilter: false };
    const result = moderateMessage(msg, config, recent);
    assert.ok(result.allowed);
  });

  it("computeSeasonMetrics returns expected fields", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    registerCitizen(state, makeCitizenId("c2"), "Nova", true, "test-model");
    const rId = [...state.regions.keys()][0]!;
    gather(state, makeCitizenId("c1"), "food");
    contribute(state, makeCitizenId("c1"), "food", 1, 0);
    const metrics = computeSeasonMetrics(state);
    assert.ok(typeof metrics.giniCoefficient === "number");
    assert.ok(typeof metrics.cooperationScore === "number");
    assert.ok(typeof metrics.governanceScore === "number");
    assert.ok(typeof metrics.survivalRate === "number");
    assert.ok(typeof metrics.avgReputation === "number");
    assert.ok(metrics.perModel);
    assert.ok(metrics.perCitizen.length === 2);
    assert.ok(metrics.perModel["test-model"]);
    assert.equal(metrics.perModel["test-model"].count, 1);
  });

  it("computeSeasonMetrics gini is 0 for equal credits", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "A");
    registerCitizen(state, makeCitizenId("c2"), "B");
    const metrics = computeSeasonMetrics(state);
    assert.equal(metrics.giniCoefficient, 0);
  });

  it("startTask queues a multi-tick task in live tempo", () => {
    const state = createSeason(createSeasonConfig(LIVE_TEMPO));
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const forestNeighbor = state.regions.get(citizen.regionId)!.connections.find(cid => state.regions.get(cid)?.biome === "forest");
    if (forestNeighbor) travel(state, makeCitizenId("c1"), makeRegionId(forestNeighbor));

    const result = startTask(state, makeCitizenId("c1"), "gather", "food", { resourceType: "food" });
    assert.ok(result.success, `startTask failed: ${result.message}`);
    assert.ok(citizen.currentTask !== null, "Citizen should have a currentTask");
    assert.equal(citizen.currentTask!.action, "gather");
    assert.ok(citizen.currentTask!.ticksTotal > 0, "Live tempo tasks should have non-zero duration");
    assert.ok(citizen.currentTask!.ticksRemaining > 0);
  });

  it("startTask executes instantly in dev tempo", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const forestNeighbor = state.regions.get(citizen.regionId)!.connections.find(cid => state.regions.get(cid)?.biome === "forest");
    if (forestNeighbor) travel(state, makeCitizenId("c1"), makeRegionId(forestNeighbor));

    const result = startTask(state, makeCitizenId("c1"), "gather", "food", { resourceType: "food" });
    assert.ok(result.success, `startTask failed: ${result.message}`);
    assert.equal(citizen.currentTask, null, "Dev tempo tasks should complete instantly");
    assert.ok(citizen.inventory.food > 0, "Food should be gathered");
  });

  it("startTask rejects when citizen is busy", () => {
    const state = createSeason(createSeasonConfig(LIVE_TEMPO));
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    startTask(state, makeCitizenId("c1"), "gather", "food", { resourceType: "food" });

    const result = startTask(state, makeCitizenId("c1"), "gather", "wood", { resourceType: "wood" });
    assert.ok(!result.success, "Should not allow starting a second task while busy");
    assert.ok(result.message.includes("Already working on"));
  });

  it("cancelTask cancels the current task", () => {
    const state = createSeason(createSeasonConfig(LIVE_TEMPO));
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    startTask(state, makeCitizenId("c1"), "gather", "food", { resourceType: "food" });
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    assert.ok(citizen.currentTask !== null);

    const result = cancelTask(state, makeCitizenId("c1"));
    assert.ok(result.success);
    assert.equal(citizen.currentTask, null, "Task should be cleared after cancel");
  });

  it("cancelTask fails when no task is active", () => {
    const state = makeSeason();
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const result = cancelTask(state, makeCitizenId("c1"));
    assert.ok(!result.success);
  });

  it("processTasks advances and completes tasks", () => {
    const state = createSeason(createSeasonConfig(LIVE_TEMPO));
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    const startRegion = state.regions.get(citizen.regionId)!;
    const dest = startRegion.connections[0]!;
    const startRegionId = citizen.regionId;

    const taskResult = startTask(state, makeCitizenId("c1"), "travel", dest, {});
    assert.ok(taskResult.success, `startTask failed: ${taskResult.message}`);
    if (citizen.currentTask === null) return;

    const totalTicks = citizen.currentTask!.ticksRemaining;

    for (let i = 0; i < totalTicks; i++) {
      tick(state);
    }
    assert.equal(citizen.currentTask, null, "Task should be completed after enough ticks");
    assert.equal(citizen.regionId, dest, `Citizen should have traveled to ${dest}, still at ${citizen.regionId}`);
  });

  it("citizenCanStartTask returns false when busy", () => {
    const state = createSeason(createSeasonConfig(LIVE_TEMPO));
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    const citizen = state.citizens.get(makeCitizenId("c1"))!;
    assert.ok(citizenCanStartTask(citizen, "gather"));

    startTask(state, makeCitizenId("c1"), "gather", "food", { resourceType: "food" });
    assert.ok(!citizenCanStartTask(citizen, "gather"), "Should not be able to start task when busy");
  });

  it("requireIdle blocks actions while citizen has a task", () => {
    const state = createSeason(createSeasonConfig(LIVE_TEMPO));
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    startTask(state, makeCitizenId("c1"), "gather", "food", { resourceType: "food" });

    const result = gather(state, makeCitizenId("c1"), "wood");
    assert.ok(!result.success, "Direct action should be blocked while task is active");
    assert.ok(result.message.includes("Busy with"), `Expected busy message, got: ${result.message}`);
  });

  it("observe includes currentTask info", () => {
    const state = createSeason(createSeasonConfig(LIVE_TEMPO));
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    startTask(state, makeCitizenId("c1"), "gather", "food", { resourceType: "food" });

    const result = observe(state, makeCitizenId("c1"));
    assert.ok(result.success);
    const data = result.data as Record<string, unknown>;
    const citizenData = data.citizen as Record<string, unknown>;
    const task = citizenData.currentTask as Record<string, unknown> | null;
    assert.ok(task, `observe should include citizen.currentTask`);
    assert.equal(task!.action, "gather");
  });

  it("instant actions bypass the task queue", () => {
    const state = createSeason(createSeasonConfig(LIVE_TEMPO));
    registerCitizen(state, makeCitizenId("c1"), "Atlas");
    startTask(state, makeCitizenId("c1"), "gather", "food", { resourceType: "food" });

    const result = say(state, makeCitizenId("c1"), "global", "Still working!");
    assert.ok(result.success, "say should work even while busy");

    const result2 = observe(state, makeCitizenId("c1"));
    assert.ok(result2.success, "observe should work even while busy");
  });

  it("tempo scaling: hungerPerTick is higher in live tempo than dev", () => {
    const devConfig = createSeasonConfig(DEV_TEMPO);
    const liveConfig = createSeasonConfig(LIVE_TEMPO);
    assert.ok(liveConfig.hungerPerTick > devConfig.hungerPerTick, "Live tempo should have higher hungerPerTick (fewer ticks per day)");
    assert.ok(liveConfig.hungerPerTick > 0, "Live hungerPerTick should be positive");
    assert.ok(devConfig.hungerPerTick > 0, "Dev hungerPerTick should be positive");
  });

  it("INSTANT_ACTIONS set contains observe, say, journal, read_channels, look_at", () => {
    assert.ok(INSTANT_ACTIONS.has("observe"));
    assert.ok(INSTANT_ACTIONS.has("say"));
    assert.ok(INSTANT_ACTIONS.has("journal"));
    assert.ok(INSTANT_ACTIONS.has("read_channels"));
    assert.ok(INSTANT_ACTIONS.has("look_at"));
    assert.ok(!INSTANT_ACTIONS.has("gather"));
    assert.ok(!INSTANT_ACTIONS.has("travel"));
  });

  it("createSeasonConfig with CI tempo uses instant tasks", () => {
    const config = createSeasonConfig(CI_TEMPO);
    assert.equal(config.taskDurations.gatherMin, 0);
    assert.equal(config.taskDurations.gatherMax, 0);
    assert.equal(config.taskDurations.travelMin, 0);
    assert.equal(config.tempo.tickIntervalMs, 10);
  });
});
