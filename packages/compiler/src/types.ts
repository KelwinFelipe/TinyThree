import type * as THREE from 'three';

// ─── Compile options ──────────────────────────────────────────────────────────

export interface CompileOptions {
  /** Path to the scene TypeScript/JavaScript module. Must export `buildScene()`. */
  scenePath: string;

  /** Output directory. Defaults to `./dist`. */
  outDir?: string;

  /**
   * Base URL prefix written into loader.js for asset URLs.
   * Example: '/static/scenes/'  → loader fetches '/static/scenes/scene.bin'
   * Defaults to './'.
   */
  publicPath?: string;

  /**
   * Emit a human-readable `scene.debug.json` alongside `scene.bin`.
   * Useful during development. Never loaded by the runtime.
   */
  debug?: boolean;

  /** Silence all console output. */
  silent?: boolean;
}

// ─── Compile result ───────────────────────────────────────────────────────────

export interface CompileResult {
  /** Absolute path to the emitted scene.bin */
  sceneBin: string;

  /** Absolute path to the emitted loader.js */
  loaderJs: string;

  /** Sizes in bytes */
  sizes: {
    sceneBin: number;
    loaderJs: number;
    /** Estimated WASM size (copied from prebuilt runtime) */
    wasmRuntime: number;
  };

  /** Scene analysis (same data as `analyze()`) */
  analysis: SceneAnalysis;

  /** Compilation time in milliseconds */
  durationMs: number;
}

// ─── Scene analysis ───────────────────────────────────────────────────────────

export interface SceneAnalysis {
  /** Total number of Object3D nodes (including invisible ones) */
  nodeCount: number;

  meshCount: number;
  materialCount: number;
  textureCount: number;
  animationCount: number;

  /** Features actually used — determines which runtime profile is needed */
  features: RuntimeFeature[];

  /** Optimizations the compiler will apply */
  optimizations: OptimizationHint[];

  /** Problems that block compilation */
  errors: DiagnosticMessage[];

  /** Non-blocking warnings */
  warnings: DiagnosticMessage[];

  /** Estimated output sizes in bytes */
  estimatedSizes: {
    sceneBin: number;
    wasmRuntime: number;
    loaderJs: number;
    totalBrotli: number;
  };
}

export type RuntimeFeature =
  | 'perspective-camera'
  | 'ortho-camera'
  | 'mesh'
  | 'points'
  | 'lines'
  | 'instancing'
  | 'basic-material'
  | 'points-material'
  | 'line-material'
  | 'texture'
  | 'transform-animation';

export interface OptimizationHint {
  type: 'instancing-promoted' | 'material-deduplicated' | 'geometry-merged' | 'transform-baked';
  description: string;
  /** Estimated draw call reduction */
  drawCallsBefore?: number;
  drawCallsAfter?: number;
}

export interface DiagnosticMessage {
  /** Error/warning code, e.g. E001 */
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

// ─── Scene builder contract ───────────────────────────────────────────────────

/** The shape that `buildScene()` must return */
export interface SceneBuilderResult {
  scene: THREE.Scene;
  camera?: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  animations?: THREE.AnimationClip[];
}

/** Type of the default export from a user scene module */
export type SceneBuilderFn = () => SceneBuilderResult | THREE.Scene;
