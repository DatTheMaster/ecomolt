import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentConfig } from "./agent.js";

export interface AgentRunnerConfig {
  agents: AgentConfig[];
  apiUrl: string;
  rpm: number;
  tickIntervalMs: number;
}

export async function loadConfig(configPath: string): Promise<AgentRunnerConfig> {
  const absPath = resolve(configPath);
  const raw = await readFile(absPath, "utf-8");
  const json = JSON.parse(raw) as Partial<AgentRunnerConfig> | AgentConfig[];

  if (Array.isArray(json)) {
    const tempo = process.env.TEMPO ?? "dev";
    const tickIntervalMs = tempo === "live" ? 30000 : tempo === "ci" ? 10 : 5000;
    return {
      agents: json,
      apiUrl: process.env.ECOMOLT_API_URL ?? "http://localhost:3000",
      rpm: 40,
      tickIntervalMs,
    };
  }

  return {
    agents: json.agents ?? [],
    apiUrl: json.apiUrl ?? process.env.ECOMOLT_API_URL ?? "http://localhost:3000",
    rpm: json.rpm ?? 40,
    tickIntervalMs: json.tickIntervalMs ?? 5000,
  };
}

export function validateConfig(config: AgentRunnerConfig): string[] {
  const errors: string[] = [];
  if (config.agents.length === 0) errors.push("No agents configured");
  const ids = new Set<string>();
  for (const agent of config.agents) {
    if (!agent.citizenId) errors.push(`Agent missing citizenId: ${agent.name}`);
    if (!agent.name) errors.push(`Agent missing name: ${agent.citizenId}`);
    if (!agent.model) errors.push(`Agent missing model: ${agent.citizenId}`);
    if (!agent.apiBase) errors.push(`Agent missing apiBase: ${agent.citizenId}`);
    if (!agent.apiKey) errors.push(`Agent missing apiKey: ${agent.citizenId}`);
    if (ids.has(agent.citizenId)) errors.push(`Duplicate citizenId: ${agent.citizenId}`);
    ids.add(agent.citizenId);
  }
  return errors;
}
