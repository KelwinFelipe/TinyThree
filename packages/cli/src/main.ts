#!/usr/bin/env node
/**
 * TinyThree CLI
 *
 * Usage:
 *   tinythree compile <scene>  [--out <dir>] [--debug] [--watch]
 *   tinythree analyze <scene>
 *   tinythree init   [<dir>]
 *   tinythree --version
 *   tinythree --help
 */
import pc from 'picocolors';
import { runCompile  } from './commands/compile.js';
import { runAnalyze  } from './commands/analyze.js';
import { runInit     } from './commands/init.js';

const args = process.argv.slice(2);
const cmd  = args[0];

if (!cmd || cmd === '--help' || cmd === '-h') {
  printHelp();
  process.exit(0);
}

if (cmd === '--version' || cmd === '-v') {
  const { createRequire } = await import('module');
  const pkg = createRequire(import.meta.url)('../package.json') as { version: string };
  console.log(pkg.version);
  process.exit(0);
}

switch (cmd) {
  case 'compile': await runCompile(args.slice(1));  break;
  case 'analyze': await runAnalyze(args.slice(1));  break;
  case 'init':    await runInit(args.slice(1));      break;
  default:
    console.error(pc.red(`Unknown command: ${cmd}`));
    printHelp();
    process.exit(1);
}

function printHelp() {
  console.log(`
  ${pc.bold(pc.cyan('tinythree'))} — AOT optimizer for Three.js scenes

  ${pc.bold('Commands')}
    ${pc.green('compile')} <scene>   Compile a scene to scene.bin + renderer.wasm + loader.js
    ${pc.green('analyze')} <scene>   Analyze a scene without compiling (shows features, optimizations)
    ${pc.green('init')}    [dir]     Create a new TinyThree project with a working example

  ${pc.bold('Compile options')}
    ${pc.yellow('--out')} <dir>      Output directory (default: ./dist)
    ${pc.yellow('--public')} <path>  Public URL prefix for emitted loader.js (default: ./)
    ${pc.yellow('--debug')}          Also emit scene.debug.json for inspection
    ${pc.yellow('--watch')}          Watch for changes and recompile automatically

  ${pc.bold('Examples')}
    npx tinythree compile src/scene.ts
    npx tinythree compile src/scene.ts --out public/scenes --debug
    npx tinythree analyze src/scene.ts
    npx tinythree init my-scene

  ${pc.dim('Docs: https://github.com/your-username/tinythree')}
`);
}
