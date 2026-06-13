import pg from 'pg';
import { serializeState, deserializeState, type SimState } from '@lf/shared';

/** One persisted world per party id, plus device→playerId bindings. */
export interface WorldRecord {
  state: SimState;
  bindings: Record<string, number>;   // deviceId → playerId
}

export interface WorldStore {
  load(partyId: string): Promise<WorldRecord | null>;
  save(partyId: string, rec: WorldRecord): Promise<void>;
  delete(partyId: string): Promise<void>;
}

class PgWorldStore implements WorldStore {
  constructor(private pool: pg.Pool) {}
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS worlds (
        party_id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        bindings JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }
  async load(partyId: string): Promise<WorldRecord | null> {
    const r = await this.pool.query('SELECT state, bindings FROM worlds WHERE party_id = $1', [partyId]);
    if (r.rows.length === 0) return null;
    try {
      return {
        state: deserializeState(JSON.stringify(r.rows[0].state)),
        bindings: r.rows[0].bindings as Record<string, number>,
      };
    } catch {
      return null;   // corrupt / migrated → caller generates fresh
    }
  }
  async save(partyId: string, rec: WorldRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO worlds (party_id, state, bindings, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (party_id) DO UPDATE SET state = $2, bindings = $3, updated_at = now()`,
      [partyId, serializeState(rec.state), JSON.stringify(rec.bindings)]);
  }
  async delete(partyId: string): Promise<void> {
    await this.pool.query('DELETE FROM worlds WHERE party_id = $1', [partyId]);
  }
}

class MemoryWorldStore implements WorldStore {
  private map = new Map<string, string>();   // store serialized to mimic round-trip
  async load(partyId: string): Promise<WorldRecord | null> {
    const raw = this.map.get(partyId);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return { state: deserializeState(o.state), bindings: o.bindings };
  }
  async save(partyId: string, rec: WorldRecord): Promise<void> {
    this.map.set(partyId, JSON.stringify({ state: serializeState(rec.state), bindings: rec.bindings }));
  }
  async delete(partyId: string): Promise<void> { this.map.delete(partyId); }
}

export async function createWorldStore(pool: pg.Pool | null): Promise<WorldStore> {
  if (pool) { const s = new PgWorldStore(pool); await s.init(); return s; }
  return new MemoryWorldStore();
}
