import path  from 'node:path';
import fs    from 'node:fs';
import pc    from 'picocolors';
import { compile } from '@tinythree/compiler';

export async function runCompile(args: string[]) {
  // ── Parse args ──────────────────────────────────────────────────────────────
  const scenePath = args.find(a => !a.startsWith('--'));
  if (!scenePath) {
    console.error(pc.red('Error: missing <scene> argument.\n'));
    console.error('  Usage: tinythree compile <scene.ts> [--out <dir>] [--debug] [--watch]');
    process.exit(1);
  }

  const outIdx    = args.indexOf('--out');
  const publicIdx = args.indexOf('--public');
  const outDir    = outIdx    >= 0 ? args[outIdx + 1]    : './dist';
  const publicPath = publicIdx >= 0 ? args[publicIdx + 1] : './';
  const debug     = args.includes('--debug');
  const watch     = args.includes('--watch');

  const doCompile = async () => {
    try {
      const result = await compile({
        scenePath: path.resolve(scenePath),
        outDir,
        publicPath,
        debug,
        silent: false,
      });

      if (result.analysis.errors.length > 0) {
        for (const e of result.analysis.errors) {
          const loc = e.file ? ` (${e.file}:${e.line ?? '?'})` : '';
          console.error(pc.red(`  [${e.code}] ${e.message}${loc}`));
          if (e.suggestion) console.error(pc.dim(`  → ${e.suggestion}`));
        }
        process.exit(1);
      }

      if (result.analysis.warnings.length > 0) {
        for (const w of result.analysis.warnings) {
          console.warn(pc.yellow(`  [${w.code}] ${w.message}`));
        }
      }

    } catch (err) {
      console.error(pc.red('\nCompile error:'), (err as Error).message);
      if (!watch) process.exit(1);
    }
  };

  await doCompile();

  if (watch) {
    console.log(pc.dim(`\nWatching ${scenePath} for changes…`));
    const resolvedPath = path.resolve(scenePath);
    fs.watch(resolvedPath, async () => {
      console.log(pc.cyan(`\n[${timestamp()}] Change detected — recompiling…`));
      await doCompile();
    });
  }
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}
