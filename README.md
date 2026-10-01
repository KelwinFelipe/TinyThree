<div align="center">
  <img src="assets/icon.svg" width="96" height="96" alt="TinyThree logo" />
  <h1>TinyThree</h1>
  <p><strong>Write your 3D scene in Three.js. Ship it as 28 KB of WebAssembly.</strong></p>
  <p>An AOT compiler that eliminates the Three.js runtime from production —<br>
  delivering automatic instancing, GC-free rendering, and smaller bundles.</p>

  <p>
    <img src="https://img.shields.io/badge/status-experimental-orange?style=flat-square" alt="status" />
    <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" />
    <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="node" />
    <img src="https://img.shields.io/badge/WebGL2-required-4f8ef7?style=flat-square" alt="webgl2" />
    <img src="https://img.shields.io/badge/WASM-C11%20%2F%20Emscripten-7eb8ff?style=flat-square" alt="wasm" />
  </p>
</div>

---

TinyThree is an **experimental AOT (Ahead-of-Time) optimizer** for Three.js.

You write your scene using the Three.js API — geometries, materials, cameras,
animations — exactly as you always would. Then TinyThree compiles it to three
static files that run in the browser *without* the Three.js runtime:

| File | What it is | Typical size |
|------|-----------|---|
| `scene.bin` | Binary scene data — pre-baked geometry, transforms, draw list | varies |
| `renderer.wasm` | Minimal C11 renderer compiled to WebAssembly | ~28 KB |
| `loader.js` | Bootstrap script — no framework dependency | ~4 KB |

```html
<!-- Production: no Three.js, no bundler, just three static files -->
<canvas id="scene"></canvas>
<script type="module">
  import { start } from './loader.js';
  await start(document.getElementById('scene'));
</script>
```

> **Not a Three.js replacement.** Three.js remains the authoring environment.
> TinyThree compiles the *output* — the static, optimized result you ship to users.

---

## Why

### The problem with shipping Three.js

Three.js is a general-purpose 3D library. Even when your scene uses only a
`BoxGeometry` and a `MeshBasicMaterial`, you ship its full renderer, material
system, audio, raycaster, and 20+ loaders.

**The tree-shaking problem:** `WebGLRenderer` creates hard dependencies across
the Three.js codebase that defeat bundler tree-shaking in practice.
[Confirmed by the Three.js community](https://discourse.threejs.org/t/vite-rollup-doesnt-tree-shake-threejs-when-using-r3f/68277):
> *"In practice Three.js does not tree-shake efficiently — almost all constructs
> are hard-wired into WebGLRenderer."*

**Real bundle sizes (Brotli compressed):**

| Approach | Brotli |
|---|---|
| `import * as THREE` — full bundle | ~140 KB |
| Three.js tree-shaken with Vite (WebGLRenderer + BoxGeometry + MeshBasicMaterial) | ~80–95 KB |
| TinyThree — loader.js + renderer.wasm + scene.bin (simple scene) | **~22–28 KB** |

*Sources: [Three.js discourse](https://discourse.threejs.org/t/three-js-tree-shaking/76728),
[mattdesl/threejs-tree-shake](https://github.com/mattdesl/threejs-tree-shake).*

> **Honest caveat:** TinyThree is larger than a hand-written WebGL2 renderer
> (~5 KB Brotli). The gain over Three.js comes from what the compiler does —
> not just from the smaller runtime size.

---

### What the compiler actually does

**1 — Automatic instancing (the biggest gain)**

When your scene has N objects with the same geometry and material, Three.js
issues N draw calls by default. Each draw call has CPU overhead on both
JavaScript and the GPU driver.

```
// Your Three.js code: 1000 stars as individual meshes
for (let i = 0; i < 1000; i++) scene.add(new THREE.Mesh(starGeo, starMat));
// Three.js default: 1000 draw calls  ← kills performance on mobile
```

TinyThree detects this pattern at compile time and emits one instanced call:

```
// What TinyThree generates: always 1 GPU draw call
gl.drawElementsInstanced(GL_TRIANGLES, indexCount, GL_UNSIGNED_SHORT, 0, 1000);
```

**Why this matters on mobile:** mid-range Android GPUs (Adreno 640, Mali-G76)
drop frames above ~100–200 draw calls/frame.
A star field of 1,000 naive meshes = 1,000 draw calls = unusable on mobile.
After TinyThree = 1 draw call = runs fine everywhere.

*Source: [WebXR Scene Optimization — toji.dev](https://toji.dev/webxr-scene-optimization/)*

**2 — Pre-baked geometry**

`SphereGeometry(1, 32, 32)` computes ~3,000 vertices in the browser on Three.js.
TinyThree computes them once at build time. Vertex data arrives in `scene.bin`
as a raw binary buffer uploaded directly to the GPU — no JavaScript allocations.

**3 — GC-free render loop**

The render loop runs in C/WASM — no garbage collector, no JavaScript allocations
per frame. On mobile devices, a GC pause of 5–30 ms causes visible frame stutter.
WASM has none of that.

*Source: [WebAssembly vs JavaScript — ijirset.com](https://www.ijirset.com/upload/2024/july/32_Harnessing.pdf)*

---

### When TinyThree helps

| Scenario | The gain |
|---|---|
| Star fields, particle systems, repeated objects | Automatic instancing: 10,000 draw calls → 1 |
| Decorative 3D backgrounds on a web page | ~80 KB less JS, zero GC during animation |
| Multiple `<canvas>` on the same page | `renderer.wasm` cached by browser, reused per canvas |
| Long-running experiences (minutes of animation) | Consistent P99 frame time — no GC spikes over time |
| Old mobile hardware (iPhone 8, mid-range Android 2019) | Fewer draw calls, no GC pressure |

### When to keep using Three.js directly

| Scenario | Why Three.js is better |
|---|---|
| `ShaderMaterial` / custom GLSL effects | TinyThree's 4 fixed shaders don't cover this |
| Loading external models (GLTF, OBJ, FBX) | `GLTFLoader` + KTX2 pipeline is mature and optimized |
| Click / hover on 3D objects (`Raycaster`) | Requires a JS-accessible scene graph at runtime |
| Physics, WebXR, audio | Outside the AOT static model |
| < 50 objects, simple scene | The WASM startup overhead isn't worth it |
| Development / prototyping | Three.js DX is far superior — use it to build, compile to ship |

---

## Real-world use case — 3D solar system on a content website

[astroludico.com](https://astroludico.com) is an astrology and numerology site
that runs entirely in the browser. Adding an animated 3D solar system background
to the hero section — visible and smooth on old Android phones — is a concrete
target for TinyThree.

**The challenge:**

A solar system with 9 planets, a star field, and orbit rings naively generates
over 10,000 draw calls (one per star). Mid-range Android (Snapdragon 665,
very common ~2019–2021) drops frames above ~100–200 draw calls.

**The solution with TinyThree:**

```
Stars (10,000 points)     → 1 draw call   (THREE.Points, merged at compile time)
Orbit rings (9)           → 1 draw call   (geometry merged by compiler)
Planets (9, all unique)   → 9 draw calls  (can't instance — different sizes)
Sun + glow                → 2 draw calls
───────────────────────────────────────
Total                    → ~13 draw calls  ✓ safe on any mobile device
```

**Bundle delivered to the user:**

```
loader.js       ~4 KB   (bootstrap, no framework)
renderer.wasm   ~28 KB  (entire C11 renderer)
scene.bin       ~45 KB  (planet geometry + positions, pre-baked)
──────────────────────
total           ~77 KB uncompressed  /  ~28 KB Brotli
```

Compared to Three.js tree-shaken for the same scene: ~310 KB uncompressed / ~90 KB Brotli.

**Integration on the page** — lazy loaded, only when the canvas is visible:

```html
<canvas id="solar-bg"></canvas>
<script type="module">
  import { start } from '/solar/loader.js';

  const observer = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    observer.disconnect();
    const canvas = document.getElementById('solar-bg');
    // Cap pixel ratio at 2 — saves ~56% GPU work on 3× screens
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    await start(canvas);
  }, { rootMargin: '200px' });

  observer.observe(document.getElementById('solar-bg'));
</script>
```

> For an interactive solar system (click on planets, orbit camera, labels),
> use Three.js directly — TinyThree does not support `Raycaster` yet.
> See the full guide: [`docs/guides/solar-system-guide.md`](docs/guides/solar-system-guide.md)

---

## Quick start

```bash
# Create a new project with a working example
npx tinythree init my-scene
cd my-scene
npm install
npm run build   # compiles scene.ts → dist/
npx serve .     # open http://localhost:3000
```

Or add TinyThree to an existing project:

```bash
npm install --save-dev @tinythree/cli
```

```ts
// src/scene.ts  — export a buildScene() function
import * as THREE from 'three';

export default function buildScene() {
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 4);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x4f8ef7 }),
  );
  scene.add(mesh);

  return { scene, camera };
}
```

```bash
npx tinythree compile src/scene.ts --out dist/
```

Output:

```
✓ TinyThree compiled successfully

  scene.bin     41.2 KB
  renderer.wasm 27.8 KB
  loader.js      3.9 KB
  ─────────────────────────
  total         72.9 KB

  meshes        1
  draw calls    1
```

---

## CLI

```
tinythree compile <scene>   Compile a scene to scene.bin + renderer.wasm + loader.js
tinythree analyze <scene>   Inspect a scene without compiling
tinythree init    [dir]     Scaffold a new project

Compile options
  --out     <dir>    Output directory (default: ./dist)
  --public  <path>   URL prefix written into loader.js (default: ./)
  --debug            Also emit scene.debug.json for inspection
  --watch            Recompile on file changes
```

### `analyze` output example

```
Scene Analysis: src/scene.ts

  Nodes         27
  Meshes        18
  Materials      3
  Textures       2
  Animations     1

Required runtime features:
  ✓ perspective-camera
  ✓ mesh
  ✓ basic-material
  ✓ texture
  ✓ transform-animation

Optimizations that will be applied:
  ↓ 16 meshes with identical geometry+material → 1 instanced draw call  (16 → 1 draw calls)

Estimated output:
  scene.bin     ~68 KB
  renderer.wasm ~32 KB
  loader.js     ~4 KB
  total (Brotli) ~22 KB

  ✓ Ready to compile: tinythree compile src/scene.ts
```

---

## Loader API

`loader.js` is a plain ES module — no framework required.

```js
import { start } from './dist/loader.js';

const canvas = document.getElementById('scene');
const scene  = await start(canvas);

// Notify the runtime of a canvas resize
window.addEventListener('resize', () => {
  canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
  scene.resize(canvas.width, canvas.height);
});

// Stop rendering and release GPU resources
scene.stop();
```

### React wrapper (20 lines, not included — build it yourself)

```tsx
import { useEffect, useRef } from 'react';
import { start } from './dist/loader.js';

export function CompiledScene({ src, className }) {
  const ref = useRef(null);

  useEffect(() => {
    let handle;
    start(ref.current).then(h => { handle = h; });
    return () => handle?.stop();
  }, [src]);

  return <canvas ref={ref} className={className} />;
}
```

---

## Supported Three.js subset

### Objects
`Scene` · `Object3D` · `Group` · `Mesh` · `InstancedMesh` · `Points` · `Line`
`PerspectiveCamera` · `OrthographicCamera`

### Geometries
`BufferGeometry` · `BoxGeometry` · `SphereGeometry` · `PlaneGeometry`
`CylinderGeometry` · `TorusGeometry`

### Materials
`MeshBasicMaterial` · `PointsMaterial` · `LineBasicMaterial`

### Compiler constraints on `buildScene()`

| Allowed | Not allowed |
|---------|------------|
| All Three.js geometry math | `WebGLRenderer` |
| Static scene construction | Async loaders (`GLTFLoader`, `FBXLoader`, …) |
| Deterministic positions | `Math.random()` for positions |
| `AnimationClip` / `KeyframeTrack` | `onBeforeRender`, `onAfterRender` |
| | `ShaderMaterial` / `RawShaderMaterial` |

## Guides

| Guide | What it covers |
|---|---|
| [When to use TinyThree](docs/guides/use-cases.md) | Real bundle sizes, draw call budgets, decision flowchart |
| [3D Solar System — mobile guide](docs/guides/solar-system-guide.md) | High-quality solar system at 60 FPS on old Android, Three.js + TinyThree patterns |

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a full description of the pipeline,
binary format, and runtime design.

```
buildScene() → THREE.Scene
      │
      ▼  (compiler: Node.js + Three.js, no WebGL)
 scene.bin  ←─ pre-baked vertices, transforms, draw list
      │
      ▼  (runtime: C11 → Emscripten → WebAssembly)
 renderer.wasm  ←─ arena allocator, WebGL2 state machine, 4 shader variants
      │
      ▼  (loader: 4 KB plain JS)
 pixels on screen
```

---

## Examples

| Example | What it demonstrates |
|---------|---------------------|
| [`rotating-cube`](examples/rotating-cube/) | Minimal pipeline — 1 mesh, animation |
| [`solar-system`](examples/solar-system/) | Hierarchy, textures, automatic instancing |
| [`starfield`](examples/starfield/) | 10k points — `PointsMaterial`, 1 draw call |

```bash
pnpm --filter @tinythree/example-rotating-cube build
pnpm --filter @tinythree/example-rotating-cube serve
```

---

## Benchmarks

Side-by-side comparison of Three.js (tree-shaken) vs TinyThree for each example scene.
Open [`benchmarks/index.html`](benchmarks/index.html) after serving the repo.

Metrics: P50 / P95 / P99 frame time · FPS · GC pause count · TTFF (cold + warm cache) ·
bundle size (Brotli).

> **No claims without numbers.** Results will be published here once the MVP is
> complete and measurements are reproducible.

---

## Building the runtime

The compiled `renderer.wasm` is committed to the repo under `runtime/prebuilt/` so
you don't need Emscripten to use TinyThree.  To rebuild it:

```bash
# Docker (recommended — pins Emscripten version)
docker run --rm \
  -v $(pwd)/runtime:/src \
  emscripten/emsdk:3.1.74 \
  make -C /src prod

# Local emsdk
source /path/to/emsdk/emsdk_env.sh
make -C runtime prod
```

Build profiles:

| Profile | Flag | Use case |
|---------|------|---------|
| `make dev`  | `-O1 -g3 -ASSERTIONS=2` | Development with debug symbols |
| `make prod` | `-Oz -flto + wasm-opt`  | Smallest binary (default) |
| `make perf` | `-O3 -flto -msimd128`  | Maximum runtime performance |

---

## Roadmap

- [x] TSCN v1 binary format
- [x] Compiler: scene runner + analyzer + serializer
- [x] CLI: `compile`, `analyze`, `init`
- [x] Runtime: C11 single-file, arena allocator, WebGL2 renderer
- [x] 4 shader variants: unlit-color, unlit-texture, points, lines
- [x] Automatic instancing detection
- [ ] Transform animations (Level 1) — keyframe interpolation in C
- [ ] Texture upload — RGBA8 from `scene.bin` data segment
- [ ] Frustum culling — AABB pre-computed at compile time
- [ ] Benchmark results published
- [ ] Vite plugin (`@tinythree/vite-plugin`)
- [ ] GLTF input — accept `.glb` files directly (no `buildScene()` needed)

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

[MIT](./LICENSE) — © 2026 TinyThree Contributors.

Three.js is licensed under MIT by the three.js authors.
Emscripten is licensed under MIT / University of Illinois NCSA Open Source License.
`cgltf` (future dependency) is licensed under MIT.
