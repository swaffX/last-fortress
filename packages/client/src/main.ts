import './style.css';
import * as THREE from 'three';
import { riverParams, generateDecor, BUILDINGS } from '@lf/shared';
import { Net, type ServerMsg, type ProfileView, type BuildingView, type NodeView } from './net';
import { Stage } from './render/scene';
import { World } from './render/world';
import { Effects } from './render/effects';
import { Environment } from './render/environment';
import { Audio } from './audio';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';
import { Input } from './input';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas);
const world = new World(stage.scene);
const effects = new Effects(stage.scene, stage);
const audio = new Audio();
const hud = new Hud();
const screens = new Screens();
const input = new Input(stage, canvas);
const net = new Net();

let profile: ProfileView | null = null;
let env: Environment | null = null;
let inGame = false;
let lastFrameBuildings: BuildingView[] = [];
let lastNodes: NodeView[] = [];
let selfId = -1;
// gathering progress: node id → { remaining, total, lastHitAt }
const nodeProgress = new Map<number, { remaining: number; total: number; lastHitAt: number }>();

// ---- wiring: screens → net ----
screens.onCreate = (klass, solo) => { audio.unlock(); net.send({ t: 'create_lobby', klass, solo }); };
screens.onJoin = (code, klass) => { audio.unlock(); net.send({ t: 'join_lobby', code, klass }); };
screens.onStart = () => net.send({ t: 'start_game' });
screens.onUnlockSkill = id => net.send({ t: 'unlock_skill', skillId: id });
screens.onPlayAgain = () => location.reload();
screens.onRestartVote = () => net.send({ t: 'restart_vote' });
screens.onMainMenu = () => { net.send({ t: 'leave' }); screens.menu(profile); };
hud.onVote = option => net.send({ t: 'vote', option });

// ---- wiring: hud/input → net ----
hud.onBuildSelect = type => input.setBuildType(type);
hud.onUpgrade = id => net.send({ t: 'cmd', cmd: { kind: 'upgrade', buildingId: id } });
hud.onDemolish = id => {
  net.send({ t: 'cmd', cmd: { kind: 'demolish', buildingId: id } });
  hud.selectBuilding(null);
};
input.send = cmd => net.send({ t: 'cmd', cmd });
input.ping = pos => net.send({ t: 'ping', pos });
input.onBuildCancel = () => hud.clearBuild();
hud.onToolUpgrade = tool => net.send({ t: 'upgrade_tool', tool });
input.onSelectAt = cell => {
  const b = lastFrameBuildings.find(bb => {
    const s = bb.type === 'castle' ? 4 : 2;
    return cell.x >= bb.pos.x && cell.x < bb.pos.x + s &&
           cell.y >= bb.pos.y && cell.y < bb.pos.y + s;
  }) ?? lastFrameBuildings.find(bb =>
    cell.x === bb.pos.x && cell.y === bb.pos.y);
  hud.selectBuilding(b ?? null);
};

// ---- net → everything ----
net.on((msg: ServerMsg) => {
  switch (msg.t) {
    case 'welcome':
      profile = msg.profile;
      hud.setTools(profile.tools);
      if (!inGame) screens.menu(profile);
      break;
    case 'profile':
      profile = msg.profile;
      hud.setTools(profile.tools);
      if (!inGame) screens.menu(profile);
      else hud.notify(`🔧 Tool upgraded`);
      break;
    case 'lobby':
      screens.lobby(msg.code, msg.players, msg.host);
      break;
    case 'game_start':
      inGame = true;
      selfId = msg.selfId;
      world.reset();
      world.selfId = msg.selfId;
      world.setSeed(msg.seed);
      input.riverP = riverParams(msg.seed);
      {
        const decorList = generateDecor(msg.seed, riverParams(msg.seed),
          msg.nodes.map(n => ({ pos: n.pos })));
        world.decor = decorList;
        input.decor = decorList;
      }
      hud.hideChoice();
      lastNodes = msg.nodes;
      world.setNodes(msg.nodes);
      input.nodes = msg.nodes;
      nodeProgress.clear();
      for (const n of msg.nodes) {
        nodeProgress.set(n.id, { remaining: n.amount, total: n.amount, lastHitAt: 0 });
      }
      env?.dispose();
      env = new Environment(stage.scene, msg.seed, msg.nodes);
      hud.initMinimapTerrain(msg.seed, msg.nodes);
      screens.clear();
      hud.show();
      hud.banner('The Watch Begins', false);
      audio.setPhase('day');
      break;
    case 'frame': {
      lastFrameBuildings = msg.buildings;
      input.buildings = msg.buildings;
      world.colliders = { buildings: msg.buildings, nodes: lastNodes };
      // node depletion: drop rendered nodes the sim no longer reports via gather
      world.applyFrame(msg.players, msg.enemies, msg.buildings, msg.projectiles);
      for (const e of msg.events) {
        if (e.kind === 'projectile') world.aimTower(e.from, e.to);
        if (e.kind === 'melee') world.lungePlayerAt(e.pos.x, e.pos.y);
        if (e.kind === 'gather') {
          world.gatherSwing(e.pos.x, e.pos.y, e.resource);
          effects.gatherHit(e.pos.x, e.pos.y, e.resource);
          const np = nodeProgress.get(e.nodeId);
          if (np) { np.remaining = e.remaining; np.lastHitAt = performance.now(); }
        }
        if (e.kind === 'node_depleted') {
          const wasTree = lastNodes.find(n => n.id === e.nodeId)?.kind ?? 'tree';
          world.breakNode(e.nodeId, wasTree);
          effects.nodeBreak(e.pos.x + 0.5, e.pos.y + 0.5, wasTree);
          if (wasTree === 'tree') audio.treeFall(); else audio.rockBreak();
          lastNodes = lastNodes.filter(n => n.id !== e.nodeId);
          input.nodes = lastNodes;
          hud.removeMinimapNode(e.nodeId);
          nodeProgress.delete(e.nodeId);
        }
      }
      effects.handle(msg.events);
      audio.handle(msg.events);
      audio.setPhase(msg.phase);
      stage.setNight(msg.phase === 'night');
      stage.setGameTick(msg.tick);
      const castle = msg.buildings.find(b => b.type === 'castle');
      hud.updateFrame(msg.wave, msg.phase, msg.phaseTicks, msg.resources,
        msg.players, msg.enemies, msg.buildings, castle?.tier ?? 1, selfId);
      hud.handleEvents(msg.events, project);
      break;
    }
    case 'ping': {
      hud.notify(`📍 ${msg.from} pinged`);
      break;
    }
    case 'chat':
      hud.addChat(msg.from, msg.text);
      break;
    case 'latency':
      lastPing = Math.round(performance.now() - msg.n);
      break;
    case 'ghost':
      world.setRemoteGhost(msg.type, msg.pos, msg.ok);
      break;
    case 'choice_offer':
      hud.showChoiceDelayed(msg.options);   // waits out the dawn banner
      break;
    case 'choice_state':
      hud.updateChoiceVotes(msg.votes);
      break;
    case 'choice_applied':
      hud.hideChoice();
      hud.notify(`⚜ ${msg.option.name} — ${msg.option.desc}`);
      break;
    case 'game_over':
      inGame = false;
      hud.hide();
      hud.hideChoice();
      screens.gameOver(msg.wave, msg.coinsEarned, msg.skillPointsEarned);
      break;
    case 'restart_state':
      screens.setRestartVotes(msg.votes, msg.needed);
      break;
    case 'lobby_closed':
      inGame = false;
      hud.hide();
      screens.menu(profile);
      break;
    case 'error':
      screens.toast(msg.message);
      break;
  }
});

function project(x: number, y: number): { x: number; y: number } | null {
  const v = new THREE.Vector3(x, 1, y).project(stage.camera);
  if (v.z > 1) return null;
  return { x: (v.x + 1) / 2 * innerWidth, y: (-v.y + 1) / 2 * innerHeight };
}

// ---- footsteps: prints + dust trail + sfx ----
world.onStep = (x, z, heading, side, isSelf) => {
  effects.footprint(x, z, heading, side);
  effects.trail(x - Math.sin(heading) * 0.3, z - Math.cos(heading) * 0.3);
  audio.footstep(isSelf);
};
hud.onChat = text => net.send({ t: 'chat', text });

// ---- loops ----
setInterval(() => { if (inGame) input.tick(); }, 50);

// latency probe + teammate ghost sync
let lastPing: number | null = null;
setInterval(() => {
  if (!inGame) return;
  net.send({ t: 'latency', n: performance.now() });
}, 2000);
let lastGhostSent = '';
setInterval(() => {
  if (!inGame) return;
  const type = input.activeType;
  const cell = input.ghostCell ?? { x: 0, y: 0 };
  const key = type ? `${type}:${cell.x},${cell.y}:${input.ghostOk}` : 'null';
  if (key === lastGhostSent) return;
  lastGhostSent = key;
  net.send({ t: 'ghost', type, pos: cell, ok: input.ghostOk });
}, 120);

addEventListener('keydown', e => {
  if (!inGame) return;
  // chat handling first — input field swallows everything else
  if (hud.chatOpen) {
    if (e.key === 'Enter') hud.closeChat(true);
    if (e.key === 'Escape') hud.closeChat(false);
    return;
  }
  if (e.key === 'Enter') { hud.openChat(); e.preventDefault(); return; }
  if (e.target instanceof HTMLInputElement) return;
  if (e.key.toLowerCase() === 'e') net.send({ t: 'cmd', cmd: { kind: 'gather' } });
  if (e.key.toLowerCase() === 'b') hud.toggleBuildMenu();
  if (e.key === 'Escape') { hud.clearBuild(); hud.selectBuilding(null); hud.toggleBuildMenu(false); }
  if (e.key.toLowerCase() === 'k' && profile) screens.skillTree(profile, true);
  if (e.key.toLowerCase() === 'u' && hud.selected !== null) {
    net.send({ t: 'cmd', cmd: { kind: 'upgrade', buildingId: hud.selected } });
  }
});

canvas.addEventListener('wheel', e => {
  if (!inGame) return;
  e.preventDefault();
  stage.zoomBy(e.deltaY * 0.01);
}, { passive: false });

let last = performance.now();
let fpsAccum = 0, fpsCount = 0, fpsTimer = 0;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // fps counter (1 s window)
  fpsAccum += dt; fpsCount++;
  fpsTimer += dt;
  if (fpsTimer >= 1) {
    hud.setPerf(Math.round(fpsCount / fpsAccum), lastPing);
    fpsAccum = 0; fpsCount = 0; fpsTimer = 0;
  }
  if (inGame) {
    const d = input.dir;
    world.setSelfDir(d.x, d.y);
  }
  world.render(dt);
  // camera follows the predicted self position every display frame (no tick stutter)
  const selfPos = world.positionOf(selfId);
  if (selfPos) {
    stage.setFollow(selfPos.x, selfPos.z);
    // gather prompt + golden ring on the node E would hit
    if (inGame) {
      let near: NodeView | null = null;
      let nd = 2.2;
      for (const n of lastNodes) {
        const d = Math.hypot(n.pos.x + 0.5 - selfPos.x, n.pos.y + 0.5 - selfPos.z);
        if (d <= nd) { nd = d; near = n; }
      }
      if (near) {
        const np = nodeProgress.get(near.id);
        const channeling = np && performance.now() - np.lastHitAt < 900;
        if (channeling && np) {
          hud.showPrompt(near.kind === 'tree' ? '🪓 Chopping…' : '⛏ Mining…',
            1 - np.remaining / np.total);
        } else {
          hud.showPrompt(`[E] ${near.kind === 'tree' ? '🪓 Chop wood' : '⛏ Mine stone'}`);
        }
      } else {
        hud.showPrompt(null);
      }
      world.highlightNode(near?.id ?? null);

      // hover affordance on placed buildings (outside build mode)
      if (!input.activeType) {
        const w = stage.screenToWorld(input.cursor.x, input.cursor.y);
        const cell = { x: Math.floor(w.x), y: Math.floor(w.y) };
        const hovered = lastFrameBuildings.find(b => {
          const s = b.type === 'castle' ? 4 : BUILDINGS[b.type].size;
          return cell.x >= b.pos.x && cell.x < b.pos.x + s &&
                 cell.y >= b.pos.y && cell.y < b.pos.y + s;
        }) ?? null;
        world.setHover(hovered);
        document.body.style.cursor = hovered ? 'pointer' : '';
      } else {
        world.setHover(null);
        document.body.style.cursor = '';
      }

      // keep the selection panel pinned above its building
      if (hud.selected !== null) {
        const b = lastFrameBuildings.find(bb => bb.id === hud.selected);
        if (b) {
          const s = BUILDINGS[b.type].size;
          hud.moveSelPanel(project(b.pos.x + s / 2, b.pos.y));
        } else {
          hud.selectBuilding(null);   // destroyed while selected
        }
      }
    }
  }
  effects.update(dt);
  env?.update(dt);
  input.updateGhost();
  stage.update(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

net.connect();
void lastNodes; // retained for future node-depletion sync
