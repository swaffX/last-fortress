import { STEAM_APP_ID } from '../config';

/**
 * Steamworks seam — a no-op until Phase B. When an App ID is configured and
 * `steamworks.js` is added, this initialises the SDK (overlay, achievements,
 * later Workshop). With no App ID it returns false so the app runs unchanged.
 */
export function initSteam(): boolean {
  if (!STEAM_APP_ID) return false;
  // Phase B:
  //   const steamworks = require('steamworks.js');
  //   const client = steamworks.init(Number(STEAM_APP_ID));
  //   steamworks.electronEnableSteamOverlay();
  //   return true;
  console.warn('[steam] App ID set but steamworks.js not wired yet (Phase B).');
  return false;
}
