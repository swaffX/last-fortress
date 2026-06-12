import * as THREE from 'three';
import { MAP_SIZE } from '@lf/shared';

/**
 * 2.5D top-down stage: orthographic camera tilted ~62 degrees, looking down
 * at the XZ plane. World (x, y) maps to Three (x, z).
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.AmbientLight;
  readonly moon: THREE.DirectionalLight;
  private viewSize = 26;                       // world units visible vertically
  private follow = new THREE.Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2);
  private shake = 0;
  private nightMix = 0;                        // 0 = day, 1 = night
  private nightTarget = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.resize();
    addEventListener('resize', () => this.resize());

    this.scene.fog = new THREE.Fog(0x0d1420, 60, 140);

    this.ambient = new THREE.AmbientLight(0xbfd4e8, 0.55);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.35);
    this.sun.position.set(40, 60, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -40; this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40; this.sun.shadow.camera.bottom = -40;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x7d9cc9, 0);
    this.moon.position.set(-30, 50, -15);
    this.scene.add(this.moon);

    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
      new THREE.MeshLambertMaterial({ color: 0x4a6b3a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // darker fringe ring (swamp/fog zones near edges)
    const fringe = new THREE.Mesh(
      new THREE.RingGeometry(MAP_SIZE * 0.42, MAP_SIZE * 0.85, 48),
      new THREE.MeshLambertMaterial({ color: 0x2e4427, transparent: true, opacity: 0.7 }),
    );
    fringe.rotation.x = -Math.PI / 2;
    fringe.position.set(MAP_SIZE / 2, 0.02, MAP_SIZE / 2);
    this.scene.add(fringe);
  }

  private resize(): void {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.camera.left = -this.viewSize * aspect / 2;
    this.camera.right = this.viewSize * aspect / 2;
    this.camera.top = this.viewSize / 2;
    this.camera.bottom = -this.viewSize / 2;
    this.camera.updateProjectionMatrix();
  }

  setFollow(x: number, y: number): void { this.follow.set(x, 0, y); }
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
    // camera: tilted ortho — offset back along -Z and up, ~62° elevation
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sz = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    this.shake = Math.max(0, this.shake - dt * 3.5);
    const camPos = new THREE.Vector3(
      this.follow.x + sx, 38, this.follow.z + 20 + sz);
    this.camera.position.lerp(camPos, Math.min(1, dt * 8));
    this.camera.lookAt(this.follow.x + sx, 0, this.follow.z + sz);

    // day/night transition
    this.nightMix += (this.nightTarget - this.nightMix) * Math.min(1, dt * 0.8);
    const m = this.nightMix;
    this.sun.intensity = 1.35 * (1 - m);
    this.moon.intensity = 0.5 * m;
    this.ambient.intensity = 0.55 - 0.38 * m;
    this.ambient.color.setHex(m > 0.5 ? 0x5d7da8 : 0xbfd4e8);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(lerpColor(0x9db8d8, 0x0a1018, m));
    fog.near = 60 - 25 * m;
    fog.far = 140 - 55 * m;
    this.renderer.setClearColor(lerpColor(0x86a8c8, 0x070b12, m));

    this.renderer.render(this.scene, this.camera);
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255;
  const br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16)
       | (Math.round(ag + (bg - ag) * t) << 8)
       | Math.round(ab + (bb - ab) * t);
}
