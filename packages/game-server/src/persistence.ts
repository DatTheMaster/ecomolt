import Database from "better-sqlite3";
import { serializeSeasonState, deserializeSeasonState, type SeasonState } from "@ecomolt/simulation-core";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface PersistenceConfig {
  dbPath: string;
  archiveDir: string;
}

export const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
  dbPath: "./data/ecomolt.db",
  archiveDir: "./data/archives",
};

export class Persistence {
  private db: Database.Database;
  private archiveDir: string;

  constructor(config: Partial<PersistenceConfig> = {}) {
    const cfg = { ...DEFAULT_PERSISTENCE_CONFIG, ...config };
    this.archiveDir = cfg.archiveDir;

    const dir = dirname(cfg.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(this.archiveDir)) mkdirSync(this.archiveDir, { recursive: true });

    this.db = new Database(cfg.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS live_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        season_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS season_archive (
        season_id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        state_json TEXT NOT NULL,
        result TEXT NOT NULL,
        day INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        archived_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS handler_accounts (
        handler_id TEXT PRIMARY KEY,
        registration_code TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        citizen_ids TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_log (
        season_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY (season_id, timestamp, type)
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_season_day ON event_log(season_id, day);
    `);
  }

  saveLiveState(state: SeasonState): void {
    const json = serializeSeasonState(state);
    const now = Date.now();
    const upsert = this.db.prepare(`
      INSERT INTO live_state (id, season_id, state_json, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET season_id = excluded.season_id, state_json = excluded.state_json, updated_at = excluded.updated_at
    `);
    upsert.run(state.id, json, now);
  }

  loadLiveState(): SeasonState | null {
    const row = this.db.prepare("SELECT state_json FROM live_state WHERE id = 1").get() as { state_json: string } | undefined;
    if (!row) return null;
    return deserializeSeasonState(row.state_json);
  }

  clearLiveState(): void {
    this.db.prepare("DELETE FROM live_state WHERE id = 1").run();
  }

  archiveSeason(state: SeasonState): void {
    const json = serializeSeasonState(state);
    const now = Date.now();
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO season_archive (season_id, config_json, state_json, result, day, event_count, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(state.id, JSON.stringify(state.config), json, state.result, state.day, state.eventLog.length, now);

    this.persistEventLog(state);
    this.clearLiveState();
  }

  getSeasonArchive(seasonId: string): SeasonState | null {
    const row = this.db.prepare("SELECT state_json FROM season_archive WHERE season_id = ?").get(seasonId) as { state_json: string } | undefined;
    if (!row) return null;
    return deserializeSeasonState(row.state_json);
  }

  listArchivedSeasons(): Array<{ season_id: string; result: string; day: number; event_count: number; archived_at: number }> {
    return this.db.prepare("SELECT season_id, result, day, event_count, archived_at FROM season_archive ORDER BY archived_at DESC").all() as Array<{ season_id: string; result: string; day: number; event_count: number; archived_at: number }>;
  }

  persistEventLog(state: SeasonState): void {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO event_log (season_id, day, timestamp, type, data_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const batch = this.db.transaction((entries: Array<{ day: number; timestamp: number; type: string; data: Record<string, unknown> }>) => {
      for (const e of entries) {
        insert.run(state.id, e.day, e.timestamp, e.type, JSON.stringify(e.data));
      }
    });
    batch(state.eventLog);
  }

  appendEvents(seasonId: string, events: Array<{ day: number; timestamp: number; type: string; data: Record<string, unknown> }>): void {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO event_log (season_id, day, timestamp, type, data_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const batch = this.db.transaction((entries: typeof events) => {
      for (const e of entries) {
        insert.run(seasonId, e.day, e.timestamp, e.type, JSON.stringify(e.data));
      }
    });
    batch(events);
  }

  getEventLog(seasonId: string, sinceDay = 0): Array<{ day: number; timestamp: number; type: string; data: Record<string, unknown> }> {
    const rows = this.db.prepare("SELECT day, timestamp, type, data_json FROM event_log WHERE season_id = ? AND day >= ? ORDER BY timestamp").all(seasonId, sinceDay) as Array<{ day: number; timestamp: number; type: string; data_json: string }>;
    return rows.map(r => ({ day: r.day, timestamp: r.timestamp, type: r.type, data: JSON.parse(r.data_json) as Record<string, unknown> }));
  }

  createHandler(handlerId: string, registrationCode: string, displayName: string): boolean {
    try {
      this.db.prepare("INSERT INTO handler_accounts (handler_id, registration_code, display_name, created_at) VALUES (?, ?, ?, ?)")
        .run(handlerId, registrationCode, displayName, Date.now());
      return true;
    } catch {
      return false;
    }
  }

  getHandlerByCode(registrationCode: string): { handler_id: string; display_name: string; citizen_ids: string } | null {
    return this.db.prepare("SELECT handler_id, display_name, citizen_ids FROM handler_accounts WHERE registration_code = ?")
      .get(registrationCode) as { handler_id: string; display_name: string; citizen_ids: string } | null;
  }

  getHandler(handlerId: string): { handler_id: string; display_name: string; citizen_ids: string } | null {
    return this.db.prepare("SELECT handler_id, display_name, citizen_ids FROM handler_accounts WHERE handler_id = ?")
      .get(handlerId) as { handler_id: string; display_name: string; citizen_ids: string } | null;
  }

  addCitizenToHandler(handlerId: string, citizenId: string, maxCitizens: number): boolean {
    const handler = this.getHandler(handlerId);
    if (!handler) return false;
    const citizens = JSON.parse(handler.citizen_ids) as string[];
    if (citizens.length >= maxCitizens) return false;
    citizens.push(citizenId);
    this.db.prepare("UPDATE handler_accounts SET citizen_ids = ? WHERE handler_id = ?")
      .run(JSON.stringify(citizens), handlerId);
    return true;
  }

  close(): void {
    this.db.close();
  }
}
