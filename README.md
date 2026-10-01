<div align="center">
  <img src="assets/icon.svg" width="96" height="96" alt="TinyThree logo" />
  <h1>TinyThree</h1>
  <p><strong>AOT compiler that turns Three.js scenes into a minimal C/WASM + WebGL2 runtime</strong></p>

  <p>
    <img src="https://img.shields.io/badge/status-experimental-orange?style=flat-square" alt="status" />
    <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" />
    <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="node" />
    <img src="https://img.shields.io/badge/WebGL2-required-4f8ef7?style=flat-square" alt="webgl2" />
    <img src="https://img.shields.io/badge/WASM-C11%20%2F%20Emscripten-7eb8ff?style=flat-square" alt="wasm" />
  </p>
</div>

---

TinyThree is an **experimental AOT (Ahead-of-Time) optimizer** for Three.js.  You write
your 3D scene with the Three.js API you already know, then compile it to three static
files that run in the browser without the Three.js runtime:

| File | What it is |
|------|-----------|
| `scene.bin` | Binary scene data (geometry, materials, transforms — pre-baked) |
| `renderer.wasm` | Minimal C11 renderer compiled to WebAssembly (~28 KB) |
| `loader.js` | 4 KB bootstrap — no framework dependency |

```html
<!-- That's all you need in production -->
<canvas id="scene"></canvas>
<script type="module">
  import { start } from './loader.js';
  await start(document.getElementById('scene'));
</script>
```

> **Not a Three.js replacement.**  Three.js remains the authoring environment.
> TinyThree compiles the *output* — the static, production-ready result.

---

## Why

When a Three.js scene uses only a few geometry types and basic materials, the shipped
bundle carries a large amount of code that never executes — the full material system,
loaders, raycaster, audio, and more.

TinyThree attacks this at compile time:

- **Dead-feature elimination** — only the code paths actually used by the scene are
  compiled into `renderer.wasm`.
- **Automatic instancing** — the compiler detects groups of meshes with identical
  geometry and material, and promotes them to a single instanced draw call. No
  `InstancedMesh` boilerplate required.
- **Pre-baked geometry** — vertices of procedural geometries (`SphereGeometry`,
  `BoxGeometry`, …) are computed once at build time and stored in `scene.bin`.
  The browser never recalculates them.
- **GC-free render loop** — the hot path runs entirely in C/WASM.  No garbage
  collector pressure, no JavaScript object allocation per frame.

### When TinyThree helps

| Scenario | Why it helps |
|----------|-------------|
| 500+ repeated objects (e.g. particle systems, product grids) | Automatic instancing: N draw calls → 1 |
| Static decorative scenes (backgrounds, heroes) | Smaller bundle, zero JS in render loop |
| Multiple `<canvas>` on one page | `renderer.wasm` compiled once, shared across instances |
| Long-running experiences (minutes) | Stable P99 frame time — no GC spikes |

### When to keep using Three.js directly

- `ShaderMaterial` or custom GLSL
- Dynamic GLTF loading (`GLTFLoader`, `FBXLoader`, …)
- Raycaster / pointer interaction
- Physics, WebXR, audio
- Scenes with fewer than ~50 objects (overhead is not worth it)

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
