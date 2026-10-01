import path from 'node:path';
import fs   from 'node:fs/promises';
import pc   from 'picocolors';

const TEMPLATE_SCENE = `import * as THREE from 'three';

/**
 * TinyThree scene — exported buildScene() is called by the compiler.
 *
 * Rules:
 *  - Do NOT use WebGLRenderer here (not available in Node.js)
 *  - Do NOT use async loaders (GLTFLoader, etc.)
 *  - Return { scene, camera } or just a THREE.Scene
 */
export default function buildScene() {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 4);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0x4f8ef7 });
  const cube     = new THREE.Mesh(geometry, material);
  scene.add(cube);

  return { scene, camera };
}
`;

const TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TinyThree Scene</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f0f14; display: flex; align-items: center; justify-content: center; height: 100vh; }
    canvas { display: block; width: 100%; max-width: 900px; aspect-ratio: 16/9; }
  </style>
</head>
<body>
  <canvas id="scene"></canvas>
  <script type="module">
    import { start } from './dist/loader.js';

    const canvas = document.getElementById('scene');
    canvas.width  = canvas.offsetWidth  * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;

    const scene = await start(canvas);
    window.addEventListener('resize', () => {
      canvas.width  = canvas.offsetWidth  * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      scene.resize(canvas.width, canvas.height);
    });
  </script>
</body>
</html>
`;

const TEMPLATE_PACKAGE = (name: string) => `{
  "name": "${name}",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tinythree compile src/scene.ts --out dist",
    "dev":   "tinythree compile src/scene.ts --out dist --watch",
    "serve": "npx serve ."
  },
  "dependencies": {
    "three": "^0.165.0"
  },
  "devDependencies": {
    "@tinythree/cli": "^0.1.0"
  }
}
`;

export async function runInit(args: string[]) {
  const targetDir = path.resolve(args[0] ?? './my-tinythree-scene');
  const name      = path.basename(targetDir);

  await fs.mkdir(path.join(targetDir, 'src'), { recursive: true });

  await Promise.all([
    fs.writeFile(path.join(targetDir, 'src', 'scene.ts'), TEMPLATE_SCENE),
    fs.writeFile(path.join(targetDir, 'index.html'),      TEMPLATE_HTML),
    fs.writeFile(path.join(targetDir, 'package.json'),    TEMPLATE_PACKAGE(name)),
    fs.writeFile(path.join(targetDir, '.gitignore'),      'node_modules/\ndist/\n'),
  ]);

  console.log(`\n${pc.bold(pc.green('✓'))} Created project at ${pc.cyan(targetDir)}\n`);
  console.log(`  ${pc.bold('Next steps:')}`);
  console.log(`    cd ${name}`);
  console.log(`    npm install`);
  console.log(`    npm run build`);
  console.log(`    npm run serve\n`);
}
