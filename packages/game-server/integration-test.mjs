import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { GameServer } from "./dist/index.js";
import { DEV_TEMPO } from "@ecomolt/shared";
import { createSeasonConfig } from "@ecomolt/simulation-core";

const BASE = "http://localhost:3999";
const PERSIST_DIR = "/tmp/ecomolt-int-test-" + process.pid;

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

describe("integration: game server HTTP API", () => {
  let server;

  before(async () => {
    if (existsSync(PERSIST_DIR)) rmSync(PERSIST_DIR, { recursive: true });
    mkdirSync(PERSIST_DIR, { recursive: true });
    const seasonConfig = createSeasonConfig(DEV_TEMPO);
    server = new GameServer({
      port: 3999,
      tempo: DEV_TEMPO,
      tickIntervalMs: 100,
      seasonConfig,
      seedBots: false,
      persistOnTick: false,
      persistence: {
        dbPath: `${PERSIST_DIR}/ecomolt.db`,
        archiveDir: `${PERSIST_DIR}/archives`,
      },
    });
    await server.start();
    await new Promise(r => setTimeout(r, 300));
  });

  after(async () => {
    await server.stop();
    if (existsSync(PERSIST_DIR)) rmSync(PERSIST_DIR, { recursive: true });
  });

  it("GET /api/state returns season state", async () => {
    const state = await get("/api/state");
    assert.ok(state.result !== undefined, "State should have result field");
    assert.ok(typeof state.day === "number", "State should have day");
  });

  it("POST /api/register creates a citizen", async () => {
    const res = await post("/api/register", { citizenId: "test-agent-1", name: "TestAgent1" });
    assert.equal(res.success, true, `Registration should succeed: ${res.message}`);
  });

  it("POST /api/action observe works", async () => {
    const res = await post("/api/action", { citizenId: "test-agent-1", action: "observe" });
    assert.equal(res.success, true, `Observe should succeed: ${res.message}`);
  });

  it("POST /api/action say works (instant)", async () => {
    const res = await post("/api/action", { citizenId: "test-agent-1", action: "say", message: "hello world" });
    assert.equal(res.success, true, `Say should succeed: ${res.message}`);
  });

  it("POST /api/action journal works (instant)", async () => {
    const res = await post("/api/action", { citizenId: "test-agent-1", action: "journal", message: "day 1 notes" });
    assert.equal(res.success, true, `Journal should succeed: ${res.message}`);
  });

  it("POST /api/action gather returns task info in dev tempo", async () => {
    await post("/api/register", { citizenId: "test-gatherer", name: "Gatherer" });
    const regions = await get("/api/regions");
    const resourceMap = { forest: "wood", marsh: "food", plains: "food", coast: "food", mountains: "ore", settlement: "energy" };

    let citizenDetail = await get("/api/citizens/test-gatherer");
    let currentRegionId = String(citizenDetail.regionId ?? "");
    let currentRegion = regions.find(r => r.id === currentRegionId);
    let biome = String(currentRegion?.biome ?? "settlement");

    if (biome === "settlement") {
      const connections = currentRegion?.connections ?? [];
      const destId = connections[0] ?? "";
      if (destId) {
        await post("/api/action", { citizenId: "test-gatherer", action: "travel", target: destId });
        citizenDetail = await get("/api/citizens/test-gatherer");
        currentRegionId = String(citizenDetail.regionId ?? "");
        currentRegion = regions.find(r => r.id === currentRegionId);
        biome = String(currentRegion?.biome ?? "settlement");
      }
    }

    const resource = resourceMap[biome] ?? "energy";
    const res = await post("/api/action", { citizenId: "test-gatherer", action: "gather", target: resource, resourceType: resource });
    assert.equal(res.success, true, `Gather should succeed in ${biome}: ${res.message}`);
  });

  it("GET /api/citizens/:id includes currentTask", async () => {
    const res = await get("/api/citizens/test-agent-1");
    assert.ok(res.currentTask !== undefined, "Citizen detail should include currentTask field");
  });

  it("GET /api/citizens lists registered citizens", async () => {
    const res = await get("/api/citizens");
    const citizens = res.citizens ?? [];
    assert.ok(citizens.length >= 2, `Should have at least 2 registered citizens, got ${citizens.length}`);
  });

  it("GET /api/project returns project stages", async () => {
    const res = await get("/api/project");
    assert.ok(res.stages !== undefined, "Project should have stages");
  });

  it("GET /api/regions returns region list", async () => {
    const res = await get("/api/regions");
    assert.ok(Array.isArray(res), "Regions should be an array");
    assert.ok(res.length >= 8, `Should have at least 8 regions, got ${res.length}`);
  });

  it("GET /api/events returns event log", async () => {
    const res = await get("/api/events?since=0");
    assert.ok(res !== null, "Events should be returned");
  });

  it("cancel_task action works via API", async () => {
    await post("/api/register", { citizenId: "test-canceler", name: "Canceler" });
    const regions = await get("/api/regions");
    const citizen = await get("/api/citizens/test-canceler");
    const regionId = String(citizen.regionId ?? "");
    const region = regions.find(r => r.id === regionId);
    const connections = region?.connections ?? [];
    if (connections.length > 0) {
      const travelRes = await post("/api/action", { citizenId: "test-canceler", action: "travel", target: connections[0] });
      if (travelRes.success && travelRes.task) {
        const cancelRes = await post("/api/action", { citizenId: "test-canceler", action: "cancel_task" });
        assert.equal(cancelRes.success, true, `Cancel should succeed: ${cancelRes.message}`);
      }
    }
  });

  it("multiple actions in sequence work", async () => {
    await post("/api/register", { citizenId: "test-seq", name: "SeqAgent" });
    const obs = await post("/api/action", { citizenId: "test-seq", action: "observe" });
    assert.equal(obs.success, true);
    const say = await post("/api/action", { citizenId: "test-seq", action: "say", message: "testing" });
    assert.equal(say.success, true);
    const j = await post("/api/action", { citizenId: "test-seq", action: "journal", message: "entry" });
    assert.equal(j.success, true);
  });
});
