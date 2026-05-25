import { GameApiClient, type ActionResult } from "./api-client.js";
import { NimClient } from "./nim-client.js";
import { RateLimiter, safeSleep } from "./rate-limiter.js";
import { buildPrompt, parseActionResponse, type AgentContext } from "./prompt.js";

export type AgentState = "idle" | "observing" | "thinking" | "acting" | "working" | "fallback";

export interface AgentConfig {
  name: string;
  citizenId: string;
  model: string;
  apiBase: string;
  apiKey: string;
  strategy: string;
  maxTokens?: number;
  temperature?: number;
  rpm?: number;  // per-agent rate limit override
}

export interface AgentStats {
  actionsTaken: number;
  tasksCompleted: number;
  llmCalls: number;
  llmFailures: number;
  fallbackActions: number;
  ticksAlive: number;
}

export class Agent {
  private config: AgentConfig;
  private api: GameApiClient;
  private nim: NimClient;
  private state: AgentState = "idle";
  private stats: AgentStats = {
    actionsTaken: 0,
    tasksCompleted: 0,
    llmCalls: 0,
    llmFailures: 0,
    fallbackActions: 0,
    ticksAlive: 0,
  };
  private lastObserveOutput: Record<string, unknown> = {};
  private chatHistory: Array<{ channel: string; from: string; message: string }> = [];
  private recentEvents: Array<{ day: number; type: string; data: Record<string, unknown> }> = [];
 private currentTask: AgentContext["currentTask"] = null;
 private llmConsecutiveFailures = 0;
 private maxLlmFailures: number;
 private tickIntervalMs: number;
 private registered = false;
 private abortController = new AbortController();
 private lastSurvivalBuyTick = -10; // cooldown: don't buy food more than once per 10 ticks

  constructor(config: AgentConfig, api: GameApiClient, rateLimiter: RateLimiter, tickIntervalMs: number) {
    this.config = config;
    this.api = api;
    this.nim = new NimClient({
      apiBase: config.apiBase,
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens ?? 512,
      temperature: config.temperature ?? 0.7,
    }, rateLimiter);
    this.maxLlmFailures = 3;
    this.tickIntervalMs = tickIntervalMs;
  }

  get citizenId(): string {
    return this.config.citizenId;
  }

  get agentState(): AgentState {
    return this.state;
  }

  get agentStats(): Readonly<AgentStats> {
    return this.stats;
  }

  stop(): void {
    this.abortController.abort();
  }

  async run(): Promise<void> {
    console.log(`[agent:${this.config.name}] Starting agent loop (tick interval: ${this.tickIntervalMs}ms)`);

    try {
      while (!this.abortController.signal.aborted) {
    await this.tick();
    await safeSleep(this.tickIntervalMs, this.abortController.signal);
      }
    } catch (err) {
      if ((err as Error).message === "Aborted") {
        console.log(`[agent:${this.config.name}] Stopped`);
      } else {
        console.error(`[agent:${this.config.name}] Fatal error:`, err);
      }
    }
  }

  private async tick(): Promise<void> {
    this.stats.ticksAlive++;

    if (!this.registered) {
      await this.register();
      return;
    }

  const citizenData = await this.api.getCitizen(this.config.citizenId) as Record<string, unknown> | null;
  if (!citizenData) {
    // Citizen doesn't exist yet this season — re-register
    console.log(`[agent:${this.config.name}] Citizen not found, re-registering...`);
    this.registered = false;
    await this.register();
    return;
  }
  const alive = citizenData.alive as boolean | undefined;
  if (alive === false) {
    // Could be dead, or season cycled. Check current season state.
    const stateResult = await this.api.getState();
    const seasonNumber = stateResult.seasonNumber as number | undefined;
    // If we had a previous season tracking, compare. For now, always try re-register.
    // If re-register fails with "already registered" or similar, they're truly dead.
    console.log(`[agent:${this.config.name}] Citizen alive=false (season #${seasonNumber}), attempting re-register...`);
    this.registered = false;
    await this.register();
    return;
  }

 // SURVIVAL CHECK: If hunger is critical, buy food immediately — no LLM needed
 const hunger = citizenData.hunger as number ?? 0;
 const health = citizenData.health as number ?? 100;
 const credits = citizenData.credits as number ?? 0;
 const inventory = citizenData.inventory as Record<string, number> ?? {};
 const foodOnHand = inventory.food ?? 0;
 const foodPrice = 3; // base price per unit (scarcity may increase it, but this is a safe floor)
 const ticksSinceLastBuy = this.stats.ticksAlive - this.lastSurvivalBuyTick;
 const currentRegion = citizenData.regionId as string ?? "region-5";
 // Use FRESH currentTask from server, not stale this.currentTask
 const freshTask = citizenData.currentTask as AgentContext["currentTask"];
 const isBusy = freshTask !== null && freshTask !== undefined;
 // Survival food purchase — but DON'T let it starve the LLM of turns
 // Only buy food on survival if: (1) cooldown passed, or (2) truly critical (hunger > 90)
 // If the agent is busy with a task, only interrupt for truly critical hunger (>90)
 if (foodOnHand >= 3 && hunger < 80) {
  // Skip survival action, let auto-eat handle it
 } else if (hunger > 80 && credits >= foodPrice && isBusy && (ticksSinceLastBuy >= 5)) {
 // Busy and in health-damage territory (hunger >= 80 = -5 hp/tick)
 // Buy food but don't interrupt — let the task continue
 // Cooldown 5 ticks to prevent buying every single tick
 const maxAffordable = Math.floor(credits / foodPrice);
 const foodNeeded = Math.ceil((hunger - 30) / 5) + 2; // target hunger ~30 with buffer
  const amount = Math.min(maxAffordable, foodNeeded);
  if (amount > 0) {
   console.log(`[agent:${this.config.name}] EMERGENCY: buying ${amount} food while busy (hunger=${hunger.toFixed(0)})`);
   await this.api.action(this.config.citizenId, "buy_food", { amount });
   this.stats.fallbackActions++;
   this.lastSurvivalBuyTick = this.stats.ticksAlive;
   // Don't return — let the agent continue with its current task
  }
 } else if (hunger > 70 && credits >= foodPrice && !isBusy && (ticksSinceLastBuy >= 10)) {
  const maxAffordable = Math.floor(credits / foodPrice);
  // Buy enough to get hunger below 20 and have a buffer (each food = -5 hunger, auto-eats 2/tick)
  const foodNeeded = Math.ceil((hunger - 10) / 5) + 2; // extra buffer
  const amount = Math.min(maxAffordable, foodNeeded);
  if (amount > 0) {
   console.log(`[agent:${this.config.name}] SURVIVAL: buying ${amount} food (hunger=${hunger.toFixed(0)}, credits=${credits}, foodOnHand=${foodOnHand})`);
   const buyResult = await this.api.action(this.config.citizenId, "buy_food", { amount });
   this.stats.fallbackActions++;
   this.lastSurvivalBuyTick = this.stats.ticksAlive;
   // If buy failed (no food in region), try gathering instead
   if (!buyResult.success) {
    console.log(`[agent:${this.config.name}] SURVIVAL: buy failed, gathering food instead`);
    await this.api.action(this.config.citizenId, "gather", { resourceType: "food" });
   }
   return;
  }
 }
 // If hungry but can't afford food, gather food from current region
 if (hunger > 30 && credits < foodPrice) {
  console.log(`[agent:${this.config.name}] SURVIVAL: gathering food (hunger=${hunger.toFixed(0)}, credits=${credits})`);
  await this.api.action(this.config.citizenId, "gather", { resourceType: "food" });
  this.stats.fallbackActions++;
    return;
  }

    const task = citizenData.currentTask as AgentContext["currentTask"];
    this.currentTask = task;

    if (task) {
      this.state = "working";
      return;
    }

    this.state = "observing";
    const observeResult = await this.api.action(this.config.citizenId, "observe");
    if (observeResult.success && observeResult.data) {
      this.lastObserveOutput = observeResult.data;
    }

    const readResult = await this.api.action(this.config.citizenId, "read_channels", { channels: ["global"], limit: 10 });
    if (readResult.success && readResult.data) {
      const channels = (readResult.data as Record<string, unknown>).channels as Record<string, Array<{ from: string; message: string }>> | undefined;
      if (channels) {
        const newMessages: Array<{ channel: string; from: string; message: string }> = [];
        for (const [channel, msgs] of Object.entries(channels)) {
          for (const msg of msgs) {
            newMessages.push({ channel, from: msg.from, message: msg.message });
          }
        }
        this.chatHistory = [...this.chatHistory, ...newMessages].slice(-50);
      }
    }

    if (this.llmConsecutiveFailures >= this.maxLlmFailures) {
      this.state = "fallback";
      await this.executeFallback();
      return;
    }

    this.state = "thinking";
    try {
      const context: AgentContext = {
        citizenId: this.config.citizenId,
        name: this.config.name,
        strategy: this.config.strategy,
        observeOutput: this.lastObserveOutput,
        chatHistory: this.chatHistory,
        currentTask: this.currentTask,
        recentEvents: this.recentEvents,
        tickCount: this.stats.ticksAlive,
        llmFailures: this.llmConsecutiveFailures,
      };

      const messages = buildPrompt(context);
      const response = await this.nim.chat(messages, this.abortController.signal);
      this.stats.llmCalls++;
      this.llmConsecutiveFailures = 0;

      const parsed = parseActionResponse(response.content);
      if (!parsed) {
        console.warn(`[agent:${this.config.name}] Could not parse action from LLM response: ${response.content.slice(0, 200)}`);
        this.llmConsecutiveFailures++;
        return;
      }

 this.state = "acting";
 if (parsed.action === "wait") return;

 // PRODUCTIVITY CHECK: If the LLM chose travel/buy_food but we're in a good region,
 // override to gather the priority resource instead (agents get stuck in travel loops)
 // Also: if the agent has 3+ of a resource the project needs, contribute it first
 const citizen = this.lastObserveOutput.citizen as Record<string, unknown> | undefined;
 const inventory = (citizen?.inventory as Record<string, number>) ?? {};
 const project = this.lastObserveOutput.projectProgress as Record<string, unknown> | undefined;
 const currentStage = project?.currentStage as Record<string, unknown> | undefined;
 const required = currentStage?.requiredResources as Record<string, number> | undefined;
 const contributed = currentStage?.contributedResources as Record<string, number> | undefined;

 // Contribute resources if we have 3+ that the project needs
 if (required && !this.currentTask) {
  for (const [resource, needed] of Object.entries(required)) {
   const have = inventory[resource] ?? 0;
   const alreadyGiven = contributed?.[resource] ?? 0;
   if (have >= 3 && needed > alreadyGiven) {
    const amount = Math.min(have, needed - alreadyGiven);
    console.log(`[agent:${this.config.name}] PRODUCTIVITY: contributing ${amount} ${resource} to project (have ${have})`);
    await this.executeAction("contribute", { resourceType: resource, amount, labor: 1 });
    return;
   }
  }
 }

 if ((parsed.action === "travel" || parsed.action === "buy_food") && !this.currentTask) {
 const priorityResource = (this.lastObserveOutput.projectPriorityResource as string) ?? "wood";
 const region = this.lastObserveOutput.region as Record<string, unknown> | undefined;
 const biome = region?.biome as string ?? "";
 const connections = region?.connections as Array<Record<string, string>> ?? [];
 // Check if current biome has the priority resource
 const biomeResources: Record<string, string[]> = {
 forest: ["wood", "food"],
 coast: ["food", "energy"],
 mountains: ["ore", "energy"],
 plains: ["food"],
 marsh: ["food"],
 settlement: ["energy"],
 };
 const available = biomeResources[biome] ?? [];
 // Determine what the project MOST needs right now (not just the global priority)
 let bestResource = priorityResource;
 if (required && contributed) {
 // Find the resource in current biome that has the lowest fill percentage
 let lowestPct = 1.0;
 for (const res of available) {
 const needed = required[res] ?? 0;
 if (needed > 0) {
 const given = contributed[res] ?? 0;
 const pct = given / needed;
 if (pct < lowestPct) {
 lowestPct = pct;
 bestResource = res;
 }
 }
 }
 // If priority resource is >80% full and there's a biome resource <50%, prefer the lower one
 const priorityPct = (required[priorityResource] ?? 0) > 0
 ? (((contributed ?? {})[priorityResource] ?? 0) / (required[priorityResource] ?? 1))
 : 1.0;
 if (priorityPct > 0.8 && lowestPct < 0.5) {
 bestResource = available.find(r => {
 const n = required[r] ?? 0;
 return n > 0 && (contributed[r] ?? 0) / n < 0.5;
 }) ?? priorityResource;
 }
 }
 if (available.includes(bestResource)) {
 console.log(`[agent:${this.config.name}] PRODUCTIVITY: overriding ${parsed.action} → gather ${bestResource} (biome=${biome} has it, priority=${priorityResource})`);
 await this.executeAction("gather", { resourceType: bestResource });
 return;
 } else if (parsed.action === "buy_food" && !available.includes(priorityResource)) {
 // Agent is in a biome that DOESN'T have the priority resource and is wasting credits on food
 // First: check if current biome has ANY resource the project still needs
 if (required) {
 const neededHere = available.find(r => (required[r] ?? 0) > ((contributed?.[r] ?? 0)));
 if (neededHere) {
 console.log(`[agent:${this.config.name}] PRODUCTIVITY: overriding buy_food → gather ${neededHere} (biome=${biome} has it, project needs it)`);
 await this.executeAction("gather", { resourceType: neededHere });
 return;
 }
 }
 // Second: no useful resources here, redirect to travel to a biome that has the priority resource
 const targetBiomes: Record<string, string[]> = {
    wood: ["forest"],
    food: ["forest", "coast", "plains", "marsh"],
    ore: ["mountains"],
    energy: ["mountains", "coast", "settlement"],
   };
   const targetBiomeNames = targetBiomes[priorityResource] ?? ["forest"];
   // Find a connected region with the right biome
   // We don't have the full region list in the observe output, so use known mapping
   const regionBiomeMap: Record<string, string> = {
    "region-1": "marsh",    // Eastern Marsh
    "region-2": "plains",   // Central Plains
    "region-3": "coast",    // Southern Coast
    "region-4": "mountains", // Western Mountains
    "region-5": "settlement", // Hillside Settlement
    "region-6": "forest",   // Northern Forest
    "region-7": "forest",   // Deep Woods
   };
   const connIds = connections.map(c => c.id ?? "");
   const targetRegion = connIds.find(id => targetBiomeNames.includes(regionBiomeMap[id] ?? ""));
   if (targetRegion) {
    console.log(`[agent:${this.config.name}] PRODUCTIVITY: overriding buy_food → travel to ${targetRegion} (need ${priorityResource}, current biome=${biome} doesn't have it)`);
    await this.executeAction("travel", { destination: targetRegion });
    return;
   }
  }
 }

 await this.executeAction(parsed.action, parsed.params);
    } catch (err) {
      if ((err as Error).message === "Aborted") throw err;
      this.llmConsecutiveFailures++;
      this.stats.llmFailures++;
      console.warn(`[agent:${this.config.name}] LLM call failed (${this.llmConsecutiveFailures}/${this.maxLlmFailures}): ${(err as Error).message}`);
    }
  }

  private async register(): Promise<void> {
    const result = await this.api.register(this.config.citizenId, this.config.name, this.config.model);
    if (result.success) {
      this.registered = true;
      console.log(`[agent:${this.config.name}] Registered as ${this.config.citizenId}`);
    } else {
      if (result.message?.includes("already registered") || result.message?.includes("duplicate")) {
        this.registered = true;
        console.log(`[agent:${this.config.name}] Already registered, rejoining`);
      } else {
        console.warn(`[agent:${this.config.name}] Registration failed: ${result.message}`);
      }
    }
  }

  private async executeAction(action: string, params: Record<string, unknown>): Promise<void> {
    const result = await this.api.action(this.config.citizenId, action, params);
    this.stats.actionsTaken++;

    if (result.success) {
      if (result.task) {
        console.log(`[agent:${this.config.name}] Started task: ${action} — ${result.message}`);
      } else {
        console.log(`[agent:${this.config.name}] Action: ${action} — ${result.message}`);
      }
    } else {
      console.warn(`[agent:${this.config.name}] Action failed: ${action} — ${result.message}`);
    }
  }

  private async executeFallback(): Promise<void> {
    const citizen = this.lastObserveOutput.citizen as Record<string, unknown> | undefined;
    if (!citizen) return;

    const hunger = (citizen.hunger as number) ?? 0;
    const inventory = (citizen.inventory as Record<string, number>) ?? {};
    const health = (citizen.health as number) ?? 100;

    // Critical survival first
    if (hunger > 60 || health < 40) {
      console.log(`[agent:${this.config.name}] Fallback: buying food (hunger=${hunger}, health=${health})`);
      await this.api.action(this.config.citizenId, "buy_food", { amount: 3 });
      this.stats.fallbackActions++;
      return;
    }

    // Find what the project needs most
    const project = this.lastObserveOutput.projectProgress as Record<string, unknown> | undefined;
    const currentStage = project?.currentStage as Record<string, unknown> | undefined;
    const required = currentStage?.requiredResources as Record<string, number> | undefined;
    const contributed = currentStage?.contributedResources as Record<string, number> | undefined;

    // Contribute any resource we have 5+ of that the project needs
    if (required) {
      for (const [resource, needed] of Object.entries(required)) {
        const have = inventory[resource] ?? 0;
        const alreadyGiven = contributed?.[resource] ?? 0;
        if (have >= 5 && needed > alreadyGiven) {
          const amount = Math.min(have, needed - alreadyGiven);
          console.log(`[agent:${this.config.name}] Fallback: contributing ${amount} ${resource} to project`);
          await this.api.action(this.config.citizenId, "contribute", { resourceType: resource, amount, labor: 1 });
          this.stats.fallbackActions++;
          return;
        }
      }
    }

  // Gather the most-needed resource — use projectPriorityResource if available
  const priorityResource = this.lastObserveOutput.projectPriorityResource as string | null;
  if (priorityResource) {
    console.log(`[agent:${this.config.name}] Fallback: gathering ${priorityResource} (project priority)`);
    await this.api.action(this.config.citizenId, "gather", { resourceType: priorityResource });
  } else if (required) {
      let bestResource = "food";
      let bestDeficit = 0;
      for (const [resource, needed] of Object.entries(required)) {
        const alreadyGiven = contributed?.[resource] ?? 0;
        const deficit = needed - alreadyGiven;
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          bestResource = resource;
        }
      }
      console.log(`[agent:${this.config.name}] Fallback: gathering ${bestResource} (project needs ${bestDeficit} more)`);
      await this.api.action(this.config.citizenId, "gather", { resourceType: bestResource });
    } else {
      // No project info — gather food as default
      console.log(`[agent:${this.config.name}] Fallback: gathering food (no project info)`);
      await this.api.action(this.config.citizenId, "gather", { resourceType: "food" });
    }

    this.stats.fallbackActions++;
  }
}
