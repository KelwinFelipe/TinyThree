/**
 * tinythree.h — Public API of the TinyThree WebAssembly runtime
 *
 * These four functions are exported from renderer.wasm and called by loader.js.
 * All GL state is owned by the runtime; the host only supplies a WebGL2 context
 * via Emscripten's canvas binding.
 *
 * Memory model
 * ────────────
 * The caller (JS host) loads scene.bin into a byte buffer and passes a pointer
 * to tt_init().  The runtime takes ownership of the data for the lifetime of
 * the session.  No allocations occur after tt_init() returns.
 *
 * Error handling
 * ──────────────
 * All functions are infallible from the C side; errors are reported via the
 * imported `tt_log` JS function and the runtime enters a safe no-op state.
 */

#ifndef TINYTHREE_H
#define TINYTHREE_H

#include <stdint.h>

#ifdef __EMSCRIPTEN__
#  include <emscripten.h>
#  define TT_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#  define TT_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialize the runtime.
 *
 * @param scene_data  Pointer to scene.bin bytes inside WASM linear memory.
 * @param scene_size  Byte length of scene.bin.
 * @param width       Initial canvas pixel width.
 * @param height      Initial canvas pixel height.
 * @return            0 on success, non-zero on error.
 */
TT_EXPORT int32_t tt_init(const uint8_t *scene_data, uint32_t scene_size,
                           uint32_t width, uint32_t height);

/**
 * Render one frame.  Called from requestAnimationFrame.
 *
 * @param timestamp  High-resolution timestamp in milliseconds (from rAF).
 */
TT_EXPORT void tt_frame(double timestamp);

/**
 * Notify the runtime of a canvas resize.
 *
 * @param width   New canvas pixel width.
 * @param height  New canvas pixel height.
 */
TT_EXPORT void tt_resize(uint32_t width, uint32_t height);

/**
 * Release all GPU resources and reset the runtime to uninitialized state.
 * Safe to call multiple times.
 */
TT_EXPORT void tt_destroy(void);

/**
 * Allocate `size` bytes from the runtime's internal arena and return a pointer
 * for the host to write into (e.g. for uploading scene.bin).
 *
 * Must be called before tt_init().
 */
TT_EXPORT uint8_t *tt_alloc(uint32_t size);

#ifdef __cplusplus
}
#endif

#endif /* TINYTHREE_H */
