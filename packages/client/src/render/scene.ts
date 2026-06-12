import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { MAP_SIZE, TICK_RATE } from '@lf/shared';

/** season palette: [groundTint, sunTint, hemiSky] */
const SEASONS: [number, number, number][] = [
  [0xffffff, 0xffeacb, 0xcfe4ff],   // spring — fresh
  [0xfff0c2, 0xffe2a8, 0xd8e8ff],   // summer — golden
  [0xe8c89a, 0xffc890, 0xe0d8c8],   // autumn — amber
  [0xc8d8e4, 0xdce8f5, 0xbcd0e8],   // winter — pale
];
const SEASON_TICKS = TICK_RATE * 240;   // 4 minutes per season

/**
 * 2.5D top-down stage: orthographic camera tilted ~62 degrees, looking down
 * at the XZ plane. World (x, y) maps to Three (x, z).
 *
 * Rendering: ACES tone mapping + soft bloom (emissives only — torches,
 * crystals, windows). Procedural noise ground texture. Hemisphere +
 * directional sun/moon with full day/night grading.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly moon: THREE.DirectionalLight;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private viewSize = 26;
  private follow = new THREE.Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2);
  private shake = 0;
  private nightMix = 0;
  private nightTarget = 0;
  private seasonT = 0;
  private groundMat!: THREE.MeshLambertMaterial;
  private snow!: THREE.InstancedMesh;
  private leaves!: THREE.InstancedMesh;
  private flakeSeeds: number[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.5, 0.82);
    this.composer.addPass(this.bloom);

    this.resize();
    addEventListener('resize', () => this.resize());

    this.scene.fog = new THREE.Fog(0x0d1420, 60, 140);

    // sky dome light: warm sky, green-tinted ground bounce
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x3f5a2e, 0.65);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffeacb, 1.6);
    this.sun.position.set(40, 60, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -45; this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45; this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x8fb4e8, 0);
    this.moon.position.set(-30, 50, -15);
    this.scene.add(this.moon);

    // ground: tiled procedural noise texture — mottled meadow instead of flat green
    const groundTex = makeGroundTexture();
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(18, 18);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
      this.groundMat,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // darker mossy fringe toward the map edges
    const fringeTex = makeGroundTexture(0x32491f, 0x273c1c, 0x3c5526);
    fringeTex.wrapS = fringeTex.wrapT = THREE.RepeatWrapping;
    fringeTex.repeat.set(14, 14);
    fringeTex.colorSpace = THREE.SRGBColorSpace;
    const fringe = new THREE.Mesh(
      new THREE.RingGeometry(MAP_SIZE * 0.42, MAP_SIZE * 0.85, 48),
      new THREE.MeshLambertMaterial({ map: fringeTex, transparent: true, opacity: 0.85 }),
    );
    fringe.rotation.x = -Math.PI / 2;
    fringe.position.set(MAP_SIZE / 2, 0.02, MAP_SIZE / 2);
    this.scene.add(fringe);

    // seasonal weather particles drifting around the camera
    this.snow = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.05, 4, 3),
      new THREE.MeshBasicMaterial({ color: 0xf2f8ff, transparent: true, opacity: 0 }), 140);
    this.leaves = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.16, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xd88a3a, transparent: true, opacity: 0, side: THREE.DoubleSide }), 80);
    for (let i = 0; i < 140; i++) this.flakeSeeds.push(Math.random() * 1000);
    this.scene.add(this.snow, this.leaves);
  }

  /** Drive the season clock from the authoritative sim tick (both players agree). */
  setGameTick(tick: number): void {
    this.seasonT = (tick / SEASON_TICKS) % 4;
  }

  private seasonWeight(k: number): number {
    const d = Math.min(Math.abs(this.seasonT - k), 4 - Math.abs(this.seasonT - k));
    return Math.max(0, 1 - d);
  }

  private seasonBlend(idx: 0 | 1 | 2): number {
    let r = 0, g = 0, b = 0, total = 0;
    for (let k = 0; k < 4; k++) {
      const w = this.seasonWeight(k);
      if (w <= 0) continue;
      const c = SEASONS[k]![idx];
      r += (c >> 16 & 255) * w; g += (c >> 8 & 255) * w; b += (c & 255) * w;
      total += w;
    }
    return (Math.round(r / total) << 16) | (Math.round(g / total) << 8) | Math.round(b / total);
  }

  private resize(): void {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const aspect = w / h;
    this.camera.left = -this.viewSize * aspect / 2;
    this.camera.right = this.viewSize * aspect / 2;
    this.camera.top = this.viewSize / 2;
    this.camera.bottom = -this.viewSize / 2;
    this.camera.updateProjectionMatrix();
  }

  setFollow(x: number, y: number): void { this.follow.set(x, 0, y); }

  /** Wheel zoom: closer down to 14 world units, never wider than the default 26. */
  zoomBy(delta: number): void {
    this.viewSize = Math.min(26, Math.max(14, this.viewSize + delta));
    this.resize();
  }
  addShake(amount: number): void { this.shake = Math.min(1.2, this.shake + amount); }
  setNight(night: boolean): void { this.nightTarget = night ? 1 : 0; }

  /** Convert screen pixel to world XZ on the ground plane. */
  screenToWorld(px: number, py: number): { x: number; y: number } {
    const ndc = new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    const hit = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    return { x: hit.x, y: hit.z };
  }

  update(dt: number): void {
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sz = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    this.shake = Math.max(0, this.shake - dt * 3.5);
    const camPos = new THREE.Vector3(this.follow.x + sx, 38, this.follow.z + 20 + sz);
    this.camera.position.lerp(camPos, Math.min(1, dt * 8));
    this.camera.lookAt(this.follow.x + sx, 0, this.follow.z + sz);
    // shadow camera tracks the view so shadows never pop out near the player
    this.sun.position.set(this.follow.x + 40, 60, this.follow.z + 20);
    this.sun.target.position.set(this.follow.x, 0, this.follow.z);

    // day/night grading — slow blend through a warm dusk, not a hard fade
    this.nightMix += (this.nightTarget - this.nightMix) * Math.min(1, dt * 0.35);
    const m = this.nightMix;
    const dusk = Math.sin(m * Math.PI);              // peaks mid-transition
    const seasonSun = this.seasonBlend(1);
    const seasonSky = this.seasonBlend(2);
    this.sun.intensity = 1.6 * (1 - m) + dusk * 0.15;
    this.sun.color.setHex(lerpColor(seasonSun, 0xff8a45, dusk * 0.85));
    this.moon.intensity = 0.55 * m;
    this.hemi.intensity = 0.65 - 0.42 * m + dusk * 0.06;
    this.hemi.color.setHex(lerpColor(lerpColor(seasonSky, 0xe8a070, dusk * 0.5), 0x4a6488, m));
    this.hemi.groundColor.setHex(lerpColor(0x3f5a2e, 0x16202c, m));
    this.renderer.toneMappingExposure = 1.15 - 0.25 * m + dusk * 0.05;
    this.bloom.strength = 0.4 + 0.45 * m;            // emissives glow harder at night
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(lerpColor(lerpColor(0xa8c4dc, 0xd89060, dusk * 0.55), 0x0a1018, m));
    fog.near = 60 - 25 * m;
    fog.far = 140 - 55 * m;
    this.renderer.setClearColor(lerpColor(lerpColor(0x9cbcd8, 0xcf8a55, dusk * 0.5), 0x070b12, m));

    // seasonal ground tint + weather particles
    this.groundMat.color.setHex(this.seasonBlend(0));
    this.updateWeather();

    this.composer.render();
  }

  private weatherTime = 0;
  private updateWeather(): void {
    this.weatherTime += 1 / 60;
    const wWinter = this.seasonWeight(3);
    const wAutumn = this.seasonWeight(2);
    (this.snow.material as THREE.MeshBasicMaterial).opacity = wWinter * 0.9;
    (this.leaves.material as THREE.MeshBasicMaterial).opacity = wAutumn * 0.85;
    const m4 = new THREE.Matrix4();
    if (wWinter > 0.01) {
      for (let i = 0; i < 140; i++) {
        const s = this.flakeSeeds[i]!;
        const fall = ((this.weatherTime * (1.2 + (s % 1)) + s) % 1);
        m4.setPosition(
          this.follow.x + Math.sin(s * 7 + this.weatherTime * 0.5) * 2 + ((s * 13) % 30) - 15,
          12 * (1 - fall),
          this.follow.z + ((s * 29) % 26) - 13,
        );
        this.snow.setMatrixAt(i, m4);
      }
      this.snow.instanceMatrix.needsUpdate = true;
    }
    if (wAutumn > 0.01) {
      for (let i = 0; i < 80; i++) {
        const s = this.flakeSeeds[i]!;
        const fall = ((this.weatherTime * (0.7 + (s % 0.6)) + s) % 1);
        m4.makeRotationFromEuler(new THREE.Euler(s + this.weatherTime * 2, s * 2, s));
        m4.setPosition(
          this.follow.x + Math.sin(s * 5 + this.weatherTime) * 4 + ((s * 17) % 30) - 15,
          10 * (1 - fall),
          this.follow.z + ((s * 23) % 26) - 13,
        );
        this.leaves.setMatrixAt(i, m4);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }
  }
}

/** Multi-octave value-noise meadow texture, tileable by construction. */
function makeGroundTexture(base = 0x4f7340, dark = 0x3e5c30, light = 0x6a8a4a): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const b = hex(base), d = hex(dark), l = hex(light);
  const img = ctx.createImageData(S, S);
  // tileable value noise: sample on a torus
  const noise = (x: number, y: number, f: number, seed: number) => {
    const a = (Math.sin((x * f + seed) * 0.7) + Math.sin((y * f + seed * 2) * 0.9)
             + Math.sin(((x + y) * f + seed * 3) * 0.5) + Math.sin((x * f - y * f + seed) * 0.3)) / 4;
    return a * 0.5 + 0.5;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2;
      // torus coordinates keep every octave seamless
      const n = noise(Math.cos(u) * 3 + 3, Math.sin(v) * 3 + 3, 2.1, 1) * 0.5
              + noise(Math.cos(u) * 7 + 7, Math.sin(v) * 7 + 7, 3.7, 5) * 0.3
              + noise(Math.cos(u) * 15, Math.sin(v) * 15, 5.3, 9) * 0.2;
      const t = Math.max(0, Math.min(1, n));
      const c = t < 0.45 ? mix(d, b, t / 0.45) : mix(b, l, (t - 0.45) / 0.55);
      const i = (y * S + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // sparse speckles: tiny dark dots (soil) and light dots (dry grass)
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(40,56,28,0.5)' : 'rgba(150,170,95,0.4)';
    ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  return new THREE.CanvasTexture(canvas);
}

function hex(c: number): [number, number, number] {
  return [c >> 16 & 255, c >> 8 & 255, c & 255];
}
function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function lerpColor(a: number, b: number, t: number): number {
  const A = hex(a), B = hex(b);
  const c = mix(A, B, t);
  return (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
}
