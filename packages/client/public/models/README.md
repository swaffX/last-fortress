# Optional 3D asset drop-in (`.glb`)

Drop CC0 / commercial-licensed **GLB** files here with the exact filenames below.
They are used automatically; anything missing falls back to the built-in procedural
model, so the game runs with or without these files.

Vite serves this folder at the site root, so `public/models/cow.glb` loads from
`/models/cow.glb` (see `src/render/assets.ts` → `MANIFEST`).

## Filenames the loader looks for

| File | Used for | Suggested free CC0 source |
|---|---|---|
| `cow.glb` | cow creature | Quaternius — Animated Animal / Farm Animal Pack |
| `sheep.glb` | sheep | Quaternius — Farm Animal Pack |
| `pig.glb` | pig | Quaternius — Farm Animal Pack |
| `chicken.glb` | chicken | Quaternius — Farm Animal Pack |
| `wolf.glb` | wolf | Quaternius — Animated Animal Pack |
| `bear.glb` | bear | Quaternius — Animated Animal Pack |
| `tree.glb` | trees (resource nodes) | Kenney Nature Kit / Quaternius Stylized Nature |
| `rock.glb` | rocks | Kenney Nature Kit |
| `bush.glb` | berry bushes | Kenney Nature Kit |
| `campfire.glb` | campfire prop (future) | Kenney Survival Kit / Camp-it pack |

## Notes

- **Animated GLBs** (Quaternius animals ship with `Walk`/`Idle`/`Attack`/`Death`
  clips): the loader auto-plays a `walk`/`idle`/`run` clip on a per-instance mixer.
- **Scale / facing**: if a model imports too big/small or faces the wrong way, tune
  its `scale` / `yaw` in `MANIFEST` (`src/render/assets.ts`). Our rig faces +Z and
  models stand with feet at y=0.
- **License**: this is a publishable game — use only **CC0** or explicitly
  commercial-licensed assets. Kenney and Quaternius are CC0. Add credits if a pack
  requests attribution.
- These `.glb` files are intentionally **not committed** (binary, large, licensed
  separately) — add them locally / in deployment.
