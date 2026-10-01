# Solar System 3D — Implementation Guide for astroludico.com

This guide covers how to build a high-quality, interactive 3D solar system that
runs at 60 FPS on mid-range and older mobile devices — and how TinyThree fits
into that picture.

---

## The goal

A solar system visualization for astroludico.com that:

- Looks **visually impressive** — realistic planet textures, atmosphere glow,
  star field, orbit rings
- Runs at **60 FPS on mid-range Android** (Snapdragon 665 class, ~2019–2021)
- Works on **older iOS** (iPhone 8, iOS 15, A11 chip)
- Loads **fast** — under 3 seconds on a 4G connection
- Is **navigable** — user can rotate, zoom, click on planets
- Has **no visible jank** — smooth animation even after minutes of use

---

## Reality check: what "high quality on old mobile" actually means

Before designing anything, understand the hardware constraints.

### GPU budget on a mid-range Android (2019–2021)

| Resource | Safe budget |
|---|---|
| Draw calls per frame | **≤ 50** (ideally ≤ 20) |
| Triangles per frame | **≤ 200,000** |
| Texture memory | **≤ 128 MB** (total VRAM) |
| JavaScript per frame | **≤ 4 ms** (leaves 12.6 ms for GPU at 60 FPS) |
| JS heap | **≤ 150 MB** |

*Sources: [WebXR Scene Optimization — toji.dev](https://toji.dev/webxr-scene-optimization/),
[The Interaction Budget — hackernoon](https://hackernoon.com/the-interaction-budget-keeping-webgl-interfaces-usable-on-real-devices),
[WebGL 3D Apparel Viewers — style3d.com](https://www.style3d.com/blog/webgl-3d-apparel-viewers-for-mobile-buyers-explained/)*

A photorealistic solar system with 9 planets × 64 segments + atmosphere + star
field naively generates:

```
9 planets × 1 draw call      =  9 draw calls
9 planet atmospheres          =  9 draw calls   (glow/atmosphere pass)
1 sun + glow                  =  2 draw calls
rings (Saturn)                =  1 draw call
10,000 stars (naive)          = 10,000 draw calls  ← this kills mobile
9 orbit rings                 =  9 draw calls
total (naive)                 = ~10,030 draw calls  ← 200× over budget
```

With the right techniques:

```
9 planets × 1 draw call      =  9 draw calls
9 atmospheres (sprite-based)  =  1 draw call   (texture atlas, 1 instanced)
1 sun + glow                  =  2 draw calls
rings (Saturn)                =  1 draw call
10,000 stars                  =  1 draw call   (1 Points draw call)
9 orbit rings                 =  1 draw call   (merged geometry)
total (optimized)             = ~15 draw calls  ✓ well within mobile budget
```

This is achievable. Let's walk through each technique.

---

## Recommended architecture: Three.js for interactivity, TinyThree for the background

This is the critical design decision.

### Option A — TinyThree only (compiled, static)

```
scene.ts → TinyThree compile → scene.bin + renderer.wasm + loader.js
```

**What you get:** Smallest bundle, zero GC in render loop, automatic instancing.

**What you lose:** No `Raycaster` (can't click on planets), no dynamic labels,
no OrbitControls, no camera tweening when selecting a planet.

**When this is the right choice:** A *decorative* solar system — beautiful
background animation that spins and looks impressive, but the user doesn't
interact with it directly.

**Example use in astroludico.com:** A rotating solar system as the hero section
background, or as a visual on a planet/astrology page where planets orbit but
the user doesn't click them.

---

### Option B — Three.js with manual optimizations

```
Three.js + InstancedMesh for stars + Points for particles
+ OrbitControls + Raycaster for interaction
```

**What you get:** Full interactivity — click planets, zoom, orbit camera,
labels, tooltips, animations.

**What you lose:** Full Three.js bundle (~80–95 KB Brotli tree-shaken), GC
pressure over time, manual instancing boilerplate.

**When this is the right choice:** An interactive solar system where users
explore planets, click for info, rotate the view.

**Example use in astroludico.com:** A dedicated `/solar-system` page or
interactive widget where astrology/astronomy is the main content.

---

### Option C — Hybrid (recommended for astroludico.com)

Use **TinyThree for the visual rendering** + a thin **JavaScript interaction
layer** on top.

```
TinyThree runtime (render loop, no GC)
     +
Overlay JS (Raycaster via screen-space projection, labels via CSS/HTML)
```

The render loop is in WASM (no GC, fast). Interaction is handled in JS but
only on user input (click/touch events), not every frame. Labels and tooltips
are HTML elements positioned over the canvas using screen-space projection
math — not rendered in WebGL at all.

This is how high-performance mobile 3D apps work in practice (games and
visualization tools overlay HTML for UI rather than rendering it in 3D).

---

## Scene budget breakdown for a real solar system

### Geometry

| Object | Segments | Triangles | Draw calls |
|---|---|---|---|
| Sun | 48×48 | ~4,600 | 1 |
| Earth, Mars, Venus, Jupiter... (8 planets) | 32×32 each | ~2,000 × 8 = 16,000 | 8 |
| Moon (Earth's) | 24×24 | ~1,150 | 1 |
| Saturn rings | PlaneGeometry (disc) | ~2 triangles per quad × 200 = 400 | 1 |
| Star field | 10,000 points | N/A (Points) | **1** |
| Orbit lines (9) | LineLoop 128 pts each | ~128 × 9 = 1,152 segments | **1** (merged) |
| **Total** | | **~22,000 triangles** | **~13 draw calls** |

22,000 triangles is well within mobile budget. Even an iPhone 8 handles
100,000+ triangles at 60 FPS for a non-transparent scene.

### Textures

The biggest mobile performance risk is texture memory, not triangle count.

| Texture | Resolution | Format | GPU memory |
|---|---|---|---|
| Sun diffuse | 2048×2048 | KTX2/ETC2 | ~2 MB |
| Earth diffuse + normal | 2048×2048 × 2 | KTX2/ETC2 | ~4 MB |
| Other 7 planets (diffuse) | 1024×1024 × 7 | KTX2/ETC2 | ~3.5 MB |
| Moon | 1024×1024 | KTX2/ETC2 | ~0.5 MB |
| Saturn rings | 1024×256 | KTX2/ETC2 | ~0.1 MB |
| Star field (not a texture — Points) | — | — | 0 |
| Skybox / stars background | 2048×2048 cube | KTX2/ETC2 | ~6 MB |
| **Total** | | | **~16 MB GPU** |

16 MB texture memory fits comfortably within the 128 MB mobile budget.

**Critical: Use KTX2 / Basis Universal compression for all textures.**

PNG or JPEG textures are decompressed to full RGBA when uploaded to the GPU.
A 2048×2048 PNG = ~16 MB of GPU memory. The same texture in KTX2/ETC2 =
~2 MB — stays compressed *on the GPU*, not just in download.

Free planet texture sources:
- [Solar System Scope Textures](https://www.solarsystemscope.com/textures/) — CC BY 4.0, high quality, 8K available
- [NASA Visible Earth](https://visibleearth.nasa.gov/) — public domain
- [JHT Planetary Pixel Emporium](http://planetpixelemporium.com/) — free for personal use

Convert to KTX2 with:
```bash
# Install: https://github.com/KhronosGroup/KTX-Software
toktx --encode etc1s --generate-mipmap output.ktx2 input.png
```

---

## Implementation: Three.js version (interactive)

This is the recommended approach for an interactive solar system page.

### File structure

```
src/
├── solar-system/
│   ├── SolarSystem.ts        main class
│   ├── Planet.ts             individual planet with orbit
│   ├── StarField.ts          10k star Points
│   ├── OrbitLine.ts          merged orbit ring geometry
│   ├── SunGlow.ts            sprite-based corona effect
│   └── textures/
│       ├── earth.ktx2
│       ├── mars.ktx2
│       └── ...
```

### Key implementation patterns

#### Stars — always use Points, never individual meshes

```ts
// ✓ CORRECT — 1 draw call for 10,000 stars
const positions = new Float32Array(10_000 * 3);
// fill with deterministic positions (golden ratio spiral avoids clumping)
for (let i = 0; i < 10_000; i++) {
  const t     = i / 10_000;
  const r     = Math.sqrt(t) * 400;
  const theta = i * 2.399963; // golden angle in radians
  positions[i * 3]     = r * Math.cos(theta);
  positions[i * 3 + 1] = (t - 0.5) * 400;
  positions[i * 3 + 2] = r * Math.sin(theta);
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const stars = new THREE.Points(geo, new THREE.PointsMaterial({
  color: 0xffffff,
  size: 0.3,
  sizeAttenuation: true,
}));
scene.add(stars); // 1 draw call regardless of star count
```

```ts
// ✗ WRONG — 10,000 draw calls
for (let i = 0; i < 10_000; i++) {
  const star = new THREE.Mesh(starGeo, starMat);
  star.position.set(x, y, z);
  scene.add(star);
}
```

#### Orbit lines — merge into one geometry

```ts
// ✓ CORRECT — all orbit rings in 1 draw call
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const orbitGeos = PLANETS.map(p => {
  const geo = new THREE.RingGeometry(p.distance, p.distance + 0.05, 128);
  geo.rotateX(-Math.PI / 2);
  return geo;
});
const merged   = mergeGeometries(orbitGeos);
const orbits   = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({
  color: 0x334466,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.4,
}));
scene.add(orbits); // 1 draw call for ALL orbit rings
```

#### Planets — keep them as individual meshes (they move)

Planets cannot be instanced because they have different sizes, textures, and
move independently. They stay as individual `Mesh` objects — 9 draw calls total,
which is fine.

```ts
const PLANETS = [
  { name: 'mercury', radius: 0.25, distance: 5,   texture: 'mercury.ktx2', speed: 4.1 },
  { name: 'venus',   radius: 0.45, distance: 8,   texture: 'venus.ktx2',   speed: 1.6 },
  { name: 'earth',   radius: 0.50, distance: 11,  texture: 'earth.ktx2',   speed: 1.0 },
  { name: 'mars',    radius: 0.35, distance: 15,  texture: 'mars.ktx2',    speed: 0.5 },
  { name: 'jupiter', radius: 1.20, distance: 22,  texture: 'jupiter.ktx2', speed: 0.08 },
  { name: 'saturn',  radius: 1.00, distance: 30,  texture: 'saturn.ktx2',  speed: 0.03 },
  { name: 'uranus',  radius: 0.70, distance: 37,  texture: 'uranus.ktx2',  speed: 0.011 },
  { name: 'neptune', radius: 0.65, distance: 44,  texture: 'neptune.ktx2', speed: 0.006 },
];

const ktx2Loader = new KTX2Loader()
  .setTranscoderPath('/ktx2-transcoder/')
  .detectSupport(renderer);

for (const p of PLANETS) {
  const tex    = await ktx2Loader.loadAsync(`/textures/${p.texture}`);
  const mesh   = new THREE.Mesh(
    new THREE.SphereGeometry(p.radius, 32, 32),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  mesh.userData = { planet: p }; // store for Raycaster
  scene.add(mesh);
}
```

> **Note:** `MeshBasicMaterial` does not respond to light — planets are self-lit.
> For a more realistic look with lighting, use `MeshStandardMaterial` but add a
> single `PointLight` at the sun position. Standard material adds ~2 ms/frame
> overhead on mobile — acceptable for 9 planets.

#### Click interaction — Raycaster with debounce

```ts
const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();
const planets   = []; // collect planet meshes

canvas.addEventListener('pointerdown', (e) => {
  // Normalize to [-1, +1]
  pointer.x =  (e.clientX / canvas.clientWidth)  * 2 - 1;
  pointer.y = -(e.clientY / canvas.clientHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(planets);

  if (hits.length > 0) {
    const planet = hits[0].object.userData.planet;
    showPlanetInfo(planet); // show HTML overlay — NOT WebGL
  }
});
```

This runs only on user input (click/touch), not every frame — zero per-frame cost.

#### Sun glow — sprite, not geometry

```ts
// Cheap sun corona — 1 sprite draw call, looks great on all devices
const glowTex  = textureLoader.load('/textures/sun-glow.png');
const glowMat  = new THREE.SpriteMaterial({
  map: glowTex,
  color: 0xffaa22,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const glow = new THREE.Sprite(glowMat);
glow.scale.set(8, 8, 1); // larger than the sun mesh
sun.add(glow); // child of sun — moves with it
```

---

## Implementation: TinyThree version (decorative background)

If you want the solar system as a **decorative animated background** with no
click interaction, TinyThree gives you the lightest possible bundle.

### The scene file

```ts
// src/scenes/solar-system.ts
import * as THREE from 'three';

// Deterministic positions — no Math.random()
function starPositions(count: number): Float32Array {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const r = Math.sqrt(t) * 300;
    const a = i * 2.399963;
    pos[i * 3]     = r * Math.cos(a);
    pos[i * 3 + 1] = (t - 0.5) * 300;
    pos[i * 3 + 2] = r * Math.sin(a);
  }
  return pos;
}

export default function buildScene() {
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(0, 30, 60);
  camera.lookAt(0, 0, 0);

  // Star field — 1 draw call
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions(8_000), 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.2 })));

  // Sun
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(2, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xffdd44 }),
  );
  scene.add(sun);

  // Planets — individual meshes (different sizes/colors)
  const PLANETS = [
    { r: 0.25, d: 5,  color: 0xb5b5b5 }, // mercury
    { r: 0.45, d: 8,  color: 0xe8c97d }, // venus
    { r: 0.50, d: 11, color: 0x3a7bd5 }, // earth
    { r: 0.35, d: 15, color: 0xc1440e }, // mars
    { r: 1.20, d: 22, color: 0xc88b3a }, // jupiter
    { r: 1.00, d: 30, color: 0xd4b483 }, // saturn
    { r: 0.70, d: 37, color: 0x7de8e8 }, // uranus
    { r: 0.65, d: 44, color: 0x4b70dd }, // neptune
  ];

  for (const p of PLANETS) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(p.r, 32, 32),
      new THREE.MeshBasicMaterial({ color: p.color }),
    );
    // Position on X axis — runtime animates orbit
    mesh.position.set(p.d, 0, 0);
    scene.add(mesh);
  }

  return { scene, camera };
}
```

```bash
npx tinythree compile src/scenes/solar-system.ts --out public/solar
```

Output: `scene.bin` (~45 KB) + `renderer.wasm` (~28 KB) + `loader.js` (~4 KB)
= **~77 KB total, ~28 KB Brotli** for the entire 3D experience.

**Limitation:** In the TinyThree MVP, orbit animation requires `AnimationClip`
keyframes (Level 1 support). Full orbit animation via `AnimationMixer`-style
procedural animation is post-MVP.

---

## Performance targets vs. reality

| Device | Expected FPS | Notes |
|---|---|---|
| iPhone 15 (A16) | 60 FPS stable | GPU is extremely fast |
| iPhone 8 (A11, iOS 15) | 55–60 FPS | WebGL2 supported since iOS 15 |
| iPhone 6s (A9, iOS 15) | 40–55 FPS | A9 is old but WebGL2 works |
| Samsung Galaxy A52 (Snapdragon 720G) | 55–60 FPS | Mid-range 2021 |
| Samsung Galaxy A12 (Helio P35) | 30–45 FPS | Low-end 2020 — reduce segment count |
| Redmi Note 8 (Snapdragon 665) | 45–60 FPS | Very common mid-range |

**For low-end devices:** Reduce sphere segments from 32 to 16 on the `navigator.hardwareConcurrency <= 4` heuristic. This halves triangle count with minimal visual difference at small sizes.

```ts
// Adaptive quality
const isLowEnd = navigator.hardwareConcurrency <= 4 ||
                 /Android/.test(navigator.userAgent) && window.devicePixelRatio < 2;
const segments = isLowEnd ? 16 : 32;
```

---

## Integration with astroludico.com

Based on the site content — astrology, numerology, soul maps — the solar system
fits naturally as a visual metaphor. Here are concrete integration points:

### Hero section background (decorative)

```html
<!-- Astro section hero -->
<section class="hero" style="position: relative;">
  <canvas id="solar-bg" style="
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    opacity: 0.6;
    z-index: 0;
  "></canvas>
  <div class="hero-content" style="position: relative; z-index: 1;">
    <!-- your existing content -->
  </div>
</section>

<script type="module">
  import { start } from '/solar/loader.js';

  // Only load when the section is visible (saves bandwidth on mobile)
  const observer = new IntersectionObserver(async ([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();

    const canvas = document.getElementById('solar-bg');
    canvas.width  = canvas.offsetWidth  * Math.min(devicePixelRatio, 2); // cap at 2× for performance
    canvas.height = canvas.offsetHeight * Math.min(devicePixelRatio, 2);

    const scene = await start(canvas);

    window.addEventListener('resize', () => {
      canvas.width  = canvas.offsetWidth  * Math.min(devicePixelRatio, 2);
      canvas.height = canvas.offsetHeight * Math.min(devicePixelRatio, 2);
      scene.resize(canvas.width, canvas.height);
    });
  }, { rootMargin: '200px' }); // preload 200px before visible

  observer.observe(document.getElementById('solar-bg'));
</script>
```

**`Math.min(devicePixelRatio, 2)`** is critical for mobile. On a device with
`devicePixelRatio = 3` (e.g. iPhone Pro), rendering at 3× means 9× the pixels
vs 1×. Capping at 2× cuts GPU work by ~56% with barely visible quality difference
at phone viewing distances.

### Planet / sign detail page (interactive)

For a page about a specific planet or astrological sign, use Three.js directly:

```tsx
// components/PlanetViewer.tsx (React / Astro island)
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export default function PlanetViewer({ planet }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas   = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const scene    = new THREE.Scene();
    const camera   = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 3);

    const controls = new OrbitControls(camera, canvas);
    controls.enableZoom    = false;
    controls.autoRotate    = true;
    controls.autoRotateSpeed = 0.5;

    // Load KTX2 texture for GPU-compressed quality
    const ktx2 = new KTX2Loader()
      .setTranscoderPath('/ktx2/')
      .detectSupport(renderer);

    ktx2.load(`/textures/${planet.name}.ktx2`, tex => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 64, 64), // higher quality for close-up
        new THREE.MeshStandardMaterial({ map: tex }),
      );
      scene.add(mesh);
      scene.add(new THREE.AmbientLight(0xffffff, 0.3));
      scene.add(Object.assign(new THREE.DirectionalLight(0xffffff, 1.5), {
        position: new THREE.Vector3(5, 3, 5),
      }));
    });

    let rafId;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      renderer.dispose();
    };
  }, [planet]);

  return <canvas ref={canvasRef} style={{ width: '100%', aspectRatio: '1' }} />;
}
```

This is plain Three.js — the right tool for an interactive, close-up planet view
where visual quality (64-segment sphere, MeshStandardMaterial + lighting) matters
more than bundle size.

---

## Summary: recommended stack for astroludico.com

| Use case | Tool | Why |
|---|---|---|
| Hero background solar system (decorative, animated) | **TinyThree** | ~28 KB Brotli, zero GC, lazy loaded |
| Interactive planet detail (click, rotate, zoom) | **Three.js** | Full Raycaster, OrbitControls, labels |
| Quick test / prototype | **Three.js** | Far easier DX |
| All planet textures | **KTX2 / Basis Universal** | 8× less GPU memory vs PNG, stays compressed on GPU |
| Star field (any implementation) | **THREE.Points** | Always 1 draw call, never individual meshes |
| Orbit rings (any implementation) | **mergeGeometries** | Always 1 draw call |

### Checklist before going live on mobile

- [ ] All textures converted to KTX2 (`toktx --encode etc1s`)
- [ ] `devicePixelRatio` capped at 2 in canvas setup
- [ ] Stars use `THREE.Points`, not individual meshes
- [ ] Orbit lines use merged `BufferGeometry`, not individual `LineLoop`s
- [ ] `IntersectionObserver` lazy-loads the canvas (don't load 3D on pages where it's not visible)
- [ ] Test on a real Android mid-range device (not just Chrome DevTools throttle)
- [ ] `antialias: false` on mobile (detect and disable: `antialias: !isMobile`)

```ts
const isMobile = /Android|iPhone|iPad/.test(navigator.userAgent);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isMobile, // ~15–20% GPU savings on mobile
  alpha: true,
  powerPreference: 'high-performance',
});
```
