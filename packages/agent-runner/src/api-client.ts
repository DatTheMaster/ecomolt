export interface GameApiClientConfig {
  apiUrl: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  task?: Record<string, unknown> | null;
}

export class GameApiClient {
  private apiUrl: string;

  constructor(config: GameApiClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
  }

  async register(citizenId: string, name: string, modelTag: string | null): Promise<ActionResult> {
    return this.post("/api/register", { citizenId, name, modelTag });
  }

  async action(citizenId: string, action: string, params: Record<string, unknown> = {}): Promise<ActionResult> {
    return this.post("/api/action", { citizenId, action, ...params });
  }

  async getState(): Promise<Record<string, unknown>> {
    return this.get("/api/state");
  }

  async getCitizen(citizenId: string): Promise<Record<string, unknown> | null> {
    const res = await fetch(`${this.apiUrl}/api/citizens/${citizenId}`);
    if (res.status === 404) return null;
    return res.json() as Promise<Record<string, unknown>>;
  }

  async getEvents(since: number = 0): Promise<Record<string, unknown>> {
    return this.get(`/api/events?since=${since}`);
  }

  private async post(path: string, body: Record<string, unknown>): Promise<ActionResult> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<ActionResult>;
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.apiUrl}${path}`);
    return res.json() as Promise<Record<string, unknown>>;
  }
}
