import { loadConfig, validateConfig } from "./config.js";
import { GameApiClient } from "./api-client.js";
import { RateLimiterRegistry, safeSleep } from "./rate-limiter.js";
import { Agent } from "./agent.js";

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let configPath = "agents.json";
  let apiUrlOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" && args[i + 1]) {
      configPath = args[++i]!;
    } else if (arg === "--api-url" && args[i + 1]) {
      apiUrlOverride = args[++i]!;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: agent-runner [options]

Options:
  --config <path>  Path to agents.json config (default: agents.json)
  --api-url <url>  Game server API URL (overrides config/env)
  --help           Show this help

Environment:
  ECOMOLT_API_URL  Game server API URL (default: http://localhost:3000)
  TEMPO            Tempo mode: live (30s), dev (5s), ci (10ms)`);
      process.exit(0);
    }
  }

  console.log("[runner] Loading config from", configPath);
  const config = await loadConfig(configPath);

  if (apiUrlOverride) {
    config.apiUrl = apiUrlOverride;
  }

  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error("[runner] Config errors:");
    for (const err of errors) console.error(` - ${err}`);
    process.exit(1);
  }

  console.log(`[runner] Starting ${config.agents.length} agents against ${config.apiUrl} (tick: ${config.tickIntervalMs}ms)`);

  const api = new GameApiClient({ apiUrl: config.apiUrl });
  const rateLimiters = new RateLimiterRegistry();

  // Create agents with per-provider rate limiters
  const agents = config.agents.map(agentConfig => {
    const rpm = agentConfig.rpm ?? config.rpm;
    const limiter = rateLimiters.get(agentConfig.apiBase, agentConfig.apiKey, rpm);
    return new Agent(agentConfig, api, limiter, config.tickIntervalMs);
  });

  console.log("[runner] Rate limiters:", rateLimiters.list().map(l => `${l.key}=${l.rpm}rpm`).join(", "));

  const shutdown = () => {
    console.log("[runner] Shutting down...");
    for (const agent of agents) agent.stop();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Stagger agent startup to avoid API stampede
  const running: Promise<void>[] = [];
  for (let i = 0; i < agents.length; i++) {
    if (i > 0) await safeSleep(2000); // 2s stagger between agents
    running.push(agents[i]!.run());
  }

  const statsInterval = setInterval(() => {
    for (const agent of agents) {
      const s = agent.agentStats;
      console.log(`[stats:${agent.citizenId}] state=${agent.agentState} actions=${s.actionsTaken} llm=${s.llmCalls} fails=${s.llmFailures} fallback=${s.fallbackActions}`);
    }
  }, 30000);

  try {
    await Promise.all(running);
  } finally {
    clearInterval(statsInterval);
  }

  console.log("[runner] All agents stopped");

  for (const agent of agents) {
    const s = agent.agentStats;
    console.log(`[final:${agent.citizenId}] actions=${s.actionsTaken} tasks=${s.tasksCompleted} llm=${s.llmCalls} fails=${s.llmFailures} fallback=${s.fallbackActions} ticks=${s.ticksAlive}`);
  }
}

if (process.argv[1]?.endsWith("cli.js")) {
  main().catch(err => {
    console.error("[runner] Fatal:", err);
    process.exit(1);
  });
}
