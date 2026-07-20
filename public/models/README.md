# Lion Run — 3D character models

These GLBs are the playable runners for **Lion Run** (`/city`) and the chat
**Lion Race**. They load lazily via three.js `GLTFLoader` at play time (never
precached — see `vite.config.ts` `globPatterns`), so they don't bloat the app.

| file | character(s) | source | licence |
|------|-----------|--------|---------|
| `wolf.glb`  | 🐺 Wolf — also the base rig for 🦁 Leo (gold + mane) and 🦁 Lioness | Quaternius "Animated Animal Pack" | CC0 (public domain) |
| `fox.glb`   | 🦊 Fox      | Quaternius | CC0 |
| `shiba.glb` | 🐕 Shiba    | Quaternius | CC0 |
| `husky.glb` | 🐕‍🦺 Husky  | Quaternius | CC0 |
| `deer.glb`  | 🦌 Deer     | Quaternius | CC0 |
| `stag.glb`  | 🦌 Stag     | Quaternius | CC0 |
| `bull.glb`  | 🐂 Bull     | Quaternius | CC0 |
| `horse.glb` | 🐎 Stallion | Quaternius | CC0 |

The hero 🦁 **Lion** is a real animated 3D model built from the Wolf rig (full
skeletal gallop/idle/jump/death) tinted lion-gold with a procedural mane on the
head bone. A few of these animals also roam the roadside as ambient scenery.

The registry lives in `src/lib/characters.ts`; the loader/adapter is
`src/game/characterModel.ts`.

## Upgrade the hero 🦁 Lion to a REALISTIC model (optional, drop-in)

The hero **Lion** currently uses the built-in procedural lion. To upgrade it to
a realistic modelled lion **with zero code changes**:

1. Download a **rigged + animated** lion in **GLB/glTF** format. Good free sources
   (a free account/login may be required to download):
   - Sketchfab — search "lion rigged animated", filter *Downloadable* (e.g. the
     "Realistic Lion Rigged and Animated" model, ~9k tris — mobile-friendly).
   - Meshy.ai — CC0 / CC-BY lion GLBs.
   Keep it low-poly (< ~30k triangles) so phones stay at 60 fps.
2. Save it as **`public/models/lion.glb`**.
3. Reload the game. The hero auto-detects the file (a one-time HEAD probe) and
   swaps the procedural lion for your model.

The loader matches animation clips by keyword (run/gallop, idle, jump, death),
so most rigs work without configuration. To pin exact clip names or tweak
scale/orientation, edit the `lion` entry in `src/lib/characters.ts`
(add `kind: 'gltf'`, `url`, `clips`, `targetHeight`, `faceYaw`, `bodyMats`).
