# Last Fortress — Phase 1 Design Spec

**Date:** 2026-06-12
**Status:** Approved by user
**Source:** `prompt.md` (full vision), trimmed to a publishable Phase 1.

## Summary

Browser-based multiplayer co-op survival tower defense game. Players (solo or 2-player co-op via party codes) defend a central castle against endless zombie waves: gather resources by day, build and upgrade defenses, survive escalating nights. Authoritative server, 2.5D top-down rendering, production-ready and deployable.

## Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Phased full version; this spec = Phase 1 | Spec too large for one pass; every phase publishable |
| Rendering | Three.js, tilted orthographic camera (2.5D top-down) | Procedural low-poly geometry (no sprite assets), shadows/fog/bloom built in, InstancedMesh for zombie hordes |
| Backend | Node.js + TypeScript, custom WebSocket (uWebSockets.js or ws) | Shared sim code client/server, full control over tick/snapshot/lag-comp, standard .io approach |
| Persistence | Anonymous device token + Postgres profiles | Zero-friction .io onboarding; email linking deferred to Phase 2 |
| Audio | Procedural WebAudio synthesis | No copyright, no asset files; retro-stylized quality accepted |
| Deploy | Docker Compose on single VPS | Server + static client + Postgres; WebSocket-friendly, cheap |

## Phase 1 Scope

### Included

- **Modes:** Solo, 2-player co-op. Private lobbies via party code. Reconnect (60s window).
- **Loop:** Day (build/gather/repair) → Night (waves attack) → repeat. Endless scaling waves; boss every 10th wave.
- **Resources:** Wood, Stone, Gold, Coins. Coins from kills; Wood/Stone/Gold from gathering and economy buildings. Shared team economy.
- **Buildings:**
  - Defense: Wood Wall, Stone Wall, Gate, Spike Barricade
  - Towers: Archer, Crossbow, Bomb, Ice, Lightning
  - Economy: Gold Mine, Wood Camp, Stone Quarry
  - Support: Healing Totem
  - HQ: Castle, levels 1–5; each level unlocks buildings/tiers. Castle destroyed = game over.
- **Upgrades:** Buildings tier I–III; each tier changes stats and visual model.
- **Enemies:** Normal, Fast, Tank, Spitter, Exploding zombies — each with distinct behavior. Boss: Butcher (special attacks, phases, big health bar).
- **Classes:** Knight (melee passive), Hunter (ranged passive). Weapons: Sword, Bow, Crossbow.
- **Skill tree:** 3 branches (Combat, Engineering, Economy), 4–5 nodes each; persists to profile.
- **Wave patterns:** easy / medium / hard / rest / boss mixes; HP and damage scale gradually and infinitely.
- **HUD (HTML/CSS overlay):** wave number, resources, coins, castle HP, minimap, build menu with grid-snap placement preview (green valid / red blocked) and rotation, party panel, ping/map markers, damage numbers, notifications. Blue-orange palette, modern animated UI.
- **Juice:** camera shake (explosions, boss hits), particle effects (explosions, blood, arrow trails, ice shatter, lightning chains), floating damage numbers, hit flash, day-night lighting and fog transitions, procedural SFX (arrows, explosions, coins, growls) and ambient day/night/boss music layers.

### Deferred to Phase 2+

Iron/Crystal resources, remaining towers (Ballista, Catapult, Trebuchet, Magic, Flamethrower, Sniper, Tesla, Mortar, Poison, Laser), remaining traps, remaining enemies and bosses, Mage/Engineer/Support classes, weapon rarity system, Research Lab/Market/Bank/Workshop/Blacksmith, 4-player support, host migration, emotes, revive system, weather, castle levels 6–10, building tiers IV–X, optional email account linking.

## Architecture

Monorepo (npm workspaces), all TypeScript:

```
packages/
  shared/   # deterministic game simulation + binary protocol + balance data
  server/   # Node authoritative server, lobbies, persistence
  client/   # Vite + Three.js renderer, HUD, audio, input
```

### shared/sim

- Deterministic simulation stepped at fixed tick (20 Hz). Component-based entities.
- Managers live here: WaveManager, EnemyManager (AI/pathing), BuildingManager (grid, placement validation), CombatManager (damage, projectiles), EconomyManager (resources, costs).
- Server runs it as source of truth; client runs the same code for prediction/interpolation context.
- All balance data (costs, stats, wave tables) in typed data modules.

### server

- LobbyManager: party code → room; each room owns one sim instance and its tick loop.
- Connection layer: WebSocket, binary delta snapshots out (20 Hz), client inputs in. Input validation and rate limiting; invalid input silently dropped and logged. All damage/economy/build resolved server-side (anti-cheat by construction).
- SaveManager: Postgres via device-token profiles (skill tree, stats, unlocks). Signed token issued on first visit.
- Rooms auto-close when empty. No pause in solo (real-time, .io style).

### client

- NetworkManager: snapshot buffering, entity interpolation, input prediction for own character only.
- Render layer: maps sim state → Three.js scene; instanced meshes for zombies/projectiles; procedural low-poly models per building tier.
- EffectManager: pooled particles, camera shake. AudioManager: WebAudio synthesis. UIManager: HTML/CSS HUD overlay bound to game state.

## Map (Phase 1)

Single fixed square map. Castle at center. Surroundings: forest clusters (wood), stone deposits, a river with bridges, fog zones at edges. Zombie spawn areas around the map border. Night darkens atmosphere progressively.

## Error Handling

- WS disconnect → 60 s reconnect window; player state held in room.
- Invalid/cheating input → silent drop + server log.
- Server crash recovery: rooms are ephemeral (match lost), profiles safe in Postgres.

## Testing

- `shared/sim`: headless unit tests (vitest) — wave scaling, economy math, combat formulas, placement validation, determinism.
- `server`: integration tests — two fake WS clients join via party code, build, survive a wave, resync after reconnect.
- Client: manual verification via `/verify`-style playthrough; type checks in CI for all packages.

## Deployment

Single `docker-compose.yml`: game server (also serves static client build), Postgres. TLS via reverse proxy (Caddy or nginx) on the VPS. One-command deploy.
