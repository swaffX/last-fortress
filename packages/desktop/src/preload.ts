import { contextBridge } from 'electron';
import { SERVER_WS } from './config';

// Expose the VDS server URL so the client's net.ts connects to it instead of
// same-origin (which, under file://, is not the game server).
contextBridge.exposeInMainWorld('__LF_SERVER__', SERVER_WS);

contextBridge.exposeInMainWorld('__LF_DESKTOP__', {
  version: process.env.npm_package_version || '0.1.0',
  platform: process.platform,
});
