# Architecture

TinyThree is split into three layers that communicate through a well-defined interface.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Authoring (Three.js / TypeScript)                                  │
│  Developer writes a scene using a familiar Three.js API.            │
│  Only the compiler-compatible subset is needed.                     │
└────────────────────────┬────────────────────────────────────────────┘
                         │  buildScene() → THREE.Scene
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Compiler  (@tinythree/compiler)                          Node.js   │
│                                                                     │
│  1. Execute scene module with real Three.js (no mocks/shims)        │
│  2. Analyze scene graph → detect instancing candidates, features    │
│  3. Serialize to scene.bin  (TSCN v1 binary format)                 │
│  4. Emit loader.js  (4 KB bootstrap, no framework dependency)       │
└────────────────────────┬────────────────────────────────────────────┘
                         │  scene.bin · renderer.wasm · loader.js
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Runtime  (C11 → WebAssembly)                              Browser  │
│                                                                     │
│  tt_init(scene_ptr, size, w, h)                                     │
│   └─ parse scene.bin → upload VBOs/VAOs → compile shaders           │
│                                                                     │
│  tt_frame(timestamp)   ← called every requestAnimationFrame         │
│   └─ iterate flat draw list → set state → gl.drawElements           │
│                                                                     │
│  tt_resize(w, h)  /  tt_destroy()                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Repository layout

```
tinythree/
│
├── packages/
│   ├── compiler/          TypeScript — scene runner + analyzer + serializer
│   └── cli/               Node.js CLI (tinythree compile / analyze / init)
│
├── runtime/
│   ├── include/
│   │   └── tinythree.h    Public C API (4 exported functions)
│   ├── src/
│   │   └── tinythree.c    Single-file C11 runtime (~2000 lines)
│   ├── prebuilt/
│   │   └── renderer.wasm  Pre-compiled binary (committed to repo)
│   └── Makefile           dev / prod / perf build profiles
│
├── examples/
│   ├── rotating-cube/     Hello World — pipeline validation
│   ├── solar-system/      Textures + animations + hierarchy
│   └── starfield/         10k points — PointsMaterial
│
├── benchmarks/            Side-by-side Three.js vs TinyThree harness
├── assets/
│   └── icon.svg
└── docs/                  AI planning notes (git-ignored)
```

---

## Data flow

### Compile time

1. **Scene runner** — imports the user's TypeScript module with `tsx`. Three.js geometry
   math runs natively in Node.js (no WebGL needed). The `buildScene()` function returns a
   `THREE.Scene` object with real geometries and materials populated.

2. **Analyzer** — walks the scene graph:
   - Detects groups of meshes with identical `(geometry fingerprint, material uuid)` and
     marks them as instancing candidates.
   - Validates that only supported material and geometry types are used.
   - Estimates output sizes.

3. **Serializer** — writes `scene.bin` (TSCN v1):
   - `FILE HEADER` (32 B): magic `"TSCN"`, version, feature flags, segment sizes.
   - `META SEGMENT`: flat tables of node records, geometry records, material records,
     transform records (with world matrices pre-multiplied for static nodes).
   - `DATA SEGMENT`: raw `Float32Array` vertex buffers and `Uint16Array` index buffers
     aligned to 4/16 bytes — passed directly to `gl.bufferData` without copying.

### Runtime (per-session)

1. JS host calls `tt_alloc(size)` and copies `scene.bin` bytes into WASM linear memory.
2. JS host calls `tt_init(ptr, size, w, h)`:
   - Validates magic bytes and version.
   - Parses flat tables (O(n) linear scan, no allocations after arena is populated).
   - Uploads VBOs and creates VAOs (one per geometry).
   - Compiles 4 shader variants (unlit-color, unlit-texture, points, lines).
   - Builds a **flat draw list** sorted by `(shader, material, geometry)` to minimise
     WebGL state changes. Static world matrices are already in the list.
3. Every `requestAnimationFrame`, JS calls `tt_frame(timestamp)`:
   - If animations exist: interpolate transforms, propagate dirty flags, update matrices.
   - Iterate draw list: bind program (if changed), set uniforms, bind VAO (if changed),
     call `gl.drawElements` or `gl.drawElementsInstanced`.
   - Zero heap allocations. Zero JavaScript in the hot path.

---

## Scene format (TSCN v1) — quick reference

| Offset | Size | Field            |
|--------|------|------------------|
| 0x00   | 4    | magic `TSCN`     |
| 0x04   | 2+2  | version major/minor |
| 0x08   | 4    | feature flags    |
| 0x0C   | 4    | meta_size        |
| 0x10   | 4    | string_heap_size (0 in v1) |
| 0x14   | 4    | data_size        |
| 0x18   | 4    | checksum (reserved, must be 0) |
| 0x1C   | 4    | reserved         |

Full schema: `packages/compiler/src/serialize.ts` + `runtime/src/tinythree.c`.

---

## Runtime public API

```c
// runtime/include/tinythree.h

int32_t  tt_init   (const uint8_t *scene_data, uint32_t scene_size,
                    uint32_t width, uint32_t height);
void     tt_frame  (double timestamp);
void     tt_resize (uint32_t width, uint32_t height);
void     tt_destroy(void);
uint8_t *tt_alloc  (uint32_t size);
```

From JavaScript (via `loader.js`):

```js
import { start } from './loader.js';

const handle = await start(canvas);
handle.resize(800, 600);
handle.stop();
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

### Not supported (use Three.js directly)
`ShaderMaterial` · `MeshStandardMaterial` · `MeshPhysicalMaterial` ·
skeletal animation · morph targets · WebXR · post-processing · physics

---

## Compiler error codes

| Code | Category                     | Blocks? |
|------|------------------------------|---------|
| E001 | Unsupported material type    | Yes     |
| E002 | Dynamic / async asset loading| Yes     |
| E003 | Custom shader (ShaderMaterial)| Yes    |
| E004 | Scene exceeds size limits    | Yes     |
| E005 | Invalid module export        | Yes     |
| W001 | Dynamic transform detected   | No      |
| W010 | Unknown geometry type        | No      |
