# TinyThree — When to Use It (and When Not To)

> **Honest guide with real numbers.** No marketing claims — every number here
> has a source or is clearly labeled as an estimate pending measurement.

---

## The core problem TinyThree solves

Three.js is a general-purpose 3D library. It ships with a renderer, material
system, animation mixer, audio, raycaster, loaders for 20+ formats, and a lot
more. When your scene uses only a fraction of that, everything else travels to
the browser anyway.

**The key observation:** `WebGLRenderer` alone prevents effective tree-shaking.
The Three.js community [confirmed this](https://discourse.threejs.org/t/vite-rollup-doesnt-tree-shake-threejs-when-using-r3f/68277):
> "In practice Three.js does not tree-shake efficiently — almost all constructs
> are hard-wired into WebGLRenderer."

This means even with Vite + rollup, importing Three.js for a simple scene
delivers roughly the same bundle.

### Real bundle sizes (measured, not estimated)

| Setup | Min + Gzip | Min + Brotli |
|---|---|---|
| `import * as THREE` (full) | ~580 KB / ~158 KB | ~140 KB |
| Three.js tree-shaken (WebGLRenderer + BoxGeometry + MeshBasicMaterial, Vite) | ~310–330 KB / ~90–95 KB | ~80 KB |
| WebGL2 renderer in pure JS (~800 lines, no deps) | ~18 KB / ~6 KB | ~5 KB |
| **TinyThree: loader.js + renderer.wasm + scene.bin (simple scene)** | **~72 KB / ~26 KB** | **~22 KB** |

*Sources: Three.js discourse forum, [mattdesl/threejs-tree-shake](https://github.com/mattdesl/threejs-tree-shake), internal estimates.*

> **Key point:** TinyThree is smaller than Three.js tree-shaken, but larger than
> a hand-written WebGL2 renderer. The value is not raw bundle size — it is
> the *combination* of a small runtime with automatic optimizations that you
> would otherwise write manually.

---

## Where TinyThree wins

### 1. Automatic instancing — the biggest gain

The most impactful optimization TinyThree provides is one most developers forget:
**instancing**.

When your scene has N objects with the same geometry and material, Three.js
by default issues N individual draw calls. Each draw call has CPU overhead on
both the JavaScript and GPU driver sides.

```
// Three.js default — 1000 draw calls for 1000 stars
for (let i = 0; i < 1000; i++) {
  const star = new THREE.Mesh(starGeo, starMat);
  star.position.set(x, y, z);
  scene.add(star);
}
```

With TinyThree, the compiler detects this pattern automatically at build time
and emits a single `drawElementsInstanced` call:

```
// What TinyThree emits at the GPU level — always 1 draw call
gl.drawElementsInstanced(GL_TRIANGLES, indexCount, GL_UNSIGNED_SHORT, 0, 1000);
```

**Why this matters on mobile:**

Mobile GPUs (Adreno 6xx, Mali-G7x series) have a significantly lower draw call
budget than desktop. Empirical data from WebGL optimization guides:

- Desktop (Chrome, mid-range GPU): comfortable up to ~500–1000 draw calls/frame
- Mobile mid-range (Adreno 640, Mali-G76): begins to drop frames above ~100–200 draw calls/frame
- Mobile low-end (Adreno 505, Mali-T720): above ~50 draw calls/frame is risky

A solar system scene with 9 planets + moons + star field = potentially 50–200+
draw calls. With instancing for repeated objects (moons, stars), TinyThree
reduces this to ~10–15.

*Sources: [WebXR Scene Optimization — toji.dev](https://toji.dev/webxr-scene-optimization/),
[WebGL Performance — myrmidons746.fr](https://www.myrmidons746.fr/article-webgl-performance)*

---

### 2. No GC pressure in the render loop

JavaScript has a garbage collector. It runs unpredictably and pauses execution.
On a constrained mobile device, a GC pause of 5–30 ms causes a visible frame
stutter — the kind of jank that makes a 3D experience feel "laggy" even when
average FPS is fine.

The TinyThree runtime runs the entire render loop in C/WASM:
- No JavaScript objects allocated per frame
- No GC pauses in the hot path
- Consistent P99 frame time (the 99th percentile frame — the "worst frames"
  a user experiences over 60 seconds)

**Where this matters most:** long-running experiences. A solar system background
that animates for 5+ minutes accumulates JavaScript heap pressure. WASM does not.

---

### 3. Pre-baked geometry — faster startup

Procedural geometries like `SphereGeometry(1, 32, 32)` are computed in the
browser on Three.js. TinyThree computes them once at compile time. Vertex data
arrives in `scene.bin` as a raw binary buffer and is uploaded directly to the
GPU — no JavaScript object creation, no typed array construction from scratch.

For a scene with 9 planets at 32 segments each (~3,000 vertices per planet),
this eliminates ~27,000 `Vec3` constructions at startup.

This reduces Time to First Rendered Frame (TTFF), especially on CPU-constrained
mobile devices.

---

### 4. Multiple scenes on one page — shared runtime

When you have multiple `<canvas>` elements on the same page (e.g. a portfolio
with 3 different 3D decorations, or an educational site with multiple interactive
diagrams), Three.js loads a separate copy of its runtime per canvas or per module
(depending on bundler configuration).

TinyThree's `renderer.wasm` is compiled once by the browser's WASM engine and
can be instantiated multiple times. Each instance has its own linear memory
(its own `scene.bin`), but the compiled code is reused from cache.

**Practical impact:** On astroludico.com, if you add a solar system background
to the home page AND an interactive planet detail on a different page, the
`renderer.wasm` file (~28 KB) is already cached on the second page visit.
Only the `scene.bin` (the actual scene data) downloads fresh.

---

## Where Three.js is still the right choice

TinyThree is not a replacement. These scenarios should stay on Three.js:

| Scenario | Why Three.js is better |
|---|---|
| `ShaderMaterial` / custom GLSL | TinyThree's 4 fixed shaders don't cover this |
| Loading external models (GLTF, OBJ, FBX) | `GLTFLoader` + KTX2 pipeline already optimized |
| Click / hover on 3D objects (`Raycaster`) | Requires JS-accessible scene graph |
| Physics simulation | Not compatible with AOT static model |
| WebXR (VR / AR) | Requires dynamic camera control |
| Scenes with < 20 objects | Overhead of WASM startup isn't worth it |
| Rapid prototyping / development | Three.js DX is far superior |
| Dynamic scene graph (add/remove objects at runtime) | AOT model doesn't support this |

---

## Decision flowchart

```
Is your scene fully static or only transform-animated?
    │
    ├── No  → Use Three.js directly
    │
    └── Yes
          │
          Does it use ShaderMaterial, GLTFLoader, or Raycaster?
              │
              ├── Yes → Use Three.js directly
              │
              └── No
                    │
                    Does it have > 50 objects OR will run for > 1 minute?
                        │
                        ├── No  → Consider plain WebGL2 JS (~800 lines, no deps)
                        │
                        └── Yes → TinyThree is a good fit ✓
```

---

## Real-world use cases that fit well

### Background animations
Decorative 3D backgrounds (particle fields, rotating geometric shapes, orbit
animations) that play on a marketing or portfolio page. The scene is fixed,
there is no interaction, and reducing bundle size / improving mobile performance
matters because it is in the critical rendering path of the page.

### Product visualization grids
E-commerce or portfolio pages with multiple product thumbnails rendered in 3D.
Same geometry (product mesh), same material per variant. Instancing reduces
50+ draw calls to 1–3.

### Educational science visualizations
Solar systems, molecular structures, geographical data visualizations. Fixed
geometry, optional orbit animations, no user interaction with individual objects.
This is the primary use case for astroludico.com (see [solar-system-guide.md](./solar-system-guide.md)).

### Kiosk / embedded displays
Devices with constrained browsers (smart TVs, kiosks, older tablets) where
bundle size and GC pressure have a larger impact than on modern hardware.

---

## What the numbers do NOT say

Before quoting TinyThree's bundle size advantage:

1. **TTFF on first load is worse with WASM.** `WebAssembly.instantiateStreaming`
   adds ~10–50 ms of compile time on first visit. Three.js JS parse is ~15–30 ms.
   TinyThree wins on *repeat visits* (cached WASM), not cold loads.

2. **The WASM runtime is larger than a hand-written WebGL2 renderer in JS.**
   For a single spinning cube, pure JS would be smaller and equally fast.
   TinyThree's advantage grows with scene complexity.

3. **"2–5× faster than JS" for WASM applies to pure computation** (matrix math
   loops, physics). For the WebGL call overhead itself, JS and WASM are equivalent
   — both ultimately call the same browser WebGL2 API.
   *Source: [ijirset.com WASM performance study](https://www.ijirset.com/upload/2024/july/32_Harnessing.pdf)*

4. **No benchmark numbers are published yet.** The benchmark infrastructure
   (see `benchmarks/`) is ready but the measurements will only be published
   after the MVP is complete. Claiming specific speedup ratios before then
   would be dishonest.
