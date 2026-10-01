# Contributing

Thanks for your interest in TinyThree!  This is an experimental project and
contributions of all kinds are welcome — bug reports, ideas, code, and docs.

---

## Getting started

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 18 | |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| Emscripten SDK | 3.1.74 (pinned) | Only needed to rebuild `renderer.wasm` |

```bash
git clone https://github.com/your-username/tinythree.git
cd tinythree
pnpm install
pnpm build
```

### Run an example

```bash
# Compile the rotating cube example (pre-built wasm is committed)
pnpm --filter @tinythree/example-rotating-cube build
pnpm --filter @tinythree/example-rotating-cube serve
```

### Rebuild the WASM runtime

Requires [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
version **3.1.74** (pinned for reproducibility).

```bash
# Using Docker (recommended)
docker run --rm -v $(pwd)/runtime:/src emscripten/emsdk:3.1.74 \
  make -C /src prod

# Or with emsdk installed locally
source /path/to/emsdk/emsdk_env.sh
make -C runtime prod
```

---

## Project structure

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a full description of the data flow
and module boundaries.

---

## Development workflow

```
packages/compiler/src/    TypeScript — edit with your normal TS toolchain
packages/cli/src/         TypeScript CLI
runtime/src/tinythree.c   C11 runtime — rebuilt only when WASM changes needed
```

```bash
# Watch-compile the compiler package
pnpm --filter @tinythree/compiler dev

# Run tests
pnpm test

# Lint
pnpm lint
```

---

## Pull request guidelines

1. **One concern per PR.** Bug fix, new feature, or refactor — not all three.
2. **Tests.** Add or update tests for any changed behaviour in the compiler.
3. **Benchmarks.** If your change affects runtime performance, include before/after
   numbers from the benchmark harness.
4. **No breaking changes to `scene.bin` v1** without bumping `VERSION_MAJOR` and
   updating the C parser accordingly.
5. **English** in code, comments, and PR descriptions.

---

## Commit style

```
feat: add cylinder geometry support
fix: clamp BufOffset before data segment access
docs: clarify supported materials in ARCHITECTURE.md
chore: bump Emscripten to 3.1.75
perf: use wasm-opt --enable-simd in prod build
test: add serializer snapshot for SphereGeometry
```

---

## Reporting bugs

Open an [issue](https://github.com/your-username/tinythree/issues) with:

- TinyThree version (`npx tinythree --version`)
- Node.js version
- Browser + version (for runtime bugs)
- Minimal reproduction: the simplest `scene.ts` that triggers the problem
- Error output (full terminal output or DevTools console)

---

## Scope of the project

TinyThree intentionally covers a **narrow subset** of Three.js.  Before opening a
feature request, check whether the feature falls outside the supported subset
(see `ARCHITECTURE.md`).  Pull requests that add `ShaderMaterial` support,
PBR materials, or WebXR will not be accepted in the MVP phase.

---

## License

By contributing you agree that your code will be licensed under [MIT](./LICENSE).
