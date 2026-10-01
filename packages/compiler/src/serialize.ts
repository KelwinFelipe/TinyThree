/**
 * serialize.ts
 *
 * Walks a THREE.Scene (post-analysis) and writes the TinyThree binary format
 * (scene.bin / TSCN v1).
 *
 * Format overview
 * ───────────────
 *  [FILE HEADER  32 B ]  magic "TSCN" · version · flags · segment sizes · CRC32(reserved=0)
 *  [META SEGMENT      ]  node table · geometry table · material table · transform table · anim table
 *  [DATA SEGMENT      ]  raw float32 vertex buffers · uint16/uint32 index buffers · texture RGBA8
 *
 * All offsets inside the DATA segment are relative to the start of that segment.
 * Little-endian throughout.
 */

import * as THREE from 'three';
import type { SceneAnalysis, SceneBuilderResult } from './types.js';

const MAGIC   = 0x4E435354; // "TSCN" little-endian
const VERSION_MAJOR = 1;
const VERSION_MINOR = 0;

// Feature flag bits (written into FILE HEADER flags field)
const FLAG_HAS_ANIMATIONS        = 1 << 0;
const FLAG_HAS_TEXTURES          = 1 << 1;
const FLAG_HAS_INSTANCING        = 1 << 2;
const FLAG_ALL_TRANSFORMS_STATIC = 1 << 3;

interface SerializeInput extends Required<SceneBuilderResult> {
  analysis: SceneAnalysis;
}

export async function serialize(input: SerializeInput): Promise<ArrayBuffer> {
  const builder = new SceneBinBuilder(input);
  return builder.build();
}

// ─── Builder ─────────────────────────────────────────────────────────────────

class SceneBinBuilder {
  private input: SerializeInput;

  // Collected tables
  private transforms: THREE.Object3D[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials:  THREE.Material[] = [];
  private textures:   THREE.Texture[] = [];
  private nodes:      THREE.Object3D[] = [];

  // Index maps (uuid → index)
  private geoIndex = new Map<string, number>();
  private matIndex = new Map<string, number>();
  private texIndex = new Map<string, number>();

  // Data segment blobs
  private dataBlobs: ArrayBuffer[] = [];
  private dataOffsets: number[] = [];
  private dataSize = 0;

  constructor(input: SerializeInput) {
    this.input = input;
  }

  build(): ArrayBuffer {
    // ── 1. Collect all unique resources ──────────────────────────────────────
    this.collectResources(this.input.scene);

    // ── 2. Build DATA segment (vertex/index/texture buffers) ─────────────────
    this.buildDataSegment();

    // ── 3. Build META segment (tables of structs) ─────────────────────────────
    const meta = this.buildMetaSegment();

    // ── 4. Assemble final file ────────────────────────────────────────────────
    return this.assemble(meta);
  }

  // ── Resource collection ───────────────────────────────────────────────────

  private collectResources(obj: THREE.Object3D) {
    this.nodes.push(obj);
    this.transforms.push(obj);

    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
      const geo = obj.geometry;
      if (!this.geoIndex.has(geo.uuid)) {
        this.geoIndex.set(geo.uuid, this.geometries.length);
        this.geometries.push(geo);
      }

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!this.matIndex.has(mat.uuid)) {
          this.matIndex.set(mat.uuid, this.materials.length);
          this.materials.push(mat);
        }

        // Textures
        const basic = mat as THREE.MeshBasicMaterial;
        if (basic.map && !this.texIndex.has(basic.map.uuid)) {
          this.texIndex.set(basic.map.uuid, this.textures.length);
          this.textures.push(basic.map);
        }
      }
    }

    for (const child of obj.children) this.collectResources(child);
  }

  // ── Data segment ─────────────────────────────────────────────────────────

  private addData(buffer: ArrayBufferLike, align = 4): number {
    const pad   = (align - (this.dataSize % align)) % align;
    this.dataSize += pad;
    const offset = this.dataSize;
    this.dataBlobs.push(new Uint8Array(pad).buffer);
    this.dataBlobs.push(buffer);
    this.dataOffsets.push(offset);
    this.dataSize += buffer.byteLength;
    return offset;
  }

  // Map: geometry uuid → { posOff, normOff, uvOff, idxOff }
  private geoDataOffsets = new Map<string, {
    posOff: number; normOff: number; uvOff: number; idxOff: number;
  }>();

  private buildDataSegment() {
    for (const geo of this.geometries) {
      const pos  = geo.attributes['position'] as THREE.BufferAttribute;
      const norm = geo.attributes['normal']   as THREE.BufferAttribute | undefined;
      const uv   = geo.attributes['uv']       as THREE.BufferAttribute | undefined;
      const idx  = geo.index;

      const posOff  = pos  ? this.addData(pos.array.buffer.slice(
        pos.array.byteOffset, pos.array.byteOffset + pos.array.byteLength), 4) : 0;
      const normOff = norm ? this.addData(norm.array.buffer.slice(
        norm.array.byteOffset, norm.array.byteOffset + norm.array.byteLength), 4) : 0;
      const uvOff   = uv   ? this.addData(uv.array.buffer.slice(
        uv.array.byteOffset, uv.array.byteOffset + uv.array.byteLength), 4) : 0;
      const idxOff  = idx  ? this.addData(idx.array.buffer.slice(
        idx.array.byteOffset, idx.array.byteOffset + idx.array.byteLength), 2) : 0;

      this.geoDataOffsets.set(geo.uuid, { posOff, normOff, uvOff, idxOff });
    }

    // Textures — store as a marker; real pixel data would require canvas extraction
    // In the MVP: textures are referenced by URL stored in the meta segment.
    // Full RGBA8 embedding is a post-MVP feature.
  }

  // ── Meta segment ─────────────────────────────────────────────────────────

  private buildMetaSegment(): ArrayBuffer {
    // For MVP: emit a minimal flat binary that the C runtime can parse.
    // Each table entry uses a fixed-size struct for simplicity.
    // Full schema defined in docs/ir-format.md

    const encoder = new MetaEncoder();

    // Counts header
    encoder.writeU32(this.nodes.length);
    encoder.writeU32(this.geometries.length);
    encoder.writeU32(this.materials.length);
    encoder.writeU32(this.textures.length);
    encoder.writeU32(this.transforms.length);
    encoder.writeU32(this.input.animations.length);
    encoder.writeU32(this.nodes.indexOf(this.input.scene)); // active camera node id
    encoder.writeU32(0); // padding

    // Node table (28 bytes per node)
    for (let i = 0; i < this.nodes.length; i++) {
      const obj = this.nodes[i]!;
      const parentIdx = obj.parent ? this.nodes.indexOf(obj.parent) : 0xFFFFFFFF;
      encoder.writeU32(i);                           // id
      encoder.writeU32(nodeTypeEnum(obj));           // type
      encoder.writeU32(parentIdx);                   // parent_id
      encoder.writeU32(this.transforms.indexOf(obj)); // transform_idx
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
        const geo = obj.geometry;
        const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        encoder.writeU32(this.geoIndex.get(geo.uuid) ?? 0xFFFFFFFF);
        encoder.writeU32(this.matIndex.get(mat.uuid) ?? 0xFFFFFFFF);
      } else {
        encoder.writeU32(0xFFFFFFFF);
        encoder.writeU32(0xFFFFFFFF);
      }
    }

    // Geometry table (40 bytes per geometry)
    for (const geo of this.geometries) {
      const pos  = geo.attributes['position'] as THREE.BufferAttribute | undefined;
      const idx  = geo.index;
      const offs = this.geoDataOffsets.get(geo.uuid)!;
      encoder.writeU32(pos?.count ?? 0);
      encoder.writeU32(idx?.count ?? 0);
      encoder.writeU32(idx ? (idx.array instanceof Uint32Array ? 1 : 0) : 0); // index_type
      encoder.writeU32(offs.posOff);
      encoder.writeU32(offs.normOff);
      encoder.writeU32(offs.uvOff);
      encoder.writeU32(offs.idxOff);
      encoder.writeU32(geoTypeEnum(geo));
      encoder.writeU32(0); encoder.writeU32(0); // padding / proc params
    }

    // Material table (32 bytes per material)
    for (const mat of this.materials) {
      const basic = mat as THREE.MeshBasicMaterial;
      const r = basic.color?.r ?? 1, g = basic.color?.g ?? 1, b = basic.color?.b ?? 1;
      const a = basic.opacity ?? 1;
      encoder.writeF32(r); encoder.writeF32(g); encoder.writeF32(b); encoder.writeF32(a);
      encoder.writeU32(matTypeEnum(mat));
      encoder.writeU32(basic.map ? this.texIndex.get(basic.map.uuid) ?? 0xFFFFFFFF : 0xFFFFFFFF);
      encoder.writeF32(basic.wireframe ? 1 : 0);
      encoder.writeU32(mat.transparent ? 1 : 0);
    }

    // Transform table (128 bytes per transform = position+rotation+scale+localMatrix+worldMatrix baked)
    for (const obj of this.transforms) {
      const p = obj.position, q = obj.quaternion, s = obj.scale;
      obj.updateWorldMatrix(true, false);
      const wm = obj.matrixWorld.elements;
      encoder.writeF32(p.x); encoder.writeF32(p.y); encoder.writeF32(p.z); encoder.writeF32(0);
      encoder.writeF32(q.x); encoder.writeF32(q.y); encoder.writeF32(q.z); encoder.writeF32(q.w);
      encoder.writeF32(s.x); encoder.writeF32(s.y); encoder.writeF32(s.z); encoder.writeF32(0);
      for (const v of wm) encoder.writeF32(v); // 16 × f32 = 64 bytes
    }

    return encoder.buffer();
  }

  // ── File assembly ─────────────────────────────────────────────────────────

  private assemble(meta: ArrayBuffer): ArrayBuffer {
    const HEADER_SIZE  = 32;
    const metaSize     = meta.byteLength;
    const dataSegment  = mergeBlobs(this.dataBlobs, this.dataSize);
    const totalSize    = HEADER_SIZE + metaSize + dataSegment.byteLength;

    const buf  = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    let off = 0;

    // FILE HEADER
    view.setUint32(off, MAGIC, true);           off += 4;
    view.setUint16(off, VERSION_MAJOR, true);   off += 2;
    view.setUint16(off, VERSION_MINOR, true);   off += 2;
    view.setUint32(off, this.buildFlags(), true); off += 4;
    view.setUint32(off, metaSize, true);        off += 4;
    view.setUint32(off, 0, true);               off += 4; // string_heap_size = 0 in MVP
    view.setUint32(off, dataSegment.byteLength, true); off += 4;
    view.setUint32(off, 0, true);               off += 4; // checksum = 0 (reserved)
    view.setUint32(off, 0, true);               off += 4; // reserved

    // META
    new Uint8Array(buf, off, metaSize).set(new Uint8Array(meta));
    off += metaSize;

    // DATA
    new Uint8Array(buf, off).set(new Uint8Array(dataSegment));

    return buf;
  }

  private buildFlags(): number {
    let f = 0;
    if (this.input.animations.length > 0)         f |= FLAG_HAS_ANIMATIONS;
    if (this.textures.length > 0)                  f |= FLAG_HAS_TEXTURES;
    if (this.input.analysis.features.includes('instancing')) f |= FLAG_HAS_INSTANCING;
    // All transforms static if no animations
    if (this.input.animations.length === 0)        f |= FLAG_ALL_TRANSFORMS_STATIC;
    return f;
  }
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

class MetaEncoder {
  private parts: ArrayBuffer[] = [];
  private _size = 0;

  writeU32(v: number) {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, v >>> 0, true);
    this.parts.push(b); this._size += 4;
  }

  writeF32(v: number) {
    const b = new ArrayBuffer(4);
    new DataView(b).setFloat32(0, v, true);
    this.parts.push(b); this._size += 4;
  }

  buffer(): ArrayBuffer {
    return mergeBlobs(this.parts, this._size);
  }
}

function mergeBlobs(blobs: ArrayBuffer[], totalSize: number): ArrayBuffer {
  const out = new Uint8Array(totalSize);
  let off = 0;
  for (const b of blobs) {
    out.set(new Uint8Array(b), off);
    off += b.byteLength;
  }
  return out.buffer;
}

// ─── Enum helpers ─────────────────────────────────────────────────────────────

function nodeTypeEnum(obj: THREE.Object3D): number {
  if (obj instanceof THREE.Scene)            return 0;
  if (obj instanceof THREE.Mesh)             return 1;
  if (obj instanceof THREE.InstancedMesh)    return 2;
  if (obj instanceof THREE.Points)           return 3;
  if (obj instanceof THREE.Line)             return 4;
  if (obj instanceof THREE.PerspectiveCamera) return 5;
  if (obj instanceof THREE.OrthographicCamera) return 6;
  if (obj instanceof THREE.Group)            return 7;
  return 8; // Object3D
}

function geoTypeEnum(geo: THREE.BufferGeometry): number {
  const t = geo.type;
  if (t === 'BoxGeometry')      return 1;
  if (t === 'SphereGeometry')   return 2;
  if (t === 'PlaneGeometry')    return 3;
  if (t === 'CylinderGeometry') return 4;
  if (t === 'TorusGeometry')    return 5;
  return 0; // generic BufferGeometry
}

function matTypeEnum(mat: THREE.Material): number {
  if (mat.type === 'MeshBasicMaterial') return 0;
  if (mat.type === 'PointsMaterial')    return 1;
  if (mat.type === 'LineBasicMaterial') return 2;
  return 0;
}
