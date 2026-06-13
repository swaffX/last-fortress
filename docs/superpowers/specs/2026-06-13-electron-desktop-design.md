# Electron Desktop Shell — Design (Phase A)

**Date:** 2026-06-13
**Status:** Approved
**Builds on:** the existing Vite/Three.js client + the VDS WebSocket server.

Convert Last Fortress into a desktop app developed and shipped via Electron, connecting to
the VDS game server, structured so a Steam/Steamworks/Workshop layer can be added later. This
spec covers **Phase A only**: the Electron shell + configurable server connection + dev/build
workflow + Windows packaging. Steamworks SDK, Steam Workshop, and Steam depot deploy are
**deferred** (they need a Steam partner account + App ID, which the owner will get later).

---

## Locked Decisions

| Decision | Choice |
|---|---|
| Shell | Electron wraps the existing client renderer; main process owns the window + lifecycle. |
| Server | **VDS only, always online** — no embedded local server, no offline mode. |
| Server URL | Configurable: desktop build targets the VDS WS; the browser build stays same-origin. |
| Steamworks / Workshop | **Deferred** — leave a clean seam (`steam/` placeholder + config) to add `steamworks.js` once an App ID exists. |
| Packaging | electron-builder, Windows target (NSIS installer + portable); Steam build target added in Phase C. |
| Dev | `electron` loads the live Vite dev server (hot reload); prod loads the built client. |

---

## Architecture

A new `packages/desktop/` workspace holds the Electron **main** + **preload** processes. The
renderer is the existing `@lf/client` build (or its dev server). The renderer connects to the
game over WebSocket exactly as today; the only change in the client is making the server origin
configurable instead of hard-coded to `location.host`.

```
packages/
  shared/   (sim)
  server/   (runs on the VDS — unchanged)
  client/   (renderer — one small net.ts change)
  desktop/  (NEW: Electron main + preload + builder config)
```

Data flow: `desktop main` creates a `BrowserWindow` → loads the client → client opens
`ws://<VDS>/ws` → same authoritative server the browser players use. Browser play keeps working
(the VDS Node server still serves the web build + WS).

---

## Components

### 1. Configurable server origin (`packages/client/src/net.ts`)

Today: `new WebSocket(\`${proto}://${location.host}/ws\`)`. Replace the host resolution with a
helper that prefers, in order:
1. `window.__LF_SERVER__` (injected by the Electron preload at runtime),
2. `import.meta.env.VITE_SERVER_URL` (baked at build time),
3. `location.host` (browser same-origin default).

When the resolved value already includes a scheme (`ws://…`/`wss://…`) it is used verbatim;
otherwise the proto is derived from `location.protocol`. This keeps the browser build identical
and lets the desktop point at the VDS.

### 2. Electron main (`packages/desktop/src/main.ts`)

- Create a `BrowserWindow` (1280×800 default, resizable, dark background, app icon, no menu bar
  in prod, fullscreen toggle on F11).
- **Dev**: load `process.env.LF_DEV_URL` (the Vite dev server, default `http://localhost:5173`);
  open devtools.
- **Prod**: load the packaged client `index.html` from the app resources.
- Standard lifecycle: quit on all-windows-closed (except macOS), single-instance lock, external
  links open in the OS browser (never in-app).
- Security: `contextIsolation: true`, `nodeIntegration: false`, a strict preload, and a CSP that
  permits the VDS WS origin.

### 3. Preload (`packages/desktop/src/preload.ts`)

`contextBridge.exposeInMainWorld('__LF_DESKTOP__', { version, platform })` and inject
`window.__LF_SERVER__` from the desktop config (the VDS address). No Node APIs leak to the
renderer.

### 4. Desktop config (`packages/desktop/config.ts` or env)

The VDS server address lives in one place (`LF_SERVER` env / a `config.ts` constant, default
`212.180.120.69`). The preload reads it and sets `window.__LF_SERVER__ = 'ws://<addr>/ws'`.
Overridable at runtime via env for staging.

### 5. Build + packaging (`packages/desktop/package.json` + electron-builder)

- `dev`: run the client Vite dev server and Electron together (`concurrently` + `wait-on`).
- `build`: `vite build` the client (with `VITE_SERVER_URL` for the VDS) → compile main/preload
  (esbuild/tsc) → `electron-builder` packages a Windows NSIS installer + portable exe, bundling
  the client `dist`.
- electron-builder config: appId `com.swaffx.lastfortress`, productName "Last Fortress",
  Windows target, icon, and a `files`/`extraResources` mapping that includes the client `dist`
  and (later) the GLB assets.

### 6. Steam seam (deferred, structured now)

A `packages/desktop/src/steam/` folder with a no-op `steam.ts` (`initSteam()` returns a stub)
and a `STEAM_APP_ID` config slot. Phase B swaps the stub for `steamworks.js`. Nothing in Phase A
imports a real Steam binding, so the app builds and runs without an App ID.

---

## Error handling & edge cases

- **VDS unreachable**: the client already auto-reconnects (1.5 s backoff); the desktop shows the
  menu/connecting state. A small "connecting to server…" indication is acceptable (existing
  reconnect logic).
- **Dev server not up**: Electron `did-fail-load` → retry loading `LF_DEV_URL` after a short
  delay so `npm run dev` ordering doesn't matter.
- **External links**: intercept `window.open`/navigation to non-app origins → `shell.openExternal`.
- **Single instance**: second launch focuses the existing window.
- **Web build untouched**: with no `__LF_SERVER__`/`VITE_SERVER_URL`, `net.ts` falls back to
  same-origin, so the VDS-hosted browser version is byte-for-byte unaffected.

---

## Out of scope (later phases)

- Steamworks SDK integration (init/overlay/achievements) — Phase B (needs App ID).
- Steam Workshop UGC (upload/download) — later (content type TBD).
- Steam depot/steamcmd deploy — Phase C (needs partner account).
- Embedded local server / offline solo (explicitly declined — VDS only).
- macOS/Linux packaging (Windows-first for Steam).

## Testing

Per standing instruction, tests are written only when explicitly requested. Verify with: client
`tsc` + `vite build` (web unaffected), desktop `tsc` for main/preload, and a manual launch:
`npm run -w @lf/desktop dev` opens the window, loads the game, and connects to the VDS (or a
local server during testing via `LF_SERVER`). Confirm the browser build still connects
same-origin.
