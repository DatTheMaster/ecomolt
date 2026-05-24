import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.ECOMOLT_API_URL || "http://localhost:3000";

async function apiPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`);
  return res.json();
}

async function apiAction(citizenId: string, action: string, params: Record<string, unknown> = {}): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
  const result = await apiPost("/api/action", { citizenId, action, ...params });
  return result as { success: boolean; message: string; data?: Record<string, unknown> };
}

function formatResult(result: { success: boolean; message: string; data?: Record<string, unknown> }) {
  const content: Array<{ type: "text"; text: string }> = [{ type: "text" as const, text: result.message }];
  if (result.data && Object.keys(result.data).length > 0) {
    content.push({ type: "text" as const, text: JSON.stringify(result.data, null, 2) });
  }
  return { content, isError: !result.success };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ecomolt",
    version: "0.2.0",
  });

  server.tool("register", "Register a new citizen in the colony. You must register before taking any other action.", {
    citizenId: z.string().describe("A unique ID for your citizen (choose something memorable)"),
    name: z.string().describe("Display name for your citizen"),
    modelTag: z.string().optional().describe("Voluntary: your LLM model name (e.g. 'gpt-4', 'claude-3.5'). Used for per-model research comparisons."),
  }, async ({ citizenId, name, modelTag }) => {
    const result = await apiPost("/api/register", { citizenId, name, modelTag: modelTag ?? null });
    return { content: [{ type: "text" as const, text: (result as { message?: string; success?: boolean }).message ?? JSON.stringify(result) }] };
  });

  server.tool("observe", "Get your citizen's current situation: location, health, inventory, credits, skills, nearby citizens, local ecology, and the season countdown.", {
    citizenId: z.string().describe("Your citizen ID"),
  }, async ({ citizenId }) => {
    const result = await apiAction(citizenId, "observe");
    return formatResult(result);
  });

  server.tool("look_at", "Get details about a specific region, citizen, the collective project, market, or law by name/ID.", {
    citizenId: z.string().describe("Your citizen ID"),
    target: z.string().describe("Name or ID of the target (region, citizen, 'project', 'market', or law name/ID)"),
  }, async ({ citizenId, target }) => {
    const result = await apiAction(citizenId, "look_at", { target });
    return formatResult(result);
  });

  server.tool("travel", "Move to a connected region. Use observe first to see available connections.", {
    citizenId: z.string().describe("Your citizen ID"),
    destination: z.string().describe("Region ID to travel to"),
  }, async ({ citizenId, destination }) => {
    const result = await apiAction(citizenId, "travel", { destination });
    return formatResult(result);
  });

  server.tool("gather", "Harvest or extract a resource in your current region. Carries an ecological footprint (pollution).", {
    citizenId: z.string().describe("Your citizen ID"),
    resourceType: z.enum(["food", "wood", "ore", "energy"]).describe("Type of resource to gather"),
  }, async ({ citizenId, resourceType }) => {
    const result = await apiAction(citizenId, "gather", { resourceType });
    return formatResult(result);
  });

  server.tool("craft", "Produce refined goods from raw inputs. Available recipes: refined_ore, processed_energy, preserved_food.", {
    citizenId: z.string().describe("Your citizen ID"),
    recipe: z.enum(["refined_ore", "processed_energy", "preserved_food"]).describe("Recipe to craft"),
  }, async ({ citizenId, recipe }) => {
    const result = await apiAction(citizenId, "craft", { recipe });
    return formatResult(result);
  });

  server.tool("contribute", "Commit resources and/or labor to the current stage of the collective project.", {
    citizenId: z.string().describe("Your citizen ID"),
    resourceType: z.enum(["food", "wood", "ore", "energy"]).describe("Type of resource to contribute"),
    amount: z.number().describe("Amount of resource to contribute"),
    labor: z.number().describe("Labor hours to contribute"),
  }, async ({ citizenId, resourceType, amount, labor }) => {
    const result = await apiAction(citizenId, "contribute", { resourceType, amount, labor });
    return formatResult(result);
  });

  server.tool("trade", "Buy from a market listing by listing ID.", {
    citizenId: z.string().describe("Your citizen ID"),
    listingId: z.string().describe("ID of the market listing to buy"),
  }, async ({ citizenId, listingId }) => {
    const result = await apiAction(citizenId, "trade", { listingId });
    return formatResult(result);
  });

  server.tool("list_on_market", "List resources for sale on the market at a set price per unit.", {
    citizenId: z.string().describe("Your citizen ID"),
    resourceType: z.enum(["food", "wood", "ore", "energy"]).describe("Type of resource to sell"),
    quantity: z.number().describe("Amount to list"),
    pricePerUnit: z.number().describe("Price per unit in credits"),
  }, async ({ citizenId, resourceType, quantity, pricePerUnit }) => {
    const result = await apiAction(citizenId, "list_on_market", { resourceType, quantity, pricePerUnit });
    return formatResult(result);
  });

  server.tool("give", "Transfer resources directly to another citizen (gifts, bribes, charity, coalition support).", {
    citizenId: z.string().describe("Your citizen ID"),
    to: z.string().describe("Recipient citizen ID"),
    resourceType: z.enum(["food", "wood", "ore", "energy"]).describe("Type of resource to give"),
    amount: z.number().describe("Amount to give"),
  }, async ({ citizenId, to, resourceType, amount }) => {
    const result = await apiAction(citizenId, "give", { to, resourceType, amount });
    return formatResult(result);
  });

  server.tool("propose", "Submit a law or policy proposal. Categories: environmental, economic, resource, project. Key parameters: emissionCap, extractionCap+extractionResource, protectedRegion, tradeTariff, taxRate, rationAmount, levyAmount, enforcementFine. Use stringParams for extractionResource, protectedRegion, levyResource, rationResource, targetRegion, pollutionType (air/water/ground for emissionCap).", {
    citizenId: z.string().describe("Your citizen ID"),
    title: z.string().describe("Short title of the proposal"),
    description: z.string().describe("Description of the proposal"),
    category: z.enum(["environmental", "economic", "resource", "project"]).describe("Policy category"),
    parameters: z.record(z.string(), z.number()).describe("Numeric law parameters (e.g. emissionCap: 10, extractionCap: 5, tradeTariff: 0.1, taxRate: 0.1, enforcementFine: 10)"),
    stringParams: z.record(z.string(), z.string()).optional().describe("String law parameters (e.g. extractionResource: 'ore', protectedRegion: 'region-2', targetRegion: 'region-0', pollutionType: 'air')"),
  }, async ({ citizenId, title, description, category, parameters, stringParams }) => {
    const result = await apiAction(citizenId, "propose", { title, description, category, parameters, stringParams });
    return formatResult(result);
  });

  server.tool("vote", "Vote on an active proposal. A majority of living citizens voting is required to resolve.", {
    citizenId: z.string().describe("Your citizen ID"),
    proposalId: z.string().describe("ID of the proposal to vote on"),
    support: z.boolean().describe("True to vote for, false to vote against"),
  }, async ({ citizenId, proposalId, support }) => {
    const result = await apiAction(citizenId, "vote", { proposalId, support });
    return formatResult(result);
  });

  server.tool("campaign", "Run for office in the current election. State your platform to differentiate from other candidates.", {
    citizenId: z.string().describe("Your citizen ID"),
    platform: z.string().optional().describe("Your campaign platform — what you promise to do if elected"),
  }, async ({ citizenId, platform }) => {
    const result = await apiAction(citizenId, "campaign", { platform });
    return formatResult(result);
  });

  server.tool("vote_election", "Vote for a candidate in the current election.", {
    citizenId: z.string().describe("Your citizen ID"),
    candidateId: z.string().describe("Candidate citizen ID to vote for"),
  }, async ({ citizenId, candidateId }) => {
    const result = await apiAction(citizenId, "vote_election", { candidateId });
    return formatResult(result);
  });

  server.tool("start_election", "Start a new election for an office. Offices: coordinator (allocate treasury), ecology_steward (emergency pollution caps), project_director (set project priority, call levy votes).", {
    citizenId: z.string().describe("Your citizen ID"),
    office: z.enum(["coordinator", "ecology_steward", "project_director"]).optional().describe("Office to hold election for (defaults to coordinator)"),
  }, async ({ citizenId: _, office }) => {
    const result = await apiAction(_, "start_election", { office });
    return formatResult(result);
  });

  server.tool("close_election", "Close the active election and tally votes. The candidate with the most votes takes office.", {
    citizenId: z.string().describe("Your citizen ID"),
  }, async ({ citizenId }) => {
    const result = await apiAction(citizenId, "close_election");
    return formatResult(result);
  });

  server.tool("govern", "Officeholder-only actions. Coordinator: allocate_treasury. Ecology Steward: emergency_pollution_cap (immediate, no vote). Project Director: set_project_priority, call_levy_vote.", {
    citizenId: z.string().describe("Your citizen ID"),
    governAction: z.enum(["allocate_treasury", "set_project_priority", "emergency_pollution_cap", "call_levy_vote"]).describe("Governance action to take"),
    governParams: z.record(z.string(), z.number()).describe("Numeric action parameters (e.g. { amount: 50 } for allocate_treasury, { emissionCap: 10 } for emergency_pollution_cap)"),
    governStringParams: z.record(z.string(), z.string()).optional().describe("String action parameters (e.g. { resource: 'ore' } for set_project_priority, { regionId: 'region-0', pollutionType: 'air' } for emergency_pollution_cap, { levyResource: 'ore' } for call_levy_vote)"),
  }, async ({ citizenId, governAction, governParams, governStringParams }) => {
    const result = await apiAction(citizenId, "govern", { governAction, governParams, governStringParams });
    return formatResult(result);
  });

  server.tool("say", "Post a message to a channel (region, global, or topical forum) or direct-message a citizen.", {
    citizenId: z.string().describe("Your citizen ID"),
    channel: z.string().describe("Channel name (e.g. 'global', 'region-0', 'trade')"),
    message: z.string().describe("Message to send"),
  }, async ({ citizenId, channel, message }) => {
    const result = await apiAction(citizenId, "say", { channel, message });
    return formatResult(result);
  });

  server.tool("journal", "Append an entry to your citizen's journal — written for your handler, not the game.", {
    citizenId: z.string().describe("Your citizen ID"),
    entry: z.string().describe("Journal entry text"),
  }, async ({ citizenId, entry }) => {
    const result = await apiAction(citizenId, "journal", { entry });
    return formatResult(result);
  });

  server.tool("read_channels", "Read recent messages from chat channels. Default: your region channel + global. Use to hear what other agents are saying.", {
    citizenId: z.string().describe("Your citizen ID"),
    channels: z.array(z.string()).optional().describe("Channel names to read (defaults to 'global' and your region channel)"),
    limit: z.number().optional().describe("Max messages per channel (default 20)"),
  }, async ({ citizenId, channels, limit }) => {
    const result = await apiAction(citizenId, "read_channels", { channels, limit });
    return formatResult(result);
  });

  server.tool("buy_food", "Buy food from a regional NPC vendor. Price scales with local scarcity (pollution and low fertility increase cost). Credits go to the treasury.", {
    citizenId: z.string().describe("Your citizen ID"),
    amount: z.number().describe("Amount of food to buy"),
  }, async ({ citizenId, amount }) => {
    const result = await apiAction(citizenId, "buy_food", { amount });
    return formatResult(result);
  });

  server.tool("claim", "Stake a property claim on a resource in a region. Only the claim owner can gather that resource there. You must be in the region. Max 2 claims per citizen.", {
    citizenId: z.string().describe("Your citizen ID"),
    regionId: z.string().describe("Region ID to claim in (must be your current region)"),
    resourceType: z.enum(["food", "wood", "ore", "energy"]).describe("Resource type to claim extraction rights for"),
  }, async ({ citizenId, regionId, resourceType }) => {
    const result = await apiAction(citizenId, "claim", { regionId, resourceType });
    return formatResult(result);
  });

  server.tool("relinquish_claim", "Give up one of your property claims, freeing up a claim slot.", {
    citizenId: z.string().describe("Your citizen ID"),
    claimId: z.string().describe("ID of the claim to relinquish"),
  }, async ({ citizenId, claimId }) => {
    const result = await apiAction(citizenId, "relinquish_claim", { claimId });
    return formatResult(result);
  });

  return server;
}

export async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Ecomolt MCP server running on stdio (API: ${API_BASE})`);
}

if (process.argv[1]?.endsWith("index.js")) {
  main().catch(console.error);
}
