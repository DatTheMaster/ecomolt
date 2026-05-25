import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseActionResponse, type AgentContext } from "./src/prompt.js";
import { RateLimiter } from "./src/rate-limiter.js";
import { loadConfig, validateConfig } from "./src/config.js";
import { writeFile, mkdir, rm } from "node:fs/promises";

describe("agent-runner", () => {
  describe("parseActionResponse", () => {
    it("parses valid JSON action", () => {
      const result = parseActionResponse('Here is my action:\n{"action": "gather", "params": {"resourceType": "food"}}');
      assert.deepEqual(result, { action: "gather", params: { resourceType: "food" } });
    });

    it("parses action with no params", () => {
      const result = parseActionResponse('{"action": "observe", "params": {}}');
      assert.deepEqual(result, { action: "observe", params: {} });
    });

    it("parses action without params field", () => {
      const result = parseActionResponse('{"action": "wait"}');
      assert.deepEqual(result, { action: "wait", params: {} });
    });

    it("returns null for no JSON", () => {
      const result = parseActionResponse("I think we should gather food.");
      assert.equal(result, null);
    });

    it("returns null for JSON without action field", () => {
      const result = parseActionResponse('{"resourceType": "food"}');
      assert.equal(result, null);
    });

    it("parses JSON embedded in markdown", () => {
      const result = parseActionResponse('```json\n{"action": "travel", "params": {"destination": "region-2"}}\n```');
      assert.deepEqual(result, { action: "travel", params: { destination: "region-2" } });
    });
  });

  describe("buildPrompt", () => {
    const baseContext: AgentContext = {
      citizenId: "test-agent",
      name: "TestAgent",
      strategy: "Gather resources and survive.",
      observeOutput: { day: 5, citizen: { hunger: 20, health: 100 } },
      chatHistory: [],
      currentTask: null,
      recentEvents: [],
      tickCount: 10,
      llmFailures: 0,
    };

    it("returns system and user messages", () => {
      const messages = buildPrompt(baseContext);
      assert.equal(messages.length, 2);
      assert.equal(messages[0]!.role, "system");
      assert.equal(messages[1]!.role, "user");
    });

    it("includes strategy in user message", () => {
      const messages = buildPrompt(baseContext);
      const userContent = messages[1]!.content;
      assert.ok(userContent.includes("Gather resources and survive."));
    });

    it("includes current task info when busy", () => {
      const ctx: AgentContext = {
        ...baseContext,
        currentTask: {
          action: "gather",
          target: "food",
          ticksRemaining: 5,
          ticksTotal: 10,
          progress: 0.5,
          etaSeconds: 150,
        },
      };
      const messages = buildPrompt(ctx);
      const userContent = messages[1]!.content;
      assert.ok(userContent.includes("Current Task"));
      assert.ok(userContent.includes("BUSY"));
    });

    it("includes chat history when present", () => {
      const ctx: AgentContext = {
        ...baseContext,
        chatHistory: [
          { channel: "global", from: "other", message: "hello" },
        ],
      };
      const messages = buildPrompt(ctx);
      const userContent = messages[1]!.content;
      assert.ok(userContent.includes("Recent Chat"));
      assert.ok(userContent.includes("hello"));
    });

    it("warns about LLM failures", () => {
      const ctx: AgentContext = {
        ...baseContext,
        llmFailures: 5,
      };
      const messages = buildPrompt(ctx);
      const userContent = messages[1]!.content;
      assert.ok(userContent.includes("5 consecutive ticks"));
    });
  });

  describe("RateLimiter", () => {
    it("allows requests within rate", async () => {
      const limiter = new RateLimiter({ rpm: 60 });
      await limiter.waitForToken();
    });

    it("tracks rate limit state", () => {
      const limiter = new RateLimiter({ rpm: 60 });
      const result = limiter.tryConsume();
      assert.equal(result.allowed, true);
    });
  });

  describe("config", () => {
    const tmpDir = "/tmp/ecomolt-agent-test-" + process.pid;

    it("loads array config with defaults", async () => {
      await mkdir(tmpDir, { recursive: true });
      const configPath = tmpDir + "/agents.json";
      await writeFile(configPath, JSON.stringify([
        {
          name: "Test",
          citizenId: "test",
          model: "test-model",
          apiBase: "https://api.test.com/v1",
          apiKey: "test-key",
          strategy: "test strategy",
        },
      ]));
      const config = await loadConfig(configPath);
      assert.equal(config.agents.length, 1);
      assert.equal(config.apiUrl, "http://localhost:3000");
      assert.equal(config.rpm, 40);
      assert.equal(config.tickIntervalMs, 5000);
      await rm(tmpDir, { recursive: true });
    });

    it("loads object config with overrides", async () => {
      await mkdir(tmpDir, { recursive: true });
      const configPath = tmpDir + "/agents.json";
      await writeFile(configPath, JSON.stringify({
        apiUrl: "http://test:4000",
        rpm: 20,
        tickIntervalMs: 1000,
        agents: [
          {
            name: "Test",
            citizenId: "test",
            model: "test-model",
            apiBase: "https://api.test.com/v1",
            apiKey: "test-key",
            strategy: "test strategy",
          },
        ],
      }));
      const config = await loadConfig(configPath);
      assert.equal(config.apiUrl, "http://test:4000");
      assert.equal(config.rpm, 20);
      assert.equal(config.tickIntervalMs, 1000);
      await rm(tmpDir, { recursive: true });
    });

    it("validates missing required fields", () => {
      const errors = validateConfig({
        agents: [{ name: "", citizenId: "", model: "", apiBase: "", apiKey: "", strategy: "" }],
        apiUrl: "http://localhost:3000",
        rpm: 40,
        tickIntervalMs: 5000,
      });
      assert.ok(errors.length > 0, "Should have validation errors for missing fields");
    });

    it("validates duplicate citizenIds", () => {
      const errors = validateConfig({
        agents: [
          { name: "A", citizenId: "dup", model: "m", apiBase: "b", apiKey: "k", strategy: "s" },
          { name: "B", citizenId: "dup", model: "m", apiBase: "b", apiKey: "k", strategy: "s" },
        ],
        apiUrl: "http://localhost:3000",
        rpm: 40,
        tickIntervalMs: 5000,
      });
      assert.ok(errors.some(e => e.includes("Duplicate")), "Should detect duplicate citizenId");
    });

    it("validates empty agents list", () => {
      const errors = validateConfig({
        agents: [],
        apiUrl: "http://localhost:3000",
        rpm: 40,
        tickIntervalMs: 5000,
      });
      assert.ok(errors.some(e => e.includes("No agents")), "Should detect empty agents list");
    });
  });
});
