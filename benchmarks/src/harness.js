/**
 * TinyThree Benchmark Harness
 *
 * Collects reproducible frame-time measurements for both Three.js and
 * TinyThree renderers.  Designed to be embedded in each benchmark HTML page.
 *
 * Protocol
 * ────────
 *  1. Warm-up:  300 frames (≈5 s at 60 FPS) — not recorded
 *  2. Collect: 3600 frames (≈60 s at 60 FPS) — P50 / P95 / P99 reported
 *  3. Results: printed to console + written to window.benchmarkResults
 *
 * Usage
 * ─────
 *  import { BenchmarkHarness } from './harness.js';
 *
 *  const bench = new BenchmarkHarness('TinyThree / rotating-cube');
 *  bench.onFrame = (ts) => tinythreeScene.frame(ts);   // your render callback
 *  bench.start();
 */

export class BenchmarkHarness {
  /**
   * @param {string} label   Short label shown in the report
   * @param {object} opts
   * @param {number} opts.warmupFrames  Frames to skip (default 300)
   * @param {number} opts.collectFrames Frames to collect (default 3600)
   */
  constructor(label, opts = {}) {
    this.label         = label;
    this.warmupFrames  = opts.warmupFrames  ?? 300;
    this.collectFrames = opts.collectFrames ?? 3600;

    this._frameTimes  = [];
    this._warmupLeft  = this.warmupFrames;
    this._collectLeft = this.collectFrames;
    this._lastTs      = null;
    this._rafId       = null;
    this._startWallMs = null;

    /** Override this with your render function */
    this.onFrame = (_timestamp) => {};
    /** Called when collection is complete */
    this.onComplete = (_results) => {};
  }

  start() {
    this._startWallMs = performance.now();
    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  _loop(ts) {
    const frameStart = performance.now();
    this.onFrame(ts);
    const frameEnd   = performance.now();
    const frameTime  = frameEnd - frameStart;

    if (this._warmupLeft > 0) {
      this._warmupLeft--;
    } else if (this._collectLeft > 0) {
      this._frameTimes.push(frameTime);
      this._collectLeft--;

      if (this._collectLeft === 0) {
        this._finish();
        return;
      }
    }

    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }

  _finish() {
    const results = computeStats(this._frameTimes, this.label);
    printResults(results);
    window.benchmarkResults = window.benchmarkResults ?? {};
    window.benchmarkResults[this.label] = results;
    this.onComplete(results);
  }
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function computeStats(frameTimes, label) {
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const n      = sorted.length;

  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

  // Identify GC-pause frames: time > 2× median
  const p50 = percentile(sorted, 50);
  const gcFrames = frameTimes.filter(t => t > p50 * 2).length;

  return {
    label,
    sampleCount:    n,
    meanMs:         round(mean),
    stdDevMs:       round(Math.sqrt(variance)),
    p50Ms:          round(p50),
    p95Ms:          round(percentile(sorted, 95)),
    p99Ms:          round(percentile(sorted, 99)),
    minMs:          round(sorted[0]),
    maxMs:          round(sorted[n - 1]),
    fpsAvg:         round(1000 / mean),
    gcPauseFrames:  gcFrames,
    gcPausePct:     round((gcFrames / n) * 100),
    raw:            frameTimes,
  };
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function round(v) {
  return Math.round(v * 100) / 100;
}

// ─── Reporter ─────────────────────────────────────────────────────────────────

function printResults(r) {
  console.group(`%c📊 Benchmark: ${r.label}`, 'font-weight:bold;color:#4f8ef7');
  console.log(`  Samples      ${r.sampleCount}`);
  console.log(`  Mean         ${r.meanMs} ms   (${r.fpsAvg} FPS avg)`);
  console.log(`  Std dev      ${r.stdDevMs} ms`);
  console.log(`  P50          ${r.p50Ms} ms`);
  console.log(`  P95          ${r.p95Ms} ms`);
  console.log(`  P99          ${r.p99Ms} ms`);
  console.log(`  Min / Max    ${r.minMs} ms / ${r.maxMs} ms`);
  console.log(`  GC pauses    ${r.gcPauseFrames} frames  (${r.gcPausePct}%)`);
  console.groupEnd();
}

// ─── TTFF measurement ─────────────────────────────────────────────────────────

/**
 * Mark the start of the loading sequence.
 * Call this as early as possible in your HTML (before any fetch/import).
 */
export function markLoadStart() {
  performance.mark('tt-load-start');
}

/**
 * Mark the first rendered frame and report TTFF.
 * Call inside your first requestAnimationFrame callback.
 */
export function markFirstFrame(label = '') {
  performance.mark('tt-first-frame');
  performance.measure(`ttff${label ? ' ' + label : ''}`, 'tt-load-start', 'tt-first-frame');
  const [entry] = performance.getEntriesByName(`ttff${label ? ' ' + label : ''}`);
  const ttff = Math.round(entry?.duration ?? 0);
  console.log(`%c⚡ TTFF${label ? ' [' + label + ']' : ''}: ${ttff} ms`, 'color:#7eb8ff;font-weight:bold');
  return ttff;
}

// ─── Bundle size helper (call from DevTools console) ──────────────────────────

/**
 * Estimates compressed size of loaded resources.
 * Not a replacement for DevTools Network tab, but useful for quick comparison.
 */
export async function estimateBundleSize(urls) {
  const results = await Promise.all(
    urls.map(async (url) => {
      const res  = await fetch(url);
      const buf  = await res.arrayBuffer();
      const name = url.split('/').pop();
      return { name, bytes: buf.byteLength };
    })
  );
  console.table(results.map(r => ({
    file:  r.name,
    size:  `${(r.bytes / 1024).toFixed(1)} KB`,
    bytes: r.bytes,
  })));
  const total = results.reduce((s, r) => s + r.bytes, 0);
  console.log(`Total: ${(total / 1024).toFixed(1)} KB (uncompressed)`);
}
