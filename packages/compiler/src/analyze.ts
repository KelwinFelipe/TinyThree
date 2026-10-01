import * as THREE from 'three';
import type {
  SceneAnalysis, RuntimeFeature, OptimizationHint,
  DiagnosticMessage, SceneBuilderResult,
} from './types.js';

interface AnalyzeInput extends Required<SceneBuilderResult> {}

const SUPPORTED_MATERIALS = new Set([
  'MeshBasicMaterial',
  'PointsMaterial',
  'LineBasicMaterial',
]);

const SUPPORTED_GEOMETRIES = new Set([
  'BufferGeometry',
  'BoxGeometry',
  'SphereGeometry',
  'PlaneGeometry',
  'CylinderGeometry',
  'TorusGeometry',
]);

/**
 * Walk the scene graph and produce a complete analysis:
 * - Which runtime features are required
 * - Which optimizations will be applied (instancing, dedup, bake)
 * - Errors that block compilation
 * - Warnings for unsupported-but-non-blocking patterns
 */
export async function analyze(input: AnalyzeInput): Promise<SceneAnalysis> {
  const errors:        DiagnosticMessage[] = [];
  const warnings:      DiagnosticMessage[] = [];
  const features:      Set<RuntimeFeature> = new Set();
  const optimizations: OptimizationHint[]  = [];

  let meshCount       = 0;
  let materialCount   = 0;
  let textureCount    = 0;

  // Geometry+Material fingerprint → list of nodes (for instancing detection)
  const instanceCandidates = new Map<string, THREE.Mesh[]>();

  // ── Camera ─────────────────────────────────────────────────────────────────
  if (input.camera instanceof THREE.PerspectiveCamera) {
    features.add('perspective-camera');
  } else if (input.camera instanceof THREE.OrthographicCamera) {
    features.add('ortho-camera');
  }

  // ── Scene graph traversal ──────────────────────────────────────────────────
  const materialSet = new Map<string, THREE.Material>();

  input.scene.traverse((obj) => {
    // ── Mesh ─────────────────────────────────────────────────────────────────
    if (obj instanceof THREE.Mesh) {
      meshCount++;
      features.add('mesh');

      // Geometry check
      if (!SUPPORTED_GEOMETRIES.has(obj.geometry.type)) {
        warnings.push({
          code: 'W010',
          message: `Geometry type "${obj.geometry.type}" is not natively supported; using as raw BufferGeometry.`,
        });
      }

      // Material check
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (!SUPPORTED_MATERIALS.has(mat.type)) {
        errors.push({
          code: 'E001',
          message: `Material "${mat.type}" is not supported.`,
          suggestion: `Supported materials: MeshBasicMaterial, PointsMaterial, LineBasicMaterial.`,
        });
      } else {
        features.add('basic-material');
        materialSet.set(mat.uuid, mat);

        // Texture check
        const basic = mat as THREE.MeshBasicMaterial;
        if (basic.map) {
          textureCount++;
          features.add('texture');
        }
      }

      // Instancing candidate fingerprint
      const matId  = (Array.isArray(obj.material) ? obj.material[0] : obj.material).uuid;
      const geoKey = fingerprintGeometry(obj.geometry);
      const key    = `${geoKey}::${matId}`;
      if (!instanceCandidates.has(key)) instanceCandidates.set(key, []);
      instanceCandidates.get(key)!.push(obj);
    }

    // ── Points ───────────────────────────────────────────────────────────────
    if (obj instanceof THREE.Points) {
      features.add('points');
      features.add('points-material');
    }

    // ── Lines ────────────────────────────────────────────────────────────────
    if (obj instanceof THREE.Line && !(obj instanceof THREE.LineSegments)) {
      features.add('lines');
      features.add('line-material');
    }

    // ── Already-instanced meshes ──────────────────────────────────────────────
    if (obj instanceof THREE.InstancedMesh) {
      features.add('instancing');
    }
  });

  materialCount = materialSet.size;

  // ── Instancing detection ───────────────────────────────────────────────────
  let totalPromotedInstances = 0;
  for (const [, nodes] of instanceCandidates) {
    if (nodes.length >= 2) {
      totalPromotedInstances += nodes.length;
      features.add('instancing');
      optimizations.push({
        type: 'instancing-promoted',
        description: `${nodes.length} meshes with identical geometry+material → 1 instanced draw call`,
        drawCallsBefore: nodes.length,
        drawCallsAfter:  1,
      });
    }
  }

  // ── Animation check ───────────────────────────────────────────────────────
  if (input.animations.length > 0) {
    features.add('transform-animation');
  }

  // ── Size estimates ────────────────────────────────────────────────────────
  const estimatedSizes = estimateSizes(input.scene, textureCount, features);

  return {
    nodeCount:      countNodes(input.scene),
    meshCount,
    materialCount,
    textureCount,
    animationCount: input.animations.length,
    features:       [...features],
    optimizations,
    errors,
    warnings,
    estimatedSizes,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fingerprintGeometry(geo: THREE.BufferGeometry): string {
  const pos = geo.attributes.position;
  return `${geo.type}:${pos?.count ?? 0}:${geo.index?.count ?? 0}`;
}

function countNodes(obj: THREE.Object3D): number {
  let n = 1;
  for (const child of obj.children) n += countNodes(child);
  return n;
}

function estimateSizes(
  scene: THREE.Scene,
  textureCount: number,
  features: Set<RuntimeFeature>,
): SceneAnalysis['estimatedSizes'] {
  // Very rough heuristic — real sizes measured after serialization
  let vertexBytes = 0;
  scene.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      const pos = obj.geometry.attributes.position;
      if (pos) vertexBytes += pos.count * 3 * 4; // vec3 f32
    }
  });

  const sceneBin    = 256 + vertexBytes + textureCount * 512 * 512 * 4;
  const wasmRuntime = features.has('transform-animation')
    ? features.has('texture') ? 35_000 : 30_000
    : 25_000;

  return {
    sceneBin,
    wasmRuntime,
    loaderJs:   4_000,
    totalBrotli: Math.round((sceneBin + wasmRuntime + 4_000) * 0.28),
  };
}
