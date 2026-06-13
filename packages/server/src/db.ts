import pg from 'pg';
import { SKILLS } from '@lf/shared';
import type { ProfileView } from './protocol';

export interface Profile extends ProfileView { deviceId: string; }

export interface ProfileStore {
  get(deviceId: string): Promise<Profile>;
  save(profile: Profile): Promise<void>;
}

function freshProfile(deviceId: string): Profile {
  return {
    deviceId,
    name: `Survivor-${deviceId.slice(0, 4)}`,
    skillPoints: 0,
    unlockedSkills: [],
    bestWave: 0,
    totalKills: 0,
    gamesPlayed: 0,
  };
}

/** Create the shared pg pool once, or null when DATABASE_URL is unset. */
export function createPool(): pg.Pool | null {
  const url = process.env.DATABASE_URL;
  return url ? new pg.Pool({ connectionString: url }) : null;
}

/** Postgres-backed store. Used when DATABASE_URL is set (production). */
class PgStore implements ProfileStore {
  constructor(private pool: pg.Pool) {}

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        device_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }
  async get(deviceId: string): Promise<Profile> {
    const r = await this.pool.query('SELECT data FROM profiles WHERE device_id = $1', [deviceId]);
    if (r.rows.length === 0) return freshProfile(deviceId);
    return { ...freshProfile(deviceId), ...r.rows[0].data, deviceId };
  }
  async save(p: Profile): Promise<void> {
    await this.pool.query(
      `INSERT INTO profiles (device_id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (device_id) DO UPDATE SET data = $2, updated_at = now()`,
      [p.deviceId, JSON.stringify(p)]);
  }
}

/** In-memory store for local development without a database. */
class MemoryStore implements ProfileStore {
  private map = new Map<string, Profile>();
  async get(deviceId: string): Promise<Profile> {
    return this.map.get(deviceId) ?? freshProfile(deviceId);
  }
  async save(p: Profile): Promise<void> { this.map.set(p.deviceId, p); }
}

export async function createStore(pool: pg.Pool | null): Promise<ProfileStore> {
  if (pool) {
    const store = new PgStore(pool);
    await store.init();
    console.log('[db] using postgres');
    return store;
  }
  console.log('[db] DATABASE_URL not set — using in-memory profile store');
  return new MemoryStore();
}

/** Server-side validation of a skill unlock. Returns true if applied. */
export function tryUnlockSkill(profile: Profile, skillId: string): boolean {
  const def = SKILLS.find(s => s.id === skillId);
  if (!def) return false;
  if (profile.unlockedSkills.includes(skillId)) return false;
  if (profile.skillPoints < def.cost) return false;
  profile.skillPoints -= def.cost;
  profile.unlockedSkills.push(skillId);
  return true;
}
