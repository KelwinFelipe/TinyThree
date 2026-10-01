# Changelog

All notable changes to TinyThree are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- `@tinythree/compiler` — scene runner, analyzer, and TSCN v1 serializer
- `@tinythree/cli` — `compile`, `analyze`, `init` commands
- `runtime/src/tinythree.c` — single-file C11 runtime targeting WebAssembly
- `runtime/include/tinythree.h` — public C API (`tt_init`, `tt_frame`, `tt_resize`, `tt_destroy`, `tt_alloc`)
- `runtime/Makefile` — `dev`, `prod`, `perf` build profiles (Emscripten 3.1.74)
- TSCN v1 binary format — FILE HEADER + META SEGMENT + DATA SEGMENT
- Automatic instancing detection — promotes N identical Mesh nodes to 1 draw call
- 4 WebGL2 shader variants: `unlit-color`, `unlit-texture`, `points`, `lines`
- WebGL2 state machine — avoids redundant `gl.useProgram` / `gl.bindVertexArray`
- Arena bump-pointer allocator — zero `malloc()` calls after `tt_init()`
- Examples: `rotating-cube`, `solar-system`, `starfield`
- Benchmark harness with P50 / P95 / P99 frame-time collection
- `ARCHITECTURE.md`, `CONTRIBUTING.md`, `LICENSE`

### Supported Three.js subset
- Objects: `Scene`, `Object3D`, `Group`, `Mesh`, `InstancedMesh`, `Points`, `Line`,
  `PerspectiveCamera`, `OrthographicCamera`
- Geometries: `BufferGeometry`, `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`,
  `CylinderGeometry`, `TorusGeometry`
- Materials: `MeshBasicMaterial`, `PointsMaterial`, `LineBasicMaterial`

---

[Unreleased]: https://github.com/your-username/tinythree/compare/HEAD
