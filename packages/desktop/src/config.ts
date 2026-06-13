/**
 * Desktop configuration. The game server lives on the VDS; override with the
 * LF_SERVER env var for local testing (e.g. LF_SERVER=localhost:8080).
 */
export const SERVER_HOST: string = process.env.LF_SERVER || '212.180.120.69';

/** Full WebSocket URL the renderer connects to (scheme added if absent). */
export const SERVER_WS: string =
  /^wss?:\/\//.test(SERVER_HOST) ? SERVER_HOST : `ws://${SERVER_HOST}/ws`;

/** Set in Phase B once a Steam App ID exists; empty disables Steamworks. */
export const STEAM_APP_ID: string = process.env.LF_STEAM_APP_ID || '';
