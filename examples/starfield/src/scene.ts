/**
 * Starfield — TinyThree Example
 *
 * 10,000 stars rendered as a single Points draw call.
 * Demonstrates: PointsMaterial + zero-overhead instancing for point clouds.
 *
 * The compiler detects that all stars share the same PointsMaterial and
 * emits a single geometry with all 10k vertices — 1 draw call total.
 *
 * Compile:
 *   npx tinythree compile src/scene.ts --out dist
 */
import * as THREE from 'three';

const STAR_COUNT = 10_000;
const SPREAD     = 200;

export default function buildScene() {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(0, 0, 1);

  // Build all star positions deterministically (seeded, not random)
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Deterministic pseudo-random using golden ratio
    const t = i / STAR_COUNT;
    const r = Math.sqrt(t) * SPREAD;
    const theta = i * 2.399963; // golden angle
    positions[i * 3 + 0] = r * Math.cos(theta);
    positions[i * 3 + 1] = (t - 0.5) * SPREAD;
    positions[i * 3 + 2] = r * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size:  0.15,
  });

  const stars = new THREE.Points(geometry, material);
  scene.add(stars);

  return { scene, camera };
}
