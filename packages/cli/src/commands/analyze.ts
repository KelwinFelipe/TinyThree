import path from 'node:path';
import pc   from 'picocolors';
import { analyze } from '@tinythree/compiler';
import * as THREE from 'three';

export async function runAnalyze(args: string[]) {
  const scenePath = args.find(a => !a.startsWith('--'));
  if (!scenePath) {
    console.error(pc.red('Error: missing <scene> argument.'));
    process.exit(1);
  }

  const mod = await import(path.resolve(scenePath)) as { default?: unknown };
  const builderFn = mod.default;
  if (typeof builderFn !== 'function') {
    console.error(pc.red(`Scene module must export a default function buildScene().`));
    process.exit(1);
  }

  const raw   = await builderFn();
  const scene = (raw && typeof raw === 'object' && 'scene' in raw)
    ? (raw as { scene: THREE.Scene; camera?: THREE.Camera; animations?: THREE.AnimationClip[] })
    : { scene: raw as THREE.Scene, camera: new THREE.PerspectiveCamera(), animations: [] };

  const analysis = await analyze({
    scene:      scene.scene,
    camera:     (scene.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera) ?? new THREE.PerspectiveCamera(),
    animations: scene.animations ?? [],
  });

  // ── Print report ────────────────────────────────────────────────────────────
  console.log(`\n${pc.bold('Scene Analysis:')} ${scenePath}\n`);
  console.log(`  Nodes         ${analysis.nodeCount}`);
  console.log(`  Meshes        ${analysis.meshCount}`);
  console.log(`  Materials     ${analysis.materialCount}`);
  console.log(`  Textures      ${analysis.textureCount}`);
  console.log(`  Animations    ${analysis.animationCount}`);

  console.log(`\n${pc.bold('Required runtime features:')}`);
  for (const f of analysis.features) {
    console.log(`  ${pc.green('✓')} ${f}`);
  }

  if (analysis.optimizations.length > 0) {
    console.log(`\n${pc.bold('Optimizations that will be applied:')}`);
    for (const o of analysis.optimizations) {
      const dcInfo = o.drawCallsBefore != null
        ? pc.dim(` (${o.drawCallsBefore} → ${o.drawCallsAfter} draw calls)`)
        : '';
      console.log(`  ${pc.cyan('↓')} ${o.description}${dcInfo}`);
    }
  }

  if (analysis.errors.length > 0) {
    console.log(`\n${pc.bold(pc.red('Errors (compilation blocked):'))}`);
    for (const e of analysis.errors) {
      console.log(`  ${pc.red(`[${e.code}]`)} ${e.message}`);
      if (e.suggestion) console.log(`    ${pc.dim('→')} ${e.suggestion}`);
    }
  }

  if (analysis.warnings.length > 0) {
    console.log(`\n${pc.bold(pc.yellow('Warnings:'))}`);
    for (const w of analysis.warnings) {
      console.log(`  ${pc.yellow(`[${w.code}]`)} ${w.message}`);
    }
  }

  const s = analysis.estimatedSizes;
  console.log(`\n${pc.bold('Estimated output:')}`);
  console.log(`  scene.bin     ~${fmt(s.sceneBin)}`);
  console.log(`  renderer.wasm ~${fmt(s.wasmRuntime)}`);
  console.log(`  loader.js     ~${fmt(s.loaderJs)}`);
  console.log(`  total (Brotli) ~${fmt(s.totalBrotli)}`);

  if (analysis.errors.length === 0) {
    console.log(`\n  ${pc.green('✓')} Ready to compile: ${pc.cyan(`tinythree compile ${scenePath}`)}\n`);
  } else {
    console.log(`\n  ${pc.red('✗')} Fix the errors above before compiling.\n`);
    process.exit(1);
  }
}

function fmt(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
