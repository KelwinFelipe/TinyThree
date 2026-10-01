/**
 * tinythree.c — TinyThree WebAssembly Runtime
 *
 * Single-file C11 implementation (~2000 lines target).
 * Compiled with Emscripten to renderer.wasm.
 *
 * Sections
 * ────────
 *   1. PLATFORM     — imported JS functions (WebGL2 via Emscripten GLES3)
 *   2. MEMORY       — arena bump-pointer allocator
 *   3. MATH         — vec3, vec4, mat4 (header-only inlines)
 *   4. SCENE LOADER — parse scene.bin (TSCN v1 format)
 *   5. RENDERER     — WebGL2 state machine + draw loop
 *   6. PUBLIC API   — tt_init / tt_frame / tt_resize / tt_destroy / tt_alloc
 *
 * Build
 * ─────
 *   See runtime/Makefile  (requires Emscripten SDK)
 *
 * Design constraints
 * ──────────────────
 *   - Zero malloc() calls after tt_init() returns.
 *   - No filesystem, no pthreads, no Asyncify.
 *   - All WebGL calls go through Emscripten's GLES3 layer.
 *   - Handles (VAO, VBO, program) are stored as uint32_t in flat arrays.
 */

#include "../include/tinythree.h"

#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <math.h>

#ifdef __EMSCRIPTEN__
#  include <emscripten.h>
#  include <GLES3/gl3.h>
#else
/* Stub for host-side unit tests */
typedef unsigned int GLenum;
typedef unsigned int GLuint;
typedef int          GLint;
typedef float        GLfloat;
#  define GL_TRIANGLES 4
#  define GL_UNSIGNED_SHORT 0x1403
#  define GL_UNSIGNED_INT   0x1405
#  define GL_ARRAY_BUFFER   0x8892
#  define GL_ELEMENT_ARRAY_BUFFER 0x8893
#  define GL_STATIC_DRAW    0x88B4
#  define GL_DYNAMIC_DRAW   0x88E8
#  define GL_FLOAT          0x1406
#  define GL_FALSE          0
#  define GL_TRUE           1
#endif

/* ─────────────────────────────────────────────────────────────────────────────
 * SECTION 1 — PLATFORM (imported JS helpers)
 * ───────────────────────────────────────────────────────────────────────────*/

static void tt_log_impl(const char *msg) {
#ifdef __EMSCRIPTEN__
    EM_ASM({ console.log('[TinyThree]', UTF8ToString($0)); }, msg);
#endif
}

#define TT_LOG(msg) tt_log_impl(msg)

/* ─────────────────────────────────────────────────────────────────────────────
 * SECTION 2 — MEMORY (arena bump-pointer allocator)
 * ───────────────────────────────────────────────────────────────────────────*/

#define ARENA_SIZE_MB  8
#define ARENA_SIZE     (ARENA_SIZE_MB * 1024 * 1024)
#define ARENA_ALIGN    16

static uint8_t  g_arena_buf[ARENA_SIZE];
static uint32_t g_arena_offset = 0;

static void *arena_alloc(uint32_t size) {
    /* Align up */
    uint32_t aligned = (g_arena_offset + (ARENA_ALIGN - 1)) & ~(ARENA_ALIGN - 1);
    if (aligned + size > ARENA_SIZE) {
        TT_LOG("arena_alloc: out of memory");
        return NULL;
    }
    void *ptr = g_arena_buf + aligned;
    g_arena_offset = aligned + size;
    return ptr;
}

static void arena_reset(void) {
    g_arena_offset = 0;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SECTION 3 — MATH (vec3, vec4, mat4)
 * ───────────────────────────────────────────────────────────────────────────*/

typedef struct { float x, y, z;    } vec3;
typedef struct { float x, y, z, w; } vec4;
typedef struct { float m[16];       } mat4; /* column-major */

static inline mat4 mat4_identity(void) {
    mat4 r = {{ 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1 }};
    return r;
}

static inline mat4 mat4_mul(const mat4 *a, const mat4 *b) {
    mat4 r;
    for (int col = 0; col < 4; col++) {
        for (int row = 0; row < 4; row++) {
            float sum = 0.0f;
            for (int k = 0; k < 4; k++) {
                sum += a->m[k * 4 + row] * b->m[col * 4 + k];
            }
            r.m[col * 4 + row] = sum;
        }
    }
    return r;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SECTION 4 — SCENE LOADER  (TSCN v1 parser)
 * ───────────────────────────────────────────────────────────────────────────*/

#define TSCN_MAGIC          0x4E435354u  /* "TSCN" LE */
#define TSCN_VERSION_MAJOR  1

/* Feature flags */
#define FLAG_HAS_ANIMATIONS        (1u << 0)
#define FLAG_HAS_TEXTURES          (1u << 1)
#define FLAG_HAS_INSTANCING        (1u << 2)
#define FLAG_ALL_TRANSFORMS_STATIC (1u << 3)

/* Node types */
#define NODE_SCENE      0
#define NODE_MESH       1
#define NODE_INSTANCED  2
#define NODE_POINTS     3
#define NODE_LINE       4
#define NODE_PERSP_CAM  5
#define NODE_ORTHO_CAM  6
#define NODE_GROUP      7
#define NODE_OBJECT3D   8

/* Material types */
#define MAT_BASIC   0
#define MAT_POINTS  1
#define MAT_LINE    2

/* ── Raw structs that map directly to the binary layout ── */

typedef struct __attribute__((packed)) {
    uint32_t magic;
    uint16_t version_major;
    uint16_t version_minor;
    uint32_t flags;
    uint32_t meta_size;
    uint32_t string_heap_size;
    uint32_t data_size;
    uint32_t checksum;
    uint32_t reserved;
} TscnHeader;            /* 32 bytes */

typedef struct __attribute__((packed)) {
    uint32_t node_count;
    uint32_t geom_count;
    uint32_t mat_count;
    uint32_t tex_count;
    uint32_t transform_count;
    uint32_t anim_count;
    uint32_t active_camera_id;
    uint32_t _pad;
} MetaCountsHeader;      /* 32 bytes */

typedef struct __attribute__((packed)) {
    uint32_t id;
    uint32_t type;
    uint32_t parent_id;
    uint32_t transform_idx;
    uint32_t geom_id;
    uint32_t mat_id;
} NodeRecord;            /* 24 bytes */

typedef struct __attribute__((packed)) {
    uint32_t vertex_count;
    uint32_t index_count;
    uint32_t index_type;   /* 0 = uint16, 1 = uint32 */
    uint32_t pos_off;
    uint32_t norm_off;
    uint32_t uv_off;
    uint32_t idx_off;
    uint32_t geo_type;
    uint32_t _pad[2];
} GeomRecord;            /* 40 bytes */

typedef struct __attribute__((packed)) {
    float    r, g, b, a;
    uint32_t mat_type;
    uint32_t tex_id;       /* 0xFFFFFFFF = no texture */
    float    wireframe;
    uint32_t transparent;
} MatRecord;             /* 32 bytes */

typedef struct __attribute__((packed)) {
    float px, py, pz, _p;          /* position + pad */
    float qx, qy, qz, qw;          /* rotation (quaternion) */
    float sx, sy, sz, _s;          /* scale + pad */
    float world_matrix[16];         /* world-space mat4, pre-baked if static */
} TransformRecord;       /* 128 bytes */

/* ── Runtime scene tables ── */

#define MAX_NODES      4096
#define MAX_GEOMETRIES 1024
#define MAX_MATERIALS  256
#define MAX_TEXTURES   64

typedef struct {
    GLuint  vao;
    GLuint  vbo_pos;
    GLuint  vbo_norm;
    GLuint  vbo_uv;
    GLuint  ebo;
    uint32_t index_count;
    uint32_t vertex_count;
    uint32_t index_type;   /* GL_UNSIGNED_SHORT or GL_UNSIGNED_INT */
} GpuGeometry;

typedef struct {
    float    color[4];
    uint32_t mat_type;
    uint32_t tex_id;
    bool     transparent;
} GpuMaterial;

typedef struct {
    GLuint tex;
    uint32_t width, height;
} GpuTexture;

typedef struct {
    uint32_t    node_type;
    uint32_t    geom_idx;
    uint32_t    mat_idx;
    mat4        world_matrix;
    /* draw-list sort key: (shader_variant << 24) | (mat_idx << 12) | geom_idx */
    uint32_t    sort_key;
} DrawCall;

static GpuGeometry  g_geometries[MAX_GEOMETRIES];
static GpuMaterial  g_materials[MAX_MATERIALS];
static GpuTexture   g_textures[MAX_TEXTURES];
static DrawCall     g_draw_list[MAX_NODES];

static uint32_t g_geom_count = 0;
static uint32_t g_mat_count  = 0;
static uint32_t g_tex_count  = 0;
static uint32_t g_draw_count = 0;

/* ─────────────────────────────────────────────────────────────────────────────
 * SECTION 5 — RENDERER
 * ───────────────────────────────────────────────────────────────────────────*/

/* ── Shader source strings (unlit variants) ── */

static const char *VERT_UNLIT_COLOR = "#version 300 es\n"
    "layout(location=0) in vec3 aPos;\n"
    "uniform mat4 uMVP;\n"
    "void main() { gl_Position = uMVP * vec4(aPos, 1.0); }\n";

static const char *FRAG_UNLIT_COLOR = "#version 300 es\n"
    "precision mediump float;\n"
    "uniform vec4 uColor;\n"
    "out vec4 fragColor;\n"
    "void main() { fragColor = uColor; }\n";

static const char *VERT_UNLIT_TEXTURE = "#version 300 es\n"
    "layout(location=0) in vec3 aPos;\n"
    "layout(location=2) in vec2 aUV;\n"
    "uniform mat4 uMVP;\n"
    "out vec2 vUV;\n"
    "void main() { vUV = aUV; gl_Position = uMVP * vec4(aPos, 1.0); }\n";

static const char *FRAG_UNLIT_TEXTURE = "#version 300 es\n"
    "precision mediump float;\n"
    "in vec2 vUV;\n"
    "uniform sampler2D uDiffuse;\n"
    "uniform vec4 uColor;\n"
    "out vec4 fragColor;\n"
    "void main() { fragColor = texture(uDiffuse, vUV) * uColor; }\n";

/* Shader variant indices */
#define SH_UNLIT_COLOR   0
#define SH_UNLIT_TEXTURE 1
#define SH_POINTS        2
#define SH_LINES         3
#define SH_COUNT         4

typedef struct {
    GLuint program;
    GLint  u_mvp;
    GLint  u_color;
    GLint  u_diffuse;
} ShaderCache;

static ShaderCache g_shaders[SH_COUNT];
static bool        g_shaders_ready = false;

/* ── Renderer state (avoid redundant GL calls) ── */
typedef struct {
    GLuint current_program;
    GLuint current_vao;
    GLuint current_texture[16];
} RenderState;

static RenderState g_state;

/* ── Camera / viewport ── */
static mat4     g_view_matrix;
static mat4     g_proj_matrix;
static uint32_t g_viewport_w = 800;
static uint32_t g_viewport_h = 600;

/* ── Forward declarations ── */
static GLuint compile_shader(GLenum type, const char *src);
static GLuint link_program(GLuint vs, GLuint fs);
static bool   load_shaders(void);
static void   upload_geometry(uint32_t idx, const GeomRecord *rec,
                               const uint8_t *data_seg);
static void   render_frame(double timestamp);

/* ─────────────────────────────────────────────────────────────────────────────
 * SECTION 6 — PUBLIC API
 * ───────────────────────────────────────────────────────────────────────────*/

static bool   g_initialized = false;
static uint8_t *g_scene_ptr = NULL;

TT_EXPORT uint8_t *tt_alloc(uint32_t size) {
    return (uint8_t *)arena_alloc(size);
}

TT_EXPORT int32_t tt_init(const uint8_t *scene_data, uint32_t scene_size,
                           uint32_t width, uint32_t height)
{
    if (g_initialized) tt_destroy();

    g_viewport_w = width;
    g_viewport_h = height;

    /* ── Validate header ────────────────────────────────────────────────────── */
    if (scene_size < sizeof(TscnHeader)) { TT_LOG("tt_init: scene too small"); return -1; }

    const TscnHeader *hdr = (const TscnHeader *)scene_data;

    if (hdr->magic != TSCN_MAGIC) { TT_LOG("tt_init: invalid magic"); return -2; }
    if (hdr->version_major != TSCN_VERSION_MAJOR) {
        TT_LOG("tt_init: unsupported version"); return -3;
    }
    if (hdr->checksum != 0) { TT_LOG("tt_init: non-zero checksum not yet supported"); return -4; }

    /* ── Locate segments ────────────────────────────────────────────────────── */
    const uint8_t *meta_seg = scene_data + sizeof(TscnHeader);
    const uint8_t *data_seg = meta_seg   + hdr->meta_size + hdr->string_heap_size;

    if ((size_t)(data_seg - scene_data) + hdr->data_size > scene_size) {
        TT_LOG("tt_init: data segment out of bounds"); return -5;
    }

    /* ── Parse counts header ────────────────────────────────────────────────── */
    if (hdr->meta_size < sizeof(MetaCountsHeader)) {
        TT_LOG("tt_init: meta segment too small"); return -6;
    }
    const MetaCountsHeader *counts = (const MetaCountsHeader *)meta_seg;
    const uint8_t *p = meta_seg + sizeof(MetaCountsHeader);

    /* ── Parse node table ───────────────────────────────────────────────────── */
    const NodeRecord *nodes = (const NodeRecord *)p;
    p += counts->node_count * sizeof(NodeRecord);

    /* ── Parse geometry table and upload VBOs ───────────────────────────────── */
    const GeomRecord *geoms = (const GeomRecord *)p;
    p += counts->geom_count * sizeof(GeomRecord);

    g_geom_count = counts->geom_count;
    for (uint32_t i = 0; i < g_geom_count; i++) {
        upload_geometry(i, &geoms[i], data_seg);
    }

    /* ── Parse material table ───────────────────────────────────────────────── */
    const MatRecord *mats = (const MatRecord *)p;
    p += counts->mat_count * sizeof(MatRecord);

    g_mat_count = counts->mat_count;
    for (uint32_t i = 0; i < g_mat_count; i++) {
        g_materials[i].color[0]   = mats[i].r;
        g_materials[i].color[1]   = mats[i].g;
        g_materials[i].color[2]   = mats[i].b;
        g_materials[i].color[3]   = mats[i].a;
        g_materials[i].mat_type   = mats[i].mat_type;
        g_materials[i].tex_id     = mats[i].tex_id;
        g_materials[i].transparent = mats[i].transparent != 0;
    }

    /* ── Parse transform table ─────────────────────────────────────────────── */
    const TransformRecord *transforms = (const TransformRecord *)p;
    p += counts->transform_count * sizeof(TransformRecord);

    /* ── Build draw list ────────────────────────────────────────────────────── */
    g_draw_count = 0;
    for (uint32_t i = 0; i < counts->node_count; i++) {
        const NodeRecord *n = &nodes[i];
        if (n->node_type != NODE_MESH && n->node_type != NODE_POINTS
            && n->node_type != NODE_LINE) continue;
        if (n->geom_id == 0xFFFFFFFF || n->mat_id == 0xFFFFFFFF) continue;
        if (g_draw_count >= MAX_NODES) break;

        DrawCall *dc = &g_draw_list[g_draw_count++];
        dc->node_type = n->node_type;
        dc->geom_idx  = n->geom_id;
        dc->mat_idx   = n->mat_id;

        /* Copy pre-baked world matrix from transform record */
        const TransformRecord *tr = &transforms[n->transform_idx];
        memcpy(dc->world_matrix.m, tr->world_matrix, sizeof(float) * 16);

        /* Sort key: shader first, then material, then geometry */
        uint32_t sh = (g_materials[n->mat_id].tex_id != 0xFFFFFFFF)
                        ? SH_UNLIT_TEXTURE : SH_UNLIT_COLOR;
        dc->sort_key = (sh << 20) | ((n->mat_id & 0x3FF) << 10) | (n->geom_id & 0x3FF);
    }

    /* ── Compile shaders ────────────────────────────────────────────────────── */
    g_shaders_ready = load_shaders();
    if (!g_shaders_ready) { TT_LOG("tt_init: shader compilation failed"); return -7; }

    /* ── Default camera ─────────────────────────────────────────────────────── */
    g_view_matrix = mat4_identity();
    /* Simple perspective */
    {
        float fov    = 1.309f; /* 75 degrees in radians */
        float aspect = (float)width / (float)(height > 0 ? height : 1);
        float near   = 0.1f, far = 1000.0f;
        float f      = 1.0f / tanf(fov * 0.5f);
        mat4 proj = {{0}};
        proj.m[0]  = f / aspect;
        proj.m[5]  = f;
        proj.m[10] = (far + near) / (near - far);
        proj.m[11] = -1.0f;
        proj.m[14] = (2.0f * far * near) / (near - far);
        g_proj_matrix = proj;
    }

    glEnable(GL_DEPTH_TEST);
    glViewport(0, 0, (GLint)width, (GLint)height);

    g_initialized = true;
    TT_LOG("tt_init: ready");
    return 0;
}

TT_EXPORT void tt_frame(double timestamp) {
    (void)timestamp;
    if (!g_initialized || !g_shaders_ready) return;
    render_frame(timestamp);
}

TT_EXPORT void tt_resize(uint32_t width, uint32_t height) {
    g_viewport_w = width;
    g_viewport_h = height;
    glViewport(0, 0, (GLint)width, (GLint)height);
    /* Update projection aspect ratio */
    float fov  = 1.309f;
    float asp  = (float)width / (float)(height > 0 ? height : 1);
    float near = 0.1f, far = 1000.0f;
    float f    = 1.0f / tanf(fov * 0.5f);
    g_proj_matrix.m[0] = f / asp;
    g_proj_matrix.m[5] = f;
    g_proj_matrix.m[10] = (far + near) / (near - far);
    g_proj_matrix.m[11] = -1.0f;
    g_proj_matrix.m[14] = (2.0f * far * near) / (near - far);
}

TT_EXPORT void tt_destroy(void) {
    if (!g_initialized) return;
    for (uint32_t i = 0; i < g_geom_count; i++) {
        glDeleteVertexArrays(1, &g_geometries[i].vao);
        glDeleteBuffers(1, &g_geometries[i].vbo_pos);
        if (g_geometries[i].vbo_norm) glDeleteBuffers(1, &g_geometries[i].vbo_norm);
        if (g_geometries[i].vbo_uv)   glDeleteBuffers(1, &g_geometries[i].vbo_uv);
        if (g_geometries[i].ebo)      glDeleteBuffers(1, &g_geometries[i].ebo);
    }
    for (uint32_t i = 0; i < SH_COUNT; i++) {
        if (g_shaders[i].program) glDeleteProgram(g_shaders[i].program);
    }
    arena_reset();
    g_geom_count  = 0;
    g_mat_count   = 0;
    g_draw_count  = 0;
    g_initialized = false;
    g_shaders_ready = false;
    memset(&g_state, 0, sizeof(g_state));
}

/* ─────────────────────────────────────────────────────────────────────────────
 * INTERNAL IMPLEMENTATIONS
 * ───────────────────────────────────────────────────────────────────────────*/

static GLuint compile_shader(GLenum type, const char *src) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[512];
        glGetShaderInfoLog(s, sizeof(log), NULL, log);
        TT_LOG(log);
        glDeleteShader(s);
        return 0;
    }
    return s;
}

static GLuint link_program(GLuint vs, GLuint fs) {
    GLuint p = glCreateProgram();
    glAttachShader(p, vs); glAttachShader(p, fs);
    glLinkProgram(p);
    GLint ok = 0;
    glGetProgramiv(p, GL_LINK_STATUS, &ok);
    glDetachShader(p, vs); glDetachShader(p, fs);
    glDeleteShader(vs); glDeleteShader(fs);
    if (!ok) {
        char log[512];
        glGetProgramInfoLog(p, sizeof(log), NULL, log);
        TT_LOG(log);
        glDeleteProgram(p);
        return 0;
    }
    return p;
}

static bool load_shaders(void) {
    /* SH_UNLIT_COLOR */
    GLuint vs = compile_shader(GL_VERTEX_SHADER,   VERT_UNLIT_COLOR);
    GLuint fs = compile_shader(GL_FRAGMENT_SHADER, FRAG_UNLIT_COLOR);
    if (!vs || !fs) return false;
    GLuint p = link_program(vs, fs);
    if (!p) return false;
    g_shaders[SH_UNLIT_COLOR].program  = p;
    g_shaders[SH_UNLIT_COLOR].u_mvp    = glGetUniformLocation(p, "uMVP");
    g_shaders[SH_UNLIT_COLOR].u_color  = glGetUniformLocation(p, "uColor");

    /* SH_UNLIT_TEXTURE */
    vs = compile_shader(GL_VERTEX_SHADER,   VERT_UNLIT_TEXTURE);
    fs = compile_shader(GL_FRAGMENT_SHADER, FRAG_UNLIT_TEXTURE);
    if (!vs || !fs) return false;
    p = link_program(vs, fs);
    if (!p) return false;
    g_shaders[SH_UNLIT_TEXTURE].program  = p;
    g_shaders[SH_UNLIT_TEXTURE].u_mvp    = glGetUniformLocation(p, "uMVP");
    g_shaders[SH_UNLIT_TEXTURE].u_color  = glGetUniformLocation(p, "uColor");
    g_shaders[SH_UNLIT_TEXTURE].u_diffuse = glGetUniformLocation(p, "uDiffuse");

    /* SH_POINTS and SH_LINES reuse UNLIT_COLOR for MVP */
    g_shaders[SH_POINTS] = g_shaders[SH_UNLIT_COLOR];
    g_shaders[SH_LINES]  = g_shaders[SH_UNLIT_COLOR];

    return true;
}

static void upload_geometry(uint32_t idx, const GeomRecord *rec, const uint8_t *data_seg) {
    GpuGeometry *g = &g_geometries[idx];

    glGenVertexArrays(1, &g->vao);
    glBindVertexArray(g->vao);

    /* Position */
    if (rec->pos_off && rec->vertex_count > 0) {
        glGenBuffers(1, &g->vbo_pos);
        glBindBuffer(GL_ARRAY_BUFFER, g->vbo_pos);
        glBufferData(GL_ARRAY_BUFFER,
                     rec->vertex_count * 3 * sizeof(float),
                     data_seg + rec->pos_off,
                     GL_STATIC_DRAW);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 0, 0);
    }

    /* UVs (attribute location 2) */
    if (rec->uv_off && rec->vertex_count > 0) {
        glGenBuffers(1, &g->vbo_uv);
        glBindBuffer(GL_ARRAY_BUFFER, g->vbo_uv);
        glBufferData(GL_ARRAY_BUFFER,
                     rec->vertex_count * 2 * sizeof(float),
                     data_seg + rec->uv_off,
                     GL_STATIC_DRAW);
        glEnableVertexAttribArray(2);
        glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, 0, 0);
    }

    /* Indices */
    g->index_count  = rec->index_count;
    g->vertex_count = rec->vertex_count;
    g->index_type   = rec->index_type ? GL_UNSIGNED_INT : GL_UNSIGNED_SHORT;

    if (rec->idx_off && rec->index_count > 0) {
        glGenBuffers(1, &g->ebo);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, g->ebo);
        uint32_t idx_bytes = rec->index_count *
                             (rec->index_type ? sizeof(uint32_t) : sizeof(uint16_t));
        glBufferData(GL_ELEMENT_ARRAY_BUFFER,
                     idx_bytes,
                     data_seg + rec->idx_off,
                     GL_STATIC_DRAW);
    }

    glBindVertexArray(0);
}

static void render_frame(double timestamp) {
    (void)timestamp;

    glClearColor(0.06f, 0.06f, 0.08f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    GLuint last_program = 0;
    GLuint last_vao     = 0;

    for (uint32_t i = 0; i < g_draw_count; i++) {
        const DrawCall    *dc  = &g_draw_list[i];
        const GpuGeometry *geo = &g_geometries[dc->geom_idx];
        const GpuMaterial *mat = &g_materials[dc->mat_idx];

        /* Select shader variant */
        uint32_t sh_idx = (mat->tex_id != 0xFFFFFFFF) ? SH_UNLIT_TEXTURE : SH_UNLIT_COLOR;
        if (dc->node_type == NODE_POINTS) sh_idx = SH_POINTS;
        if (dc->node_type == NODE_LINE)   sh_idx = SH_LINES;

        const ShaderCache *sh = &g_shaders[sh_idx];

        /* Bind program (avoid redundant switches) */
        if (sh->program != last_program) {
            glUseProgram(sh->program);
            last_program = sh->program;
            /* Upload view/proj every time program changes */
            /* MVP = proj * view * model  — simplified: upload as separate uniforms would need
               two more uniform locations; for MVP we combine into one MVP matrix */
        }

        /* Compute MVP = proj * view * world */
        mat4 vp  = mat4_mul(&g_proj_matrix, &g_view_matrix);
        mat4 mvp = mat4_mul(&vp, &dc->world_matrix);
        glUniformMatrix4fv(sh->u_mvp, 1, GL_FALSE, mvp.m);
        glUniform4fv(sh->u_color, 1, mat->color);

        /* Texture */
        if (sh_idx == SH_UNLIT_TEXTURE && mat->tex_id < g_tex_count) {
            glActiveTexture(GL_TEXTURE0);
            glBindTexture(GL_TEXTURE_2D, g_textures[mat->tex_id].tex);
            glUniform1i(sh->u_diffuse, 0);
        }

        /* Bind VAO (avoid redundant binds) */
        if (geo->vao != last_vao) {
            glBindVertexArray(geo->vao);
            last_vao = geo->vao;
        }

        /* Draw */
        if (geo->ebo && geo->index_count > 0) {
            glDrawElements(GL_TRIANGLES, (GLint)geo->index_count, geo->index_type, 0);
        } else {
            GLenum mode = (dc->node_type == NODE_POINTS) ? GL_POINTS
                        : (dc->node_type == NODE_LINE)   ? GL_LINES
                        : GL_TRIANGLES;
            glDrawArrays(mode, 0, (GLint)geo->vertex_count);
        }
    }

    glBindVertexArray(0);
}
