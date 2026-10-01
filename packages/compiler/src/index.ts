/**
 * @tinythree/compiler
 *
 * AOT compiler for Three.js scenes.
 *
 * Workflow:
 *  1. Execute the user's scene module in Node.js (Three.js runs natively — no mock/shim)
 *  2. Call the exported `buildScene()` function to obtain a THREE.Scene
 *  3. Serialize the scene graph to the TinyThree IR format (scene.bin)
 *  4. Emit loader.js bootstrapped with the correct asset URLs
 *
 * The user's scene file must export a default function `buildScene()` that returns
 * a `THREE.Scene`. It must NOT use `WebGLRenderer`, async loaders, or `Math.random()`
 * for positions — see docs/compiler.md for the full constraint list.
 */

export { compile }   from './compile.js';
export { analyze }   from './analyze.js';
export { serialize } from './serialize.js';
export type { CompileOptions, CompileResult, SceneAnalysis } from './types.js';
