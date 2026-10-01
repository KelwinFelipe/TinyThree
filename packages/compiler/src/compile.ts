import path from 'node:path';
import fs   from 'node:fs/promises';
import { analyze }   from './analyze.js';
import { serialize } from './serialize.js';
import type { CompileOptions, CompileResult } from './types.js';

/**
 * Compile a Three.js scene module to TinyThree runtime assets.
 *
 * @example
 * ```ts
 * import { compile } from '@tinythree/compiler';
 *
 * const result = await compile({ scenePath: './src/scene.ts', outDir: './dist' });
 * console.log(`scene.bin  ${result.sizes.sceneBin} bytes`);
 * console.log(`loader.js  ${result.sizes.loaderJs} bytes`);
 * ```
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  const startMs = Date.now();

  const scenePath = path.resolve(options.scenePath);
  const outDir    = path.resolve(options.outDir ?? './dist');
  const publicPath = options.publicPath ?? './';

  // ── 1. Load the scene module (Three.js runs natively in Node.js) ────────────
  const mod = await import(scenePath) as { default?: unknown; buildScene?: unknown };
  const builderFn = mod.default ?? mod.buildScene;

  if (typeof builderFn !== 'function') {
    throw new Error(
      `Scene module "${scenePath}" must export a default function \`buildScene()\`.\n` +
      `See: https://github.com/your-username/tinythree/blob/main/docs/compiler.md`
    );
  }

  const raw = await builderFn();
  // Accept both { scene, camera, animations } and plain THREE.Scene
  const { scene, camera, animations } = normalizeBuilderResult(raw);

  // ── 2. Analyze ───────────────────────────────────────────────────────────────
  const analysis = await analyze({ scene, camera, animations });

  if (analysis.errors.length > 0) {
    const summary = analysis.errors.map(e => `  [${e.code}] ${e.message}`).join('\n');
    throw new Error(`Compilation failed with ${analysis.errors.length} error(s):\n${summary}`);
  }

  // ── 3. Serialize → scene.bin ─────────────────────────────────────────────────
  await fs.mkdir(outDir, { recursive: true });

  const binBuffer = await serialize({ scene, camera, animations, analysis });
  const binPath   = path.join(outDir, 'scene.bin');
  await fs.writeFile(binPath, binBuffer);

  if (options.debug) {
    const debugPath = path.join(outDir, 'scene.debug.json');
    await fs.writeFile(debugPath, JSON.stringify(buildDebugJson(scene, analysis), null, 2));
  }

  // ── 4. Copy prebuilt runtime.wasm ────────────────────────────────────────────
  const wasmSrc  = new URL('../../runtime/prebuilt/renderer.wasm', import.meta.url);
  const wasmDest = path.join(outDir, 'renderer.wasm');
  await fs.copyFile(wasmSrc.pathname, wasmDest);
  const wasmSize = (await fs.stat(wasmDest)).size;

  // ── 5. Emit loader.js ────────────────────────────────────────────────────────
  const loaderPath = path.join(outDir, 'loader.js');
  await fs.writeFile(loaderPath, buildLoaderJs(publicPath));
  const loaderSize = (await fs.stat(loaderPath)).size;

  if (!options.silent) {
    printSummary({ binPath, binSize: binBuffer.byteLength, wasmSize, loaderSize, analysis });
  }

  return {
    sceneBin: binPath,
    loaderJs: loaderPath,
    sizes: {
      sceneBin: binBuffer.byteLength,
      loaderJs: loaderSize,
      wasmRuntime: wasmSize,
    },
    analysis,
    durationMs: Date.now() - startMs,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

import type * as THREE from 'three';
import type { SceneBuilderResult } from './types.js';

function normalizeBuilderResult(raw: unknown): Required<SceneBuilderResult> {
  if (raw && typeof raw === 'object' && 'scene' in raw) {
    const r = raw as SceneBuilderResult;
    return {
      scene:      r.scene,
      camera:     r.camera ?? createDefaultCamera(),
      animations: r.animations ?? [],
    };
  }
  // Plain THREE.Scene
  return {
    scene:      raw as THREE.Scene,
    camera:     createDefaultCamera(),
    animations: [],
  };
}

function createDefaultCamera() {
  const { PerspectiveCamera } = await import('three') as typeof THREE;
  return new PerspectiveCamera(75, 16 / 9, 0.1, 1000);
}

function buildLoaderJs(publicPath: string): string {
  return `/**
 * TinyThree loader — auto-generated, do not edit manually.
 * Re-generate with: npx tinythree compile <scene>
 */
const WASM_URL  = '${publicPath}renderer.wasm';
const SCENE_URL = '${publicPath}scene.bin';

let _instance = null;

export async function start(canvas) {
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('[TinyThree] WebGL2 not supported in this browser.');

  const [wasmModule, sceneData] = await Promise.all([
    WebAssembly.compileStreaming(fetch(WASM_URL)),
    fetch(SCENE_URL).then(r => r.arrayBuffer()),
  ]);

  const imports = buildImports(gl);
  _instance = await WebAssembly.instantiate(wasmModule, imports);

  const { exports } = _instance;
  const ptr = exports.tt_alloc(sceneData.byteLength);
  new Uint8Array(exports.memory.buffer).set(new Uint8Array(sceneData), ptr);
  exports.tt_init(ptr, sceneData.byteLength, canvas.width, canvas.height);

  let rafId;
  function loop(ts) {
    exports.tt_frame(ts);
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  return {
    resize(w, h) { exports.tt_resize(w, h); },
    stop()       { cancelAnimationFrame(rafId); exports.tt_destroy(); _instance = null; },
  };
}

function buildImports(gl) {
  // WebGL2 import table — called from C via Emscripten GLES3 bindings
  return {
    env: {
      tt_log: (ptr, len) => {
        const bytes = new Uint8Array(_instance.exports.memory.buffer, ptr, len);
        console.log('[TinyThree]', new TextDecoder().decode(bytes));
      },
    },
  };
}
`;
}

function buildDebugJson(scene: THREE.Scene, analysis: ReturnType<typeof analyze> extends Promise<infer T> ? T : never) {
  return {
    _note: 'Debug output — not loaded by the runtime. Use for compiler debugging only.',
    analysis,
    sceneGraph: sceneToJson(scene),
  };
}

function sceneToJson(obj: THREE.Object3D): object {
  return {
    type: obj.type,
    name: obj.name,
    uuid: obj.uuid,
    children: obj.children.map(sceneToJson),
  };
}

function printSummary(opts: {
  binPath: string; binSize: number;
  wasmSize: number; loaderSize: number;
  analysis: Awaited<ReturnType<typeof analyze>>;
}) {
  const total = opts.binSize + opts.wasmSize + opts.loaderSize;
  console.log('\n✓ TinyThree compiled successfully\n');
  console.log(`  scene.bin     ${fmt(opts.binSize)}`);
  console.log(`  renderer.wasm ${fmt(opts.wasmSize)}`);
  console.log(`  loader.js     ${fmt(opts.loaderSize)}`);
  console.log(`  ─────────────────────────`);
  console.log(`  total         ${fmt(total)}\n`);
  console.log(`  meshes        ${opts.analysis.meshCount}`);
  console.log(`  draw calls    ${opts.analysis.optimizations.find(o => o.type === 'instancing-promoted')?.drawCallsAfter ?? opts.analysis.meshCount}`);
}

function fmt(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
