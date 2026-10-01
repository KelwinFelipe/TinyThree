# TinyThree Runtime — Makefile
# Requires Emscripten SDK: https://emscripten.org/
#
# Usage:
#   make dev        — development build (debug symbols, assertions)
#   make prod       — production build (optimized for size)
#   make perf       — production build (optimized for speed)
#   make clean      — remove build artifacts
#   make info       — print build sizes

CC     := emcc
SRC    := src/tinythree.c
OUT    := prebuilt/renderer.wasm
JS_OUT := prebuilt/renderer.js

# ── Common flags ──────────────────────────────────────────────────────────────
COMMON_FLAGS := \
  -std=c11 \
  -I include \
  -s NO_FILESYSTEM=1 \
  -s NO_EXIT_RUNTIME=1 \
  -s ENVIRONMENT=web \
  -s MALLOC=emmalloc \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createTinyThree \
  -s EXPORTED_FUNCTIONS="['_tt_init','_tt_frame','_tt_resize','_tt_destroy','_tt_alloc']" \
  -s EXPORTED_RUNTIME_METHODS="['HEAPU8']" \
  -s SUPPORT_LONGJMP=0 \
  --no-entry

# ── Development build ─────────────────────────────────────────────────────────
DEV_FLAGS := \
  $(COMMON_FLAGS) \
  -O1 \
  -g3 \
  -gsource-map \
  -s ASSERTIONS=2 \
  -s SAFE_HEAP=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432

.PHONY: dev
dev:
	@mkdir -p prebuilt
	$(CC) $(SRC) $(DEV_FLAGS) -o $(JS_OUT)
	@echo "Development build: prebuilt/renderer.wasm + renderer.js"

# ── Production (size-optimized) ───────────────────────────────────────────────
PROD_FLAGS := \
  $(COMMON_FLAGS) \
  -Oz \
  -flto \
  -s MINIMAL_RUNTIME=1 \
  -s MINIMAL_RUNTIME_STREAMING_WASM_INSTANTIATION=1 \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s INITIAL_MEMORY=33554432 \
  -s MAXIMUM_MEMORY=67108864 \
  --closure 1

.PHONY: prod
prod:
	@mkdir -p prebuilt
	$(CC) $(SRC) $(PROD_FLAGS) -o $(JS_OUT)
	wasm-opt prebuilt/renderer.wasm \
	  -Oz --strip-debug --strip-producers \
	  --enable-bulk-memory \
	  -o $(OUT)
	@echo "Production (size) build complete"
	@wc -c $(OUT) | awk '{printf "  renderer.wasm: %s bytes\n", $$1}'

# ── Performance build ─────────────────────────────────────────────────────────
PERF_FLAGS := \
  $(COMMON_FLAGS) \
  -O3 \
  -flto \
  -msimd128 \
  -s MINIMAL_RUNTIME=1 \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s INITIAL_MEMORY=33554432 \
  -s MAXIMUM_MEMORY=67108864 \
  --closure 1

.PHONY: perf
perf:
	@mkdir -p prebuilt
	$(CC) $(SRC) $(PERF_FLAGS) -o $(JS_OUT)
	wasm-opt prebuilt/renderer.wasm \
	  -O3 --strip-debug --strip-producers \
	  --enable-simd --enable-bulk-memory \
	  --enable-nontrapping-float-to-int \
	  -o $(OUT)
	@echo "Performance build complete"

# ── Info ──────────────────────────────────────────────────────────────────────
.PHONY: info
info:
	@echo "Build artifacts:"
	@ls -lh prebuilt/ 2>/dev/null || echo "  (no artifacts — run make prod)"

# ── Clean ─────────────────────────────────────────────────────────────────────
.PHONY: clean
clean:
	rm -f prebuilt/renderer.wasm prebuilt/renderer.js prebuilt/*.map
