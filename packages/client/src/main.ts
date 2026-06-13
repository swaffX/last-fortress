import './style.css';
import * as THREE from 'three';
import { riverParams, generateDecor, CREATURES, BUILDINGS } from '@lf/shared';
import { Net, type ServerMsg, type ProfileView, type BuildingView, type NodeView, type PlayerView } from './net';
import { Stage } from './render/scene';
import { World } from './render/world';
import { Effects } from './render/effects';
import { Environment } from './render/environment';
import { Audio } from './audio';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';
import { createInventoryUI } from './ui/inventory';
import { createCharacterUI } from './ui/character';
import { Input } from './input';
import { preloadAssets } from './render/assets';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas);
const world = new World(stage.scene);
const effects = new Effects(stage.scene, stage);
const audio = new Audio();
const hud = new Hud();
const screens = new Screens();
const inventory = createInventoryUI(
  document.getElementById('hotbar-slot')!, document.getElementById('backpack-slot')!);
const character = createCharacterUI(document.getElementById('character-slot')!);
const input = new Input(stage, canvas);
const net = new Net();

let profile: ProfileView | null = null;
let env: Environment | null = null;
let inGame = false;
let lastFrameBuildings: BuildingView[] = [];

// Tolerate client/server version skew: a stale cached bundle won't know a building
// type a newer server sends, and an unguarded BUILDINGS[type] lookup would crash the
// render + input loop every frame. Drop unknown types and warn once instead.
const warnedBuildingTypes = new Set<string>();
function warnUnknownBuilding(type: string): void {
  if (warnedBuildingTypes.has(type)) return;
  warnedBuildingTypes.add(type);
  console.warn(`[lf] server sent unknown building type "${type}" — this client bundle is ` +
    `stale. Hard-reload (Ctrl+Shift+R) to update.`);
}
let lastNodes: NodeView[] = [];
let selfId = -1;
let selfView: PlayerView | undefined;
// gathering progress: node id → { remaining, total, lastHitAt }
const nodeProgress = new Map<number, { remaining: number; total: number; lastHitAt: number }>();

// ---- wiring: screens → net ----
screens.onCreate = solo => { audio.unlock(); net.send({ t: 'create_lobby', solo }); };
screens.onJoin = code => { audio.unlock(); net.send({ t: 'join_lobby', code }); };
screens.onStart = () => net.send({ t: 'start_game' });
screens.onUnlockSkill = id => net.send({ t: 'unlock_skill', skillId: id });

// ---- wiring: hud / inventory / input → net ----
hud.onBuildSelect = type => input.setBuildType(type);
hud.onDemolish = id => {
  net.send({ t: 'cmd', cmd: { kind: 'demolish', buildingId: id } });
  hud.selectBuilding(null);
};
inventory.onMove = (from, to) => net.send({ t: 'cmd', cmd: { kind: 'move_item', from, to } });
inventory.onDrop = (slot, count) => net.send({ t: 'cmd', cmd: { kind: 'drop_item', slot, count } });
inventory.onSelectHand = slot => net.send({ t: 'cmd', cmd: { kind: 'select_hand', slot } });
character.onCraft = recipeId => net.send({ t: 'cmd', cmd: { kind: 'craft', recipeId } });
character.onPlace = type => { input.setBuildType(type); hud.notify('Click to place · right-click to cancel'); };
character.onRepair = () => net.send({ t: 'cmd', cmd: { kind: 'repair_hand' } });
character.onMoveItem = (from, to) => net.send({ t: 'cmd', cmd: { kind: 'move_item', from, to } });
character.onDropItem = (slot, count) => net.send({ t: 'cmd', cmd: { kind: 'drop_item', slot, count } });
character.onSelectHand = slot => net.send({ t: 'cmd', cmd: { kind: 'select_hand', slot } });
input.send = cmd => net.send({ t: 'cmd', cmd });
input.ping = pos => net.send({ t: 'ping', pos });
input.onBuildCancel = () => hud.clearBuild();
world.onBuildingHit = (x, z) => effects.gatherHit(x, z, 'stone');
input.onSelectAt = cell => {
  const b = lastFrameBuildings.find(bb =>
    cell.x >= bb.pos.x && cell.x < bb.pos.x + 1 && cell.y >= bb.pos.y && cell.y < bb.pos.y + 1);
  hud.selectBuilding(b ?? null);
};
let lastSwingSent = 0;
input.onAttack = pt => {
  const sp = world.positionOf(selfId); if (!sp) return;
  const dir = { x: pt.x - sp.x, y: pt.y - sp.z };
  if (Math.hypot(dir.x, dir.y) < 0.01) return;
  lastSwingSent = performance.now();
  net.send({ t: 'cmd', cmd: { kind: 'attack', dir } });
};

// ---- net → everything ----
net.on((msg: ServerMsg) => {
  switch (msg.t) {
    case 'welcome':
      profile = msg.profile;
      if (!inGame) screens.menu(profile);
      break;
    case 'profile':
      profile = msg.profile;
      if (!inGame) screens.menu(profile);
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
      lastNodes = msg.nodes;
      world.setNodes(msg.nodes);
      input.nodes = msg.nodes;
      nodeProgress.clear();
      for (const n of msg.nodes) nodeProgress.set(n.id, { remaining: n.amount, total: n.amount, lastHitAt: 0 });
      env?.dispose();
      env = new Environment(stage.scene, msg.seed, msg.nodes);
      hud.initMinimapTerrain(msg.seed, msg.nodes);
      screens.clear();
      hud.show();
      hud.banner('You awaken in the wild');
      audio.setPhase('day');
      break;
    case 'frame': {
      const buildings = msg.buildings.filter(b => {
        if (BUILDINGS[b.type]) return true;
        warnUnknownBuilding(b.type);
        return false;
      });
      lastFrameBuildings = buildings;
      input.buildings = buildings;
      world.colliders = { buildings, nodes: lastNodes };
      world.applyFrame(msg.players, buildings, msg.groundItems, msg.creatures, msg.projectiles);
      selfView = msg.players.find(p => p.id === selfId);
      for (const e of msg.events) {
        if (e.kind === 'melee') world.lungePlayerAt(e.pos.x, e.pos.y);
        if (e.kind === 'gather') {
          world.gatherSwing(e.pos.x, e.pos.y, e.resource as 'wood' | 'stone' | 'berry');
          effects.gatherHit(e.pos.x, e.pos.y, e.resource === 'stone' ? 'stone' : 'wood');
          const np = nodeProgress.get(e.nodeId);
          if (np) { np.remaining = e.remaining; np.lastHitAt = performance.now(); }
        }
        if (e.kind === 'node_depleted') {
          const kind = lastNodes.find(n => n.id === e.nodeId)?.kind ?? 'tree';
          world.breakNode(e.nodeId, kind);
          effects.nodeBreak(e.pos.x + 0.5, e.pos.y + 0.5, kind === 'rock' ? 'rock' : 'tree');
          if (kind === 'tree') audio.treeFall(); else audio.rockBreak();
          lastNodes = lastNodes.filter(n => n.id !== e.nodeId);
          input.nodes = lastNodes;
          hud.removeMinimapNode(e.nodeId);
          nodeProgress.delete(e.nodeId);
        }
        if (e.kind === 'craft') hud.notify(`Crafted ${e.item.replace(/_/g, ' ')}`);
        if (e.kind === 'tool_broke' && e.playerId === selfId) hud.notify(`💥 ${e.item.replace(/_/g, ' ')} broke!`);
        if (e.kind === 'swing') world.playerSwing(e.pos, e.dir);
        if (e.kind === 'damage') effects.hitSpark(e.pos.x, e.pos.y);
        if (e.kind === 'creature_death') effects.nodeBreak(e.pos.x, e.pos.y, 'rock');
        if (e.kind === 'projectile') effects.tracer(e.from.x, e.from.y, e.to.x, e.to.y, e.kind2 === 'bolt' ? 0xb060ff : 0x8fdc4a);
        if (e.kind === 'region_enter' && e.id === selfId) hud.regionToast(e.region);
        if (e.kind === 'player_respawn' && e.id === selfId) hud.banner('You respawn at camp');
        if (e.kind === 'phase_change') {
          hud.banner(e.phase === 'night' ? 'Night falls' : 'Dawn breaks');
          if (e.phase === 'night') hud.notify('Danger rises after dark.');
        }
      }
      effects.handle(msg.events);
      audio.handle(msg.events);
      audio.setPhase(msg.phase);
      stage.setNight(msg.phase === 'night');
      stage.setGameTick(msg.tick);
      hud.updateFrame(selfView, msg.players, buildings, msg.phase, msg.phaseTicks, selfId);
      hud.handleEvents(msg.events, project);
      // threat + boss readout from nearby creatures
      if (selfView) {
        let hostiles = 0, boss: { name: string; ratio: number } | null = null;
        for (const c of msg.creatures) {
          const def = CREATURES[c.species];
          if (!def) continue;
          const hostile = def.faction === 'bandit' || def.faction === 'zombie' || def.faction === 'boss'
            || def.behavior === 'aggressive' || def.behavior === 'pack';
          if (!hostile) continue;
          const d = Math.hypot(c.pos.x - selfView.pos.x, c.pos.y - selfView.pos.y);
          if (d < 18) hostiles++;
          if (def.faction === 'boss') boss = { name: def.id.replace(/_/g, ' '), ratio: c.hp / c.maxHp };
        }
        hud.updateThreat(hostiles, msg.phase === 'night' && hostiles > 2);
        hud.setBoss(boss ? boss.name.toUpperCase() : null, boss?.ratio ?? 0);
      }
      if (selfView) {
        inventory.setData(selfView.inventory, selfView.equipment, selfView.hand);
        const nearTable = buildings.some(b => b.type === 'crafting_table'
          && Math.hypot(b.pos.x + 0.5 - selfView!.pos.x, b.pos.y + 0.5 - selfView!.pos.y) <= 3.5);
        character.setContext(selfView, msg.phase, msg.phaseTicks, nearTable);
      }
      break;
    }
    case 'ping':
      hud.notify(`📍 ${msg.from} pinged`);
      break;
    case 'chat':
      hud.addChat(msg.from, msg.text);
      break;
    case 'latency':
      lastPing = Math.round(performance.now() - msg.n);
      break;
    case 'ghost':
      world.setRemoteGhost(msg.type, msg.pos, msg.ok);
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

let lastPing: number | null = null;
setInterval(() => { if (inGame) net.send({ t: 'latency', n: performance.now() }); }, 2000);

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

let nearNodeId: number | null = null;

addEventListener('keydown', e => {
  if (!inGame) return;
  if (hud.chatOpen) {
    if (e.key === 'Enter') hud.closeChat(true);
    if (e.key === 'Escape') hud.closeChat(false);
    return;
  }
  if (e.key === 'Enter') { hud.openChat(); e.preventDefault(); return; }
  if (e.key === 'Tab') { e.preventDefault(); character.toggle(); return; }
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === 'e') {
    // context: gather a nearby node, else eat what's in hand
    if (nearNodeId !== null) net.send({ t: 'cmd', cmd: { kind: 'gather' } });
    else net.send({ t: 'cmd', cmd: { kind: 'eat' } });
  }
  if (k === 'i' || k === 'c' || k === 'b') character.toggle();
  if (k === 'q') net.send({ t: 'cmd', cmd: { kind: 'eat' } });   // quick-eat
  if (e.key >= '1' && e.key <= '9') net.send({ t: 'cmd', cmd: { kind: 'select_hand', slot: Number(e.key) - 1 } });
  if (e.key === 'Escape') { hud.clearBuild(); hud.selectBuilding(null); hud.toggleBuildMenu(false); inventory.toggle(false); character.toggle(false); }
  if (k === 'k' && profile) screens.skillTree(profile, true);
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
  fpsAccum += dt; fpsCount++;
  fpsTimer += dt;
  if (fpsTimer >= 1) {
    hud.setPerf(Math.round(fpsCount / fpsAccum), lastPing);
    fpsAccum = 0; fpsCount = 0; fpsTimer = 0;
  }
  if (inGame) {
    const d = input.dir;
    world.setSelfDir(d.x, d.y);
    // combat: while the button is held, face the cursor and swing on cooldown
    const sp0 = world.positionOf(selfId);
    if (input.attacking && sp0) {
      const aim = input.aimWorld();
      const ax = aim.x - sp0.x, ay = aim.y - sp0.z;
      world.setAimHeading(Math.atan2(ax, ay));
      if (now - lastSwingSent > 160 && Math.hypot(ax, ay) > 0.01) {
        lastSwingSent = now;
        net.send({ t: 'cmd', cmd: { kind: 'attack', dir: { x: ax, y: ay } } });
      }
    } else {
      world.setAimHeading(null);
    }
  }
  world.render(dt);
  const selfPos = world.positionOf(selfId);
  if (selfPos && inGame) {
    stage.setFollow(selfPos.x, selfPos.z);
    // gather prompt + golden ring on the node E would hit
    let near: NodeView | null = null;
    let nd = 2.2;
    for (const n of lastNodes) {
      const d = Math.hypot(n.pos.x + 0.5 - selfPos.x, n.pos.y + 0.5 - selfPos.z);
      if (d <= nd) { nd = d; near = n; }
    }
    nearNodeId = near?.id ?? null;
    if (near) {
      const np = nodeProgress.get(near.id);
      const channeling = np && performance.now() - np.lastHitAt < 900;
      const verb = near.kind === 'tree' ? '🪓 Chop wood' : near.kind === 'rock' ? '⛏ Mine stone' : '🫐 Pick berries';
      if (channeling && np) hud.showPrompt(near.kind === 'tree' ? '🪓 Chopping…' : near.kind === 'rock' ? '⛏ Mining…' : '🫐 Picking…', 1 - np.remaining / np.total);
      else hud.showPrompt(`[E] ${verb}`);
    } else {
      const hand = selfView?.inventory[selfView.hand];
      hud.showPrompt(hand && hand.item === 'berry' ? '[E] 🍖 Eat berry' : null);
    }
    world.highlightNode(near?.id ?? null);

    // hover affordance on placed buildings (outside build mode)
    if (!input.activeType) {
      const w = stage.screenToWorld(input.cursor.x, input.cursor.y);
      const cell = { x: Math.floor(w.x), y: Math.floor(w.y) };
      const hovered = lastFrameBuildings.find(b =>
        cell.x >= b.pos.x && cell.x < b.pos.x + 1 && cell.y >= b.pos.y && cell.y < b.pos.y + 1) ?? null;
      world.setHover(hovered);
      document.body.style.cursor = hovered ? 'pointer' : '';
    } else {
      world.setHover(null);
      document.body.style.cursor = '';
    }

    if (hud.selected !== null) {
      const b = lastFrameBuildings.find(bb => bb.id === hud.selected);
      if (b) hud.moveSelPanel(project(b.pos.x + 0.5, b.pos.y));
      else hud.selectBuilding(null);
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
// optional GLB assets — used automatically if present, procedural fallback otherwise
void preloadAssets();
