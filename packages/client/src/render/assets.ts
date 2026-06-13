import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Optional GLB asset layer. Drop CC0/commercial-licensed `.glb` files into
 * `packages/client/public/models/` using the filenames in MANIFEST below and they
 * are used automatically; anything missing falls back to the procedural model in
 * models.ts, so the game runs with or without assets.
 *
 * Recommended free packs (all CC0): Quaternius Ultimate Animated Animals,
 * Kenney Nature Kit, Kenney Survival Kit.
 */

interface LoadedAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  scale: number;
  yaw: number;          // base rotation so the model faces +Z like our rig
  yOffset: number;      // lift so feet sit at ground (y=0)
}

/** logical name → file + import tuning. Missing files are silently skipped. */
const MANIFEST: Record<string, { url: string; scale?: number; yaw?: number; yOffset?: number }> = {
  // nature (Quaternius Ultimate Stylized Nature, repacked to self-contained GLB)
  tree: { url: '/models/tree.glb', scale: 0.75 },                       // ~5u tall
  rock: { url: '/models/rock.glb', scale: 1 },                          // (no asset → procedural)
  bush: { url: '/models/bush.glb', scale: 0.41, yOffset: 0.34 },        // ~1u, origin below feet
  // animals (Quaternius CC0 packs; scale measured from each GLB's world bbox)
  creature_cow: { url: '/models/cow.glb', scale: 0.29 },     // ~1.5u tall
  creature_sheep: { url: '/models/sheep.glb', scale: 0.25 }, // ~1.1u
  creature_pig: { url: '/models/pig.glb', scale: 0.20 },     // ~0.9u
  creature_chicken: { url: '/models/chicken.glb', scale: 0.25 },
  creature_wolf: { url: '/models/wolf.glb', scale: 0.34 },   // ~0.9u
  creature_bear: { url: '/models/bear.glb', scale: 0.4 },
  // props
  campfire: { url: '/models/campfire.glb', scale: 1 },
};

const cache = new Map<string, LoadedAsset>();
let loaded = false;

export function assetsReady(): boolean { return loaded; }

/** Load every manifest entry that exists; missing/broken files are ignored. */
export async function preloadAssets(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(MANIFEST).map(([name, cfg]) =>
    new Promise<void>(resolve => {
      loader.load(cfg.url,
        gltf => {
          cache.set(name, {
            scene: gltf.scene, clips: gltf.animations ?? [],
            scale: cfg.scale ?? 1, yaw: cfg.yaw ?? 0, yOffset: cfg.yOffset ?? 0,
          });
          resolve();
        },
        undefined,
        () => resolve(),   // 404 / parse error → skip, procedural fallback stays
      );
    })));
  loaded = true;
}

/**
 * A fresh clone of the asset (skeleton-safe), wrapped in a group whose origin sits
 * at the feet, +Z forward, scaled to taste. Returns null when the asset is absent.
 * `userData.clips` carries the animation clips for world.ts to drive a mixer.
 */
export function assetInstance(name: string): THREE.Group | null {
  const a = cache.get(name);
  if (!a) return null;
  const inner = skeletonClone(a.scene) as THREE.Group;
  inner.scale.setScalar(a.scale);
  inner.rotation.y = a.yaw;
  inner.position.y = a.yOffset;
  inner.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  const g = new THREE.Group();
  g.add(inner);
  g.userData.clips = a.clips;
  g.userData.assetRoot = inner;
  return g;
}
