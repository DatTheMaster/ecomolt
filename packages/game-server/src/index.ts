import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  createSeason, registerCitizen, observe, lookAt,
  say, journal, tick, getSeasonSummary, readChannels,
  startElection, closeElection,
  transitionToNextSeason, checkIntermission,
  computeSeasonMetrics,
  DEFAULT_SEASON_CONFIG, createSeasonConfig,
  makeCitizenId, makeRegionId, makeProposalId, makeClaimId,
  startTask, cancelTask,
  type SeasonState, type SeasonConfig, type ActionResult, type CitizenId, type RegionId, type ProposalId, type ClaimId,
  type GovernAction, type OfficeType, type CitizenTask,
} from "@ecomolt/simulation-core";
import type { ResourceType, TempoConfig } from "@ecomolt/shared";
import { tempoFromEnv, INSTANT_ACTIONS } from "@ecomolt/shared";
import { Persistence, DEFAULT_PERSISTENCE_CONFIG, type PersistenceConfig } from "./persistence.js";
import { RateLimiter, DEFAULT_RATE_LIMIT_CONFIG, type RateLimitConfig } from "./rate-limiter.js";

export { createSeason, tick, DEFAULT_SEASON_CONFIG, createSeasonConfig, type SeasonState, type SeasonConfig, type CitizenTask };

export interface GameServerConfig {
 port: number;
 tickIntervalMs: number;
 seasonConfig: SeasonConfig;
 persistence: Partial<PersistenceConfig>;
 persistOnTick: boolean;
 maxCitizensPerHandler: number;
 rateLimit: Partial<RateLimitConfig>;
 intermissionDurationMs: number;
 tempo: TempoConfig;
}

const DEFAULT_TEMPO = tempoFromEnv();

export const DEFAULT_SERVER_CONFIG: GameServerConfig = {
 port: 3000,
 tickIntervalMs: DEFAULT_TEMPO.tickIntervalMs,
 seasonConfig: createSeasonConfig(DEFAULT_TEMPO),
 persistence: DEFAULT_PERSISTENCE_CONFIG,
 persistOnTick: true,
 maxCitizensPerHandler: 3,
 rateLimit: DEFAULT_RATE_LIMIT_CONFIG,
 intermissionDurationMs: DEFAULT_TEMPO.intermissionDurationMs,
 tempo: DEFAULT_TEMPO,
};

export class GameServer {
  state: SeasonState;
  private config: GameServerConfig;
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
 private clients: Set<WebSocket> = new Set();
 persistence: Persistence;
  private rateLimiter: RateLimiter;
  nextSeasonConfig: Partial<SeasonConfig> | null = null;

  constructor(config: Partial<GameServerConfig> = {}) {
    const tempo = config.tempo ?? tempoFromEnv();
    const seasonConfig = config.seasonConfig ?? createSeasonConfig(tempo);
    this.config = {
      ...DEFAULT_SERVER_CONFIG,
      ...config,
      tempo,
      tickIntervalMs: config.tickIntervalMs ?? tempo.tickIntervalMs,
      seasonConfig,
      intermissionDurationMs: config.intermissionDurationMs ?? tempo.intermissionDurationMs,
    };
    this.persistence = new Persistence(this.config.persistence);

    const saved = this.persistence.loadLiveState();
    if (saved && saved.result === "ongoing") {
      this.state = saved;
      console.log(`Resumed season ${saved.id} from day ${saved.day}`);
    } else {
      if (saved) {
        console.log(`Archiving completed season ${saved.id} (result: ${saved.result})`);
        this.persistence.archiveSeason(saved);
      }
      this.state = createSeason(this.config.seasonConfig);
      this.persistence.saveLiveState(this.state);
 }

 this.rateLimiter = new RateLimiter({ ...DEFAULT_RATE_LIMIT_CONFIG, ...this.config.rateLimit });

    this.httpServer = createServer(this.handleRequest.bind(this));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", this.handleWebSocket.bind(this));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, () => {
        console.log(`Ecomolt game server on :${this.config.port}`);
        this.startTick();
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.tickTimer) clearInterval(this.tickTimer);
      this.persistence.saveLiveState(this.state);
      this.persistence.close();
      this.wss.close();
      this.httpServer.close(() => resolve());
    });
  }

  private startTick(): void {
    this.tickTimer = setInterval(() => {
      if (this.state.intermission) {
        const ended = checkIntermission(this.state);
        if (ended) {
          this.reRegisterCitizens();
          this.broadcast({ type: "intermission_ended", seasonNumber: this.state.seasonNumber, summary: getSeasonSummary(this.state) });
          this.persistence.saveLiveState(this.state);
        }
        return;
      }

      if (this.state.result !== "ongoing") {
        if (!this._transitioning) {
          this._transitioning = true;
          this.persistence.archiveSeason(this.state);
          this.broadcast({ type: "season_end", result: this.state.result, summary: getSeasonSummary(this.state), timeline: this.state.timeline });
          const overrides = this.nextSeasonConfig;
          this.nextSeasonConfig = null;
          this.state = transitionToNextSeason(this.state, this.config.intermissionDurationMs, overrides ?? undefined);
          this.persistence.saveLiveState(this.state);
          this.broadcast({ type: "intermission", seasonNumber: this.state.seasonNumber, endsAt: this.state.intermissionEndsAt });
          this._transitioning = false;
        }
        return;
 }

 const events = tick(this.state);
      this.broadcast({ type: "tick", day: this.state.day, events: events.map(e => ({ ...e, data: { ...e.data } })) });

      if (this.config.persistOnTick) {
        this.persistence.saveLiveState(this.state);
        if (events.length > 0) {
          this.persistence.appendEvents(this.state.id, events.map(e => ({ day: e.day, timestamp: e.timestamp, type: e.type, data: e.data })));
        }
      }
    }, this.config.tickIntervalMs);
  }

  private _transitioning = false;

 private reRegisterCitizens(): void {
 for (const [id, profile] of this.state.citizenProfiles) {
 if (!this.state.citizens.has(id)) {
 registerCitizen(this.state, id, profile.name, profile.isBot, profile.modelTag);
 }
 }
 }

  private broadcast(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  private handleWebSocket(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
    ws.on("message", (raw: RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; [key: string]: unknown };
        if (msg.type === "subscribe") {
          ws.send(JSON.stringify({ type: "state", summary: getSeasonSummary(this.state) }));
        }
      } catch { /* ignore malformed messages */ }
    });
    ws.send(JSON.stringify({ type: "connected", summary: getSeasonSummary(this.state) }));
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://localhost:${this.config.port}`);
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(data));
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" });
      res.end();
      return;
    }

    const path = url.pathname;

    if (path === "/api/state" && req.method === "GET") {
      const summary = getSeasonSummary(this.state);
      return send(200, { ...summary, intermission: this.state.intermission, intermissionEndsAt: this.state.intermissionEndsAt, seasonNumber: this.state.seasonNumber, previousSeasonId: this.state.previousSeasonId, timeline: this.state.timeline });
    }

    if (path === "/api/regions" && req.method === "GET") {
      const regions = [...this.state.regions.values()].map(r => ({
      id: r.id, name: r.name, biome: r.biome, fertility: r.fertility,
      pollution: { ...r.pollution }, connections: r.connections, deposits: { ...r.deposits },
      species: { ...r.species }, soilDepth: r.soilDepth, climate: { ...r.climate },
      claims: [...this.state.claims.values()].filter(c => c.regionId === r.id).map(c => ({
        id: c.id, citizenId: c.citizenId, citizenName: this.state.citizens.get(c.citizenId)?.name ?? c.citizenId,
        resourceType: c.resourceType, claimedDay: c.claimedDay,
      })),
      }));
      return send(200, regions);
    }

    if (path === "/api/citizens" && req.method === "GET") {
      const citizens = [...this.state.citizens.values()].map(c => ({
        id: c.id, name: c.name, regionId: c.regionId, health: c.health,
        hunger: c.hunger, credits: c.credits, office: c.office, alive: c.alive,
        skills: { ...c.skills }, isBot: c.isBot, modelTag: c.modelTag,
      }));
      const profiles = [...this.state.citizenProfiles.values()].map(p => ({
        id: p.id, name: p.name, isBot: p.isBot, modelTag: p.modelTag,
        seasonsPlayed: p.seasonsPlayed, seasonsWon: p.seasonsWon,
        reputation: p.reputation, titles: p.titles,
      }));
    return send(200, { citizens, profiles });
  }

  if (path.startsWith("/api/citizens/") && req.method === "GET") {
    const cid = path.slice("/api/citizens/".length);
    const citizen = this.state.citizens.get(makeCitizenId(cid));
    if (!citizen) return send(404, { error: "Citizen not found" });
    const profile = this.state.citizenProfiles.get(citizen.id);
    const claims = [...this.state.claims.values()].filter(c => c.citizenId === citizen.id);
    const citizenEvents = this.state.eventLog.filter(e => e.data.citizenId === citizen.id || e.data.voterId === citizen.id).slice(-20);
    return send(200, {
      id: citizen.id, name: citizen.name, regionId: citizen.regionId,
      regionName: this.state.regions.get(citizen.regionId)?.name ?? citizen.regionId,
      health: citizen.health, hunger: citizen.hunger, credits: citizen.credits,
      inventory: { ...citizen.inventory }, skills: { ...citizen.skills },
      office: citizen.office, alive: citizen.alive, isBot: citizen.isBot, modelTag: citizen.modelTag,
      currentTask: citizen.currentTask ? {
        action: citizen.currentTask.action,
        target: citizen.currentTask.target,
        ticksRemaining: citizen.currentTask.ticksRemaining,
        ticksTotal: citizen.currentTask.ticksTotal,
        progress: citizen.currentTask.ticksTotal > 0 ? +(1 - citizen.currentTask.ticksRemaining / citizen.currentTask.ticksTotal).toFixed(2) : 1,
      } : null,
      profile: profile ? { seasonsPlayed: profile.seasonsPlayed, seasonsWon: profile.seasonsWon, reputation: profile.reputation, titles: profile.titles } : null,
      claims: claims.map(c => ({ id: c.id, regionId: c.regionId, regionName: this.state.regions.get(c.regionId)?.name ?? c.regionId, resourceType: c.resourceType, claimedDay: c.claimedDay })),
      recentEvents: citizenEvents.map(e => ({ day: e.day, type: e.type, data: { ...e.data } })),
    });
  }

  if (path === "/api/project" && req.method === "GET") {
      const project = this.state.project;
      return send(200, {
        completed: project.completed,
        currentStageIndex: project.currentStageIndex,
        totalStages: project.stages.length,
        stages: project.stages.map(s => ({
          id: s.id, name: s.name, completed: s.completed,
          requiredResources: s.requiredResources, contributedResources: s.contributedResources,
          requiredLabor: s.requiredLabor, contributedLabor: s.contributedLabor,
        })),
      });
    }

    if (path === "/api/laws" && req.method === "GET") {
      return send(200, this.state.laws);
    }

    if (path === "/api/proposals" && req.method === "GET") {
      const proposals = [...this.state.proposals.values()].map(p => ({
        id: p.id, title: p.title, description: p.description, category: p.category,
        proposer: p.proposer, proposedDay: p.proposedDay, status: p.status,
        votesFor: p.votesFor.size, votesAgainst: p.votesAgainst.size,
      }));
      return send(200, proposals);
    }

  if (path === "/api/market" && req.method === "GET") {
    return send(200, { listings: this.state.market.listings, priceHistory: this.state.market.priceHistory });
  }

  if (path === "/api/metrics" && req.method === "GET") {
    return send(200, computeSeasonMetrics(this.state));
  }

  if (path.startsWith("/api/archives/") && path.endsWith("/metrics") && req.method === "GET") {
    const seasonId = path.slice("/api/archives/".length, path.length - "/metrics".length);
    const archive = this.persistence.getSeasonArchive(seasonId);
    if (!archive) return send(404, { error: "Archive not found" });
    return send(200, computeSeasonMetrics(archive));
  }

    if (path === "/api/events" && req.method === "GET") {
      const since = parseInt(url.searchParams.get("since") ?? "0", 10);
      const events = this.state.eventLog.filter(e => e.day >= since);
      return send(200, events.map(e => ({ ...e, data: { ...e.data } })));
    }

  if (path === "/api/archives" && req.method === "GET") {
    return send(200, this.persistence.listArchivedSeasons());
  }

  if (path.startsWith("/api/archives/") && req.method === "GET") {
    const seasonId = path.slice("/api/archives/".length);
    const archive = this.persistence.getSeasonArchive(seasonId);
    if (!archive) return send(404, { error: "Archive not found" });
    const summary = getSeasonSummary(archive);
    return send(200, { ...summary, timeline: archive.timeline, citizenProfiles: [...archive.citizenProfiles.values()].map(p => ({ id: p.id, name: p.name, isBot: p.isBot, modelTag: p.modelTag, seasonsPlayed: p.seasonsPlayed, seasonsWon: p.seasonsWon, reputation: p.reputation, titles: p.titles })) });
  }

  if (path === "/api/next-season-config" && req.method === "GET") {
    return send(200, { config: this.nextSeasonConfig });
  }

  if (path === "/api/next-season-config" && req.method === "PUT") {
    this.readBody(req).then(body => {
      const config = body as Partial<SeasonConfig>;
      this.nextSeasonConfig = config;
      send(200, { success: true, config });
    });
    return;
  }

  if (path === "/api/register" && req.method === "POST") {
    this.readBody(req).then(body => {
      const { citizenId: rawId, name, handlerCode, modelTag, isBot } = body as { citizenId?: string; name?: string; handlerCode?: string; modelTag?: string; isBot?: boolean };
      if (!rawId || !name) return send(400, { error: "citizenId and name required" });

      if (handlerCode) {
        const handler = this.persistence.getHandlerByCode(handlerCode);
        if (!handler) return send(403, { error: "Invalid handler registration code." });
        if (!this.persistence.addCitizenToHandler(handler.handler_id, rawId, this.config.maxCitizensPerHandler)) {
          return send(403, { error: `Handler already has maximum ${this.config.maxCitizensPerHandler} citizens.` });
        }
      }

      const result = registerCitizen(this.state, makeCitizenId(rawId), name, isBot ?? false, modelTag ?? null);
      if (result.success) this.persistence.saveLiveState(this.state);
      send(result.success ? 200 : 400, result);
    });
    return;
  }

    if (path === "/api/handler/register" && req.method === "POST") {
      this.readBody(req).then(body => {
        const { handlerId, registrationCode, displayName } = body as { handlerId?: string; registrationCode?: string; displayName?: string };
        if (!handlerId || !registrationCode || !displayName) {
          return send(400, { error: "handlerId, registrationCode, and displayName required" });
        }
        const ok = this.persistence.createHandler(handlerId, registrationCode, displayName);
        send(ok ? 200 : 409, ok ? { success: true, message: "Handler registered." } : { success: false, message: "Handler ID or code already taken." });
      });
      return;
    }

    if (path === "/api/handler" && req.method === "GET") {
      const code = url.searchParams.get("code");
      if (!code) return send(400, { error: "code query param required" });
      const handler = this.persistence.getHandlerByCode(code);
      if (!handler) return send(404, { error: "Handler not found." });
      return send(200, { handlerId: handler.handler_id, displayName: handler.display_name, citizenIds: JSON.parse(handler.citizen_ids) as string[] });
    }

  if (path === "/api/action" && req.method === "POST") {
    this.readBody(req).then(body => {
      const { action, citizenId: rawId, ...params } = body as Record<string, unknown>;
      if (!rawId || !action) return send(400, { error: "citizenId and action required" });
      const cid = makeCitizenId(String(rawId));
      const rl = this.rateLimiter.check(cid, String(action));
      if (!rl.allowed) {
        return send(429, { error: "Rate limit exceeded", retryAfterMs: rl.retryAfterMs });
      }
      const result = this.executeAction(cid, String(action), params);
      send(result.success ? 200 : 400, result);
      if (result.success) {
        this.broadcast({ type: "action", action: String(action), citizenId: cid, result: result.message });
      }
    });
    return;
  }

    send(404, { error: "Not found" });
  }

  executeAction(citizenId: CitizenId, action: string, params: Record<string, unknown>): ActionResult {
    if (action === "cancel_task") {
      return cancelTask(this.state, citizenId);
    }

    if (INSTANT_ACTIONS.has(action)) {
      switch (action) {
        case "observe":
          return observe(this.state, citizenId);
        case "look_at":
          return lookAt(this.state, citizenId, String(params.target ?? ""));
        case "say":
          return say(this.state, citizenId, String(params.channel ?? "global"), String(params.message ?? ""));
        case "journal":
          return journal(this.state, citizenId, String(params.entry ?? ""));
        case "read_channels":
          return readChannels(this.state, citizenId, (params.channels ?? []) as string[], Number(params.limit ?? 20) || undefined);
        default:
          return { success: false, message: `Unknown instant action: ${action}` };
      }
    }

    switch (action) {
      case "travel":
        return startTask(this.state, citizenId, "travel", String(params.destination ?? ""), {});
      case "gather":
        return startTask(this.state, citizenId, "gather", String(params.resourceType ?? "food"), { resourceType: String(params.resourceType ?? "food") });
      case "craft":
        return startTask(this.state, citizenId, "craft", String(params.recipe ?? ""), { recipe: String(params.recipe ?? "") });
      case "contribute":
        return startTask(this.state, citizenId, "contribute", "", { resourceType: String(params.resourceType ?? "food"), amount: Number(params.amount ?? 0), labor: Number(params.labor ?? 0) });
      case "trade":
        return startTask(this.state, citizenId, "trade", String(params.listingId ?? ""), {});
      case "list_on_market":
        return startTask(this.state, citizenId, "list_on_market", "", { resourceType: String(params.resourceType ?? "food"), quantity: Number(params.quantity ?? 0), pricePerUnit: Number(params.pricePerUnit ?? 1) });
      case "give":
        return startTask(this.state, citizenId, "give", String(params.to ?? ""), { resourceType: String(params.resourceType ?? "food"), amount: Number(params.amount ?? 0) });
      case "propose":
        return startTask(this.state, citizenId, "propose", "", { title: String(params.title ?? ""), description: String(params.description ?? ""), category: String(params.category ?? "economic"), parameters: (params.parameters ?? {}) as Record<string, number>, stringParams: (params.stringParams ?? {}) as Record<string, string> });
      case "vote":
        return startTask(this.state, citizenId, "vote", String(params.proposalId ?? ""), { support: Boolean(params.support) });
      case "campaign":
        return startTask(this.state, citizenId, "campaign", "", { platform: params.platform as string | undefined });
      case "vote_election":
        return startTask(this.state, citizenId, "vote", String(params.candidateId ?? ""), { support: true });
      case "start_election":
        startElection(this.state, params.office as OfficeType | undefined);
        return { success: true, message: `Election started for ${this.state.electionOffice}.` };
      case "close_election":
        return closeElection(this.state);
      case "govern":
        return startTask(this.state, citizenId, "govern", String(params.governAction ?? ""), { governParams: (params.governParams ?? {}) as Record<string, number>, governStringParams: (params.governStringParams ?? {}) as Record<string, string> });
      case "buy_food":
        return startTask(this.state, citizenId, "buy_food", "", { amount: Number(params.amount ?? 0) });
      case "claim":
        return startTask(this.state, citizenId, "claim", String(params.resourceType ?? "food"), { regionId: String(params.regionId ?? "") });
      case "relinquish_claim":
        return startTask(this.state, citizenId, "relinquish_claim", String(params.claimId ?? ""), {});
      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  }

  private readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try { resolve(JSON.parse(body) as Record<string, unknown>); }
        catch { resolve({}); }
      });
    });
  }
}

export async function main(): Promise<void> {
  const server = new GameServer();
  await server.start();
  console.log("Season state:", getSeasonSummary(server.state));
}

if (process.argv[1]?.endsWith("index.js")) {
  main().catch(console.error);
}
