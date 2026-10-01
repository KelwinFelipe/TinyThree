/**
 * Solar System — TinyThree Example
 *
 * Demonstrates: multiple meshes · textures · hierarchy · transform animations
 *
 * The compiler automatically detects that the 16 moons (2 per planet, same
 * geometry + material) can be merged into a single InstancedMesh —
 * reducing draw calls without any manual InstancedMesh code.
 *
 * Compile:
 *   npx tinythree compile src/scene.ts --out dist
 */
import * as THREE from 'three';

const PLANETS = [
  { name: 'mercury', radius: 0.25, distance: 3.5,  color: 0xb5b5b5, speed: 4.1 },
  { name: 'venus',   radius: 0.45, distance: 5.5,  color: 0xe8c97d, speed: 1.6 },
  { name: 'earth',   radius: 0.50, distance: 7.5,  color: 0x3a7bd5, speed: 1.0 },
  { name: 'mars',    radius: 0.30, distance: 10.0, color: 0xc1440e, speed: 0.53 },
  { name: 'jupiter', radius: 1.10, distance: 15.0, color: 0xc88b3a, speed: 0.08 },
  { name: 'saturn',  radius: 0.95, distance: 20.0, color: 0xd4b483, speed: 0.03 },
  { name: 'uranus',  radius: 0.70, distance: 25.0, color: 0x7de8e8, speed: 0.01 },
  { name: 'neptune', radius: 0.65, distance: 30.0, color: 0x4b70dd, speed: 0.006 },
];

export default function buildScene() {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  camera.position.set(0, 18, 35);
  camera.lookAt(0, 0, 0);

  // ── Sun ────────────────────────────────────────────────────────────────────
  const sunGeo = new THREE.SphereGeometry(2, 32, 32);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd55 });
  const sun    = new THREE.Mesh(sunGeo, sunMat);
  sun.name     = 'sun';
  scene.add(sun);

  // ── Planets ────────────────────────────────────────────────────────────────
  // Moon geometry is shared (same radius) → compiler will detect instancing
  const moonGeo = new THREE.SphereGeometry(0.1, 12, 12);
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });

  for (const p of PLANETS) {
    // Orbit pivot (invisible)
    const orbit = new THREE.Object3D();
    orbit.name  = `orbit_${p.name}`;
    scene.add(orbit);

    // Planet mesh
    const pGeo  = new THREE.SphereGeometry(p.radius, 24, 24);
    const pMat  = new THREE.MeshBasicMaterial({ color: p.color });
    const planet = new THREE.Mesh(pGeo, pMat);
    planet.name  = p.name;
    planet.position.x = p.distance;
    orbit.add(planet);

    // Two moons per planet (same moonGeo + moonMat → instancing candidate)
    for (let m = 0; m < 2; m++) {
      const moon = new THREE.Mesh(moonGeo, moonMat);
      moon.name  = `${p.name}_moon_${m}`;
      moon.position.set(
        p.distance + p.radius * 2 + m * 0.5,
        0.3 * (m % 2 === 0 ? 1 : -1),
        0,
      );
      orbit.add(moon);
    }
  }

  return { scene, camera };
}
