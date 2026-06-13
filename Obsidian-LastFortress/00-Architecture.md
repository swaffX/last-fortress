# Last Fortress Architecture

**Analyzed:** 2026-06-13T14:17:26.613Z

## Layers

### Simulation Core
Deterministic game simulation engine running at 20 Hz, orchestrating world state, entity interactions, inventory, building placement, crafting, and combat calculations shared across server and client

- [[index.ts]]
- [[sim.ts]]
- [[types.ts]]
- [[constants.ts]]
- [[inventory.ts]]
- [[grid.ts]]
- [[combat.ts]]
- [[snapshot.ts]]

### World Generation
Procedural map generation using seeded randomization to create biomes, terrain, resources, rivers, and decorative elements for deterministic world replication

- [[mapgen.ts]]
- [[regions.ts]]
- [[river.ts]]
- [[decor.ts]]
- [[rng.ts]]

### Game Content
Game balance data defining items, crafting recipes, buildings, and skill progression systems used by simulation and UI layers

- [[items.ts]]
- [[recipes.ts]]
- [[buildings.ts]]
- [[skills.ts]]

### Server Networking
WebSocket server, room management, client-server protocol, lobby matchmaking, and message routing for multiplayer synchronization

- [[index.ts]]
- [[room.ts]]
- [[lobby.ts]]
- [[protocol.ts]]

### Server Persistence
Authentication via JWT tokens, player profile management, world state snapshots, and database abstraction with PostgreSQL or in-memory fallback

- [[auth.ts]]
- [[db.ts]]
- [[world-store.ts]]

### Client Renderer
Three.js-based 3D rendering pipeline with procedural model generation, terrain rendering, visual effects, particles, and post-processing

- [[scene.ts]]
- [[world.ts]]
- [[environment.ts]]
- [[models.ts]]
- [[effects.ts]]

### Client Frontend
Player-facing UI including HUD, character screen, inventory, crafting panels, navigation screens, plus input handling, audio synthesis, and WebSocket networking

- [[main.ts]]
- [[net.ts]]
- [[input.ts]]
- [[audio.ts]]
- [[index.html]]
- [[style.css]]
- [[hud.ts]]
- [[screens.ts]]
- [[character.ts]]
- [[craft.ts]]
- [[inventory.ts]]

### Build Configuration
Build system configuration, TypeScript settings, package definitions, and development tooling for all packages

- [[package.json]]
- [[package.json]]
- [[tsconfig.json]]
- [[package.json]]
- [[tsconfig.json]]
- [[package.json]]
- [[tsconfig.json]]
- [[vite.config.ts]]
- [[vitest.config.ts]]

### Infrastructure
Containerization, deployment orchestration, reverse proxy configuration, and deployment automation scripts

- [[Dockerfile]]
- [[docker-compose.yml]]
- [[Caddyfile]]
- [[.env.example]]
- [[deploy-vps.mjs]]
- [[diag.mjs]]
- [[fix-port.mjs]]

### Testing
Test suite and test infrastructure for the shared simulation core, ensuring game mechanics are deterministic and reproducible

- [[smoke.test.ts]]
- [[rng.test.ts]]

### Documentation
Project documentation, specifications, and development plans for architecture, design, and implementation phases

- [[README.md]]
- [[CLAUDE.md]]
- [[prompt.md]]
- [[2026-06-12-phase1-sim-core.md]]
- [[2026-06-13-phase0-survival-core.md]]
- [[2026-06-13-phase1-crafting.md]]
- [[2026-06-12-last-fortress-design.md]]
- [[2026-06-13-phase1-crafting-design.md]]
- [[2026-06-13-survival-conversion-design.md]]

