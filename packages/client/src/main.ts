import './style.css';
import * as THREE from 'three';
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

// ---- wiring: screens → net ----
screens.onCreate = (klass, solo) => { audio.unlock(); net.send({ t: 'create_lobby', klass, solo }); };
screens.onJoin = (code, klass) => { audio.unlock(); net.send({ t: 'join_lobby', code, klass }); };
screens.onStart = () => net.send({ t: 'start_game' });
screens.onUnlockSkill = id => net.send({ t: 'unlock_skill', skillId: id });
screens.onPlayAgain = () => location.reload();

// ---- wiring: hud/input → net ----
hud.onBuildSelect = type => input.setBuildType(type);
hud.onUpgrade = id => net.send({ t: 'cmd', cmd: { kind: 'upgrade', buildingId: id } });
hud.onDemolish = id => {
  net.send({ t: 'cmd', cmd: { kind: 'demolish', buildingId: id } });
  hud.selectBuilding(null);
};
input.send = cmd => net.send({ t: 'cmd', cmd });
input.ping = pos => net.send({ t: 'ping', pos });
input.onAttack = () => world.lunge(selfId);
input.onBuildCancel = () => hud.clearBuild();
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
      world.selfId = msg.selfId;
      world.setSeed(msg.seed);
      lastNodes = msg.nodes;
      world.setNodes(msg.nodes);
      input.nodes = msg.nodes;
      env?.dispose();
      env = new Environment(stage.scene, msg.seed, msg.nodes);
      screens.clear();
      hud.show();
      hud.banner('The Watch Begins', false);
      audio.setPhase('day');
      break;
    case 'frame': {
      lastFrameBuildings = msg.buildings;
      input.buildings = msg.buildings;
      // node depletion: drop rendered nodes the sim no longer reports via gather
      world.applyFrame(msg.players, msg.enemies, msg.buildings);
      for (const e of msg.events) {
        if (e.kind === 'projectile') world.aimTower(e.from, e.to);
        if (e.kind === 'melee') world.lungePlayerAt(e.pos.x, e.pos.y);
      }
      effects.handle(msg.events);
      audio.handle(msg.events);
      audio.setPhase(msg.phase);
      stage.setNight(msg.phase === 'night');
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
    case 'game_over':
      inGame = false;
      hud.hide();
      screens.gameOver(msg.wave, msg.coinsEarned, msg.skillPointsEarned);
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

// ---- loops ----
setInterval(() => { if (inGame) input.tick(); }, 50);

addEventListener('keydown', e => {
  if (!inGame || e.target instanceof HTMLInputElement) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 9) hud.buildByIndex(n - 1);
  if (e.key === 'Escape') { hud.clearBuild(); hud.selectBuilding(null); }
  if (e.key.toLowerCase() === 'k' && profile) screens.skillTree(profile, true);
  if (e.key.toLowerCase() === 'u' && hud.selected !== null) {
    net.send({ t: 'cmd', cmd: { kind: 'upgrade', buildingId: hud.selected } });
  }
});

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (inGame) {
    const d = input.dir;
    world.setSelfDir(d.x, d.y);
  }
  world.render(dt);
  // camera follows the predicted self position every display frame (no tick stutter)
  const selfPos = world.positionOf(selfId);
  if (selfPos) stage.setFollow(selfPos.x, selfPos.z);
  effects.update(dt);
  env?.update(dt);
  input.updateGhost();
  stage.update(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

net.connect();
void lastNodes; // retained for future node-depletion sync
