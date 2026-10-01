/**
 * Rotating Cube — TinyThree Example
 *
 * The simplest possible scene: one cube with a solid color.
 * Used as the "Hello World" and pipeline validation demo.
 *
 * Compile:
 *   npx tinythree compile src/scene.ts --out dist
 */
import * as THREE from 'three';

export default function buildScene() {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 4);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0x4f8ef7 });
  const cube     = new THREE.Mesh(geometry, material);
  scene.add(cube);

  // Animation is driven by the runtime via AnimationClip
  const times  = new Float32Array([0, 1, 2]);
  const values = new Float32Array([0, 0, 0,  0, Math.PI, 0,  0, Math.PI * 2, 0]);
  const track  = new THREE.VectorKeyframeTrack('cube.rotation', [...times], [...values]);
  const clip   = new THREE.AnimationClip('spin', 2, [track]);

  return { scene, camera, animations: [clip] };
}
