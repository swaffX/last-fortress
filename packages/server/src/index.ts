import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { decode, encode } from './protocol';
import { issueToken, verifyToken } from './auth';
import { createStore, tryUnlockSkill, type Profile } from './db';
import { LobbyManager } from './lobby';
import type { Room } from './room';

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIST = process.env.CLIENT_DIST ??
  join(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

async function main() {
  const store = await createStore();
  const lobbies = new LobbyManager(store);

  const http = createServer(async (req, res) => {
    // static client serving with SPA fallback
    try {
      const urlPath = (req.url ?? '/').split('?')[0]!;
      let filePath = normalize(join(CLIENT_DIST, urlPath === '/' ? 'index.html' : urlPath));
      if (!filePath.startsWith(normalize(CLIENT_DIST))) { res.writeHead(403).end(); return; }
      try { await stat(filePath); } catch { filePath = join(CLIENT_DIST, 'index.html'); }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  const wss = new WebSocketServer({ server: http, path: '/ws' });

  interface Conn { profile: Profile | null; room: Room | null; }
  const conns = new Map<WebSocket, Conn>();

  wss.on('connection', ws => {
    conns.set(ws, { profile: null, room: null });

    ws.on('message', async raw => {
      const conn = conns.get(ws);
      if (!conn) return;
      const msg = decode(raw.toString());
      if (!msg) return;

      switch (msg.t) {
        case 'hello': {
          let deviceId = msg.token ? verifyToken(msg.token) : null;
          let token = msg.token ?? '';
          if (!deviceId) { const issued = issueToken(); deviceId = issued.deviceId; token = issued.token; }
          conn.profile = await store.get(deviceId);
          ws.send(encode({ t: 'welcome', token, profile: conn.profile }));
          break;
        }
        case 'create_lobby': {
          if (conn.room && !conn.room.hasWs(ws)) conn.room = null;   // lobby dissolved earlier
          if (!conn.profile || conn.room) return;
          conn.room = lobbies.createRoom(msg.solo);
          conn.room.addPlayer(ws, conn.profile, msg.klass);
          if (msg.solo) conn.room.handleStart(ws);
          break;
        }
        case 'join_lobby': {
          if (conn.room && !conn.room.hasWs(ws)) conn.room = null;
          if (!conn.profile || conn.room) return;
          const room = lobbies.findJoinable(msg.code, conn.profile.deviceId);
          if (!room) { ws.send(encode({ t: 'error', message: 'Lobby not found or full' })); return; }
          conn.room = room;
          room.addPlayer(ws, conn.profile, msg.klass);
          break;
        }
        case 'start_game': conn.room?.handleStart(ws); break;
        case 'cmd': conn.room?.handleCommand(ws, msg.cmd); break;
        case 'ping': conn.room?.handlePing(ws, msg.pos); break;
        case 'vote': conn.room?.handleVote(ws, msg.option); break;
        case 'restart_vote': conn.room?.handleRestartVote(ws); break;
        case 'unlock_skill': {
          if (!conn.profile) return;
          if (tryUnlockSkill(conn.profile, msg.skillId)) {
            await store.save(conn.profile);
            ws.send(encode({ t: 'profile', profile: conn.profile }));
          }
          break;
        }
        case 'leave': {
          conn.room?.handleLeave(ws);
          conn.room = null;
          break;
        }
      }
    });

    ws.on('close', () => {
      const conn = conns.get(ws);
      conn?.room?.handleDisconnect(ws);
      conns.delete(ws);
    });
    ws.on('error', () => { /* close handler does the cleanup */ });
  });

  http.listen(PORT, () => {
    console.log(`[server] listening on :${PORT} (client dist: ${CLIENT_DIST})`);
  });
}

void main();
