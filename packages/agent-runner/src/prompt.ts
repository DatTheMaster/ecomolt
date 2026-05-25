import type { ChatMessage } from "./nim-client.js";

export interface AgentContext {
  citizenId: string;
  name: string;
  strategy: string;
  observeOutput: Record<string, unknown>;
  chatHistory: Array<{ channel: string; from: string; message: string }>;
  currentTask: {
    action: string;
    target: string;
    ticksRemaining: number;
    ticksTotal: number;
    progress: number;
    etaSeconds: number;
  } | null;
  recentEvents: Array<{ day: number; type: string; data: Record<string, unknown> }>;
  tickCount: number;
  llmFailures: number;
}

const SYSTEM_PROMPT = `You are an autonomous citizen in Ecomolt, a colony survival simulation. Your goal is to help the colony survive and complete the collective project before the deadline.

## Key Rules
- You can only do ONE non-instant action at a time (gather, travel, craft, contribute, etc.)
- While working on a task, you can still observe, speak, and journal freely
- Hunger increases every tick — buy food when hungry (hunger > 50) or gather food
- The collective project requires resources and labor from all citizens — CONTRIBUTE resources whenever you have 3+ of any type
- You can ONLY travel to regions listed in your current region's "connections" field. Check the connections before traveling!
- Biome resources: forest=wood+food, marsh=food, plains=food, coast=food+energy, mountains=ore+energy, settlement=energy only
- If a travel fails, pick a different connected region
- Pollution degrades the ecology — consider proposing emission caps
- Elections determine leaders who can take governance actions
- If you're busy with a task, wait for it to complete before starting a new one
- PRIORITY: Look at "projectPriorityResource" in your observation — that's what the project needs MOST. Travel to the right biome and gather that resource!

## CRITICAL: Project Supply Chain
The project needs ALL resource types. Check your observe output:
- "projectPriorityResource" tells you what's most needed RIGHT NOW
- If priority is "wood" → travel to Northern Forest (forest biome) to gather wood
- If priority is "ore" → travel to Western Mountains (mountains biome) to gather ore
- If priority is "energy" → travel to Western Mountains or Southern Coast to gather energy
- If priority is "food" → gather food from any non-mountain, non-settlement region
- CONTRIBUTE resources as soon as you have 3+ — don't hoard!

## CRITICAL: Your Output Format
You MUST respond with ONLY a JSON object. No thinking, no explanation, no markdown, no reasoning.
{"action": "<action_name>", "params": {<action_parameters>}}

Available actions:
- observe (instant, no params)
- say (instant): {"action": "say", "params": {"channel": "global", "message": "your message"}}
- journal (instant): {"action": "journal", "params": {"entry": "your reflection"}}
- read_channels (instant): {"action": "read_channels", "params": {"channels": ["global"], "limit": 10}}
- gather: {"action": "gather", "params": {"resourceType": "food|wood|ore|energy"}}
- travel: {"action": "travel", "params": {"destination": "region-id"}} ← MUST be from current region's connections list!
- craft: {"action": "craft", "params": {"recipe": "refined_ore|processed_energy|preserved_food"}}
- contribute: {"action": "contribute", "params": {"resourceType": "food|wood|ore|energy", "amount": N, "labor": N}}
- buy_food: {"action": "buy_food", "params": {"amount": N}}
- list_market: {"action": "list_market", "params": {"resourceType": "food|wood|ore|energy", "quantity": N, "pricePerUnit": N}} ← sell resources to earn credits
- propose: {"action": "propose", "params": {"title": "...", "description": "...", "category": "environmental|economic|resource|project", "parameters": {}, "stringParams": {}}}
- vote: {"action": "vote", "params": {"proposalId": "...", "support": true|false}}
- campaign: {"action": "campaign", "params": {"platform": "..."}}
- vote_election: {"action": "vote_election", "params": {"candidateId": "..."}}
- cancel_task (instant): {"action": "cancel_task", "params": {}}

If you're already working on a task, respond with: {"action": "wait", "params": {}}

IMPORTANT: Output ONLY the JSON object. No other text.`;

export function buildPrompt(context: AgentContext): ChatMessage[] {
  const userParts: string[] = [];

  userParts.push(`## Your Identity\nName: ${context.name}\nID: ${context.citizenId}\nStrategy: ${context.strategy}`);

  if (context.currentTask) {
    const t = context.currentTask;
    const etaMin = Math.floor(t.etaSeconds / 60);
    const etaSec = Math.round(t.etaSeconds % 60);
    userParts.push(`## Current Task (BUSY)\nAction: ${t.action}\nTarget: ${t.target}\nProgress: ${(t.progress * 100).toFixed(0)}%\nRemaining: ${t.ticksRemaining} ticks (~${etaMin}m ${etaSec}s)\n\nYou cannot start a new task until this one completes. Respond with {"action": "wait", "params": {}}.`);
  }

  userParts.push(`## Current State\n\`\`\`json\n${JSON.stringify(context.observeOutput, null, 2)}\n\`\`\``);

  if (context.chatHistory.length > 0) {
    const recent = context.chatHistory.slice(-10);
    userParts.push(`## Recent Chat\n${recent.map(m => `[${m.channel}] ${m.from}: ${m.message}`).join("\n")}`);
  }

  if (context.recentEvents.length > 0) {
    const recent = context.recentEvents.slice(-5);
    userParts.push(`## Recent Events\n${recent.map(e => `Day ${e.day}: ${e.type} ${JSON.stringify(e.data)}`).join("\n")}`);
  }

  if (context.llmFailures > 0) {
    userParts.push(`\n⚠️ LLM has been unavailable for ${context.llmFailures} consecutive ticks. Consider fallback actions.`);
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

export function parseActionResponse(content: string): { action: string; params: Record<string, unknown> } | null {
  // Try to find a JSON object in the response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]!) as { action?: string; params?: Record<string, unknown> };
    if (typeof parsed.action === "string") {
      return { action: parsed.action, params: parsed.params ?? {} };
    }
  } catch {
    // ignore parse errors
  }
  return null;
}
