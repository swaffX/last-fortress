# Last Fortress

Browser-based multiplayer co-op survival tower defense. Defend the castle against
endless zombie waves: gather by day, build and upgrade defenses, survive the night.
Solo or 2-player co-op via party codes.

## Stack

- **`packages/shared`** — deterministic game simulation (TypeScript, 20 Hz tick).
  Runs on the server as the source of truth.
- **`packages/server`** — authoritative Node.js WebSocket server: lobbies, party
  codes, per-room sim loop, anonymous device-token auth, Postgres profiles
  (in-memory fallback for local dev).
- **`packages/client`** — Vite + Three.js 2.5D renderer (tilted orthographic
  camera, procedural low-poly models), HTML/CSS HUD, procedural WebAudio.

## Development

```bash
npm install

# terminal 1 — game server on :8080 (in-memory profiles, no DB needed)
npm run dev -w packages/server

# terminal 2 — client with HMR on :5173 (proxies /ws to :8080)
npm run dev -w packages/client
```

Open http://localhost:5173. For co-op, open a second browser (or incognito) tab,
host a lobby in one and join with the party code in the other.

## Production

```bash
cp .env.example .env        # set DB_PASSWORD and TOKEN_SECRET
# set your domain in Caddyfile
docker compose up -d --build
```

Caddy terminates TLS and proxies to the game server; Postgres persists player
profiles (skill tree, stats). Single-command deploy on any VPS with Docker.

## Controls

| Input | Action |
|---|---|
| WASD / arrows | Move |
| Left click (hold) | Attack / gather (near trees & rocks) |
| 1–9 or build bar | Select building, click to place |
| R | Rotate placement preview |
| Click building | Select → upgrade / demolish |
| U | Upgrade selected building |
| K | Skill tree |
| Alt+Click | Ping for teammates |
| Esc | Cancel placement / deselect |

## Verification

```bash
npm run typecheck        # all packages
npm test                 # vitest suites (shared sim)
npm run build -w packages/client
```
