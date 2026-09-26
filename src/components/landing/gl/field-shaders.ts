/**
 * GLSL ES 3.00 for the hero's visual-data field. Deliberately small: one
 * instanced quad per fragment, one texture read, no post-processing.
 *
 * Coordinates are CSS pixels from the canvas centre (y down), so sizes and
 * the pointer light are resolution-independent; the canvas's device-pixel
 * ratio is used only for analytic edge anti-aliasing.
 */

export const FIELD_VERTEX = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;   // quad corner, -1..1
layout(location = 1) in vec4 a_chaos;    // x, y (screen-normalised, y down), depth 0..1, width (css px)
layout(location = 2) in vec4 a_order;    // cluster x, cluster y (screen-normalised), grid col, grid row
layout(location = 3) in vec4 a_window;   // atlas window: u0, v0, du, dv
layout(location = 4) in vec4 a_meta;     // seed, aspect (h / w), kind (0 image, 1 outline), tone

uniform vec2 u_res;      // canvas size, css px
uniform float u_dpr;
uniform float u_time;    // seconds
uniform vec2 u_cam;      // eased pointer, -1..1
uniform vec3 u_light;    // pointer in canvas css px (xy), strength (z)
uniform float u_order;   // 0 = raw scatter, 1 = organised
uniform float u_intro;   // 0..1 materialise
uniform float u_cell;    // organised grid cell, css px

out vec2 v_uv;
out vec2 v_px;
out vec2 v_half;
out float v_alpha;
out float v_fog;
out float v_light;
out float v_tone;
flat out float v_kind;

void main() {
  float seed = a_meta.x;
  vec2 halfRes = 0.5 * u_res;

  // Per-fragment easing: convergence ripples through the field rather than moving in lockstep.
  float k = smoothstep(0.0, 1.0, clamp(u_order * 1.4 - seed * 0.4, 0.0, 1.0));

  // Raw state: slow independent drift, wider for nearer fragments.
  float z = a_chaos.z;
  vec2 drift = vec2(
    sin(u_time * (0.05 + 0.06 * seed) + seed * 43.7),
    cos(u_time * (0.04 + 0.05 * fract(seed * 7.31)) + seed * 17.3)
  ) * (5.0 + 15.0 * (1.0 - z));
  vec2 chaos = a_chaos.xy * halfRes + drift * (1.0 - k);

  // Organised state: a cell in a loose grid block.
  vec2 order = a_order.xy * halfRes + a_order.zw * u_cell;

  vec2 pos = mix(chaos, order, k);
  float depth = mix(z, 0.3, k);

  // Camera parallax: near fragments travel further than far ones.
  pos -= u_cam * vec2(28.0, 18.0) * (1.0 - depth);

  // Varied shards become uniform tiles.
  float w = mix(a_chaos.w, u_cell * 0.76, k);
  float h = w * mix(a_meta.y, 1.0, k);
  float intro = smoothstep(seed * 0.7, seed * 0.7 + 0.3, u_intro);
  vec2 halfSize = 0.5 * vec2(w, h) * mix(0.6, 1.0, intro);

  // Grow the quad by one device pixel; the fragment shader anti-aliases the true edge.
  vec2 grown = halfSize + vec2(1.0 / u_dpr);
  vec2 corner = a_corner * grown;
  vec2 screen = pos + corner;
  gl_Position = vec4(screen.x / halfRes.x, -screen.y / halfRes.y, 0.0, 1.0);

  vec2 local = 0.5 + 0.5 * a_corner * grown / halfSize;
  v_uv = a_window.xy + local * a_window.zw;
  v_px = corner * u_dpr;
  v_half = halfSize * u_dpr;

  // Soft pointer light (sigma ~150 css px).
  vec2 toLight = pos + halfRes - u_light.xy;
  float light = u_light.z * exp(-dot(toLight, toLight) / 45000.0);
  v_light = light;
  v_alpha = mix(0.52, 0.25, depth) * intro * (1.0 + 0.7 * light);
  v_fog = mix(depth * depth * 0.78, 0.12, k);
  v_tone = a_meta.w;
  v_kind = a_meta.z;
}
`;

export const FIELD_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D u_tex;
uniform float u_dpr;

in vec2 v_uv;
in vec2 v_px;
in vec2 v_half;
in float v_alpha;
in float v_fog;
in float v_light;
in float v_tone;
flat in float v_kind;

out vec4 outColor;

const vec3 NAVY = vec3(0.039, 0.067, 0.125);
const vec3 SIGNAL = vec3(0.239, 0.839, 0.961);

void main() {
  // Sample first: implicit-LOD lookups must stay in uniform control flow.
  vec3 tex = texture(u_tex, v_uv).rgb;

  // Analytic coverage of the axis-aligned edge, in device pixels.
  vec2 inside = v_half - abs(v_px);
  float cover = clamp(inside.x + 0.5, 0.0, 1.0) * clamp(inside.y + 0.5, 0.0, 1.0);
  if (cover <= 0.001) discard;

  float alpha = v_alpha * cover;
  vec3 color;
  if (v_kind > 0.5) {
    // Empty detection box: a one-css-pixel hairline.
    float edge = min(inside.x, inside.y);
    float stroke = 1.0 - smoothstep(u_dpr - 0.5, u_dpr + 0.5, edge);
    color = SIGNAL;
    alpha *= stroke * (0.5 + 0.5 * v_light);
  } else {
    // Restrained colour: partly desaturated, cooled toward the palette, fogged by depth.
    float luma = dot(tex, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), tex, 0.6) * v_tone;
    color *= vec3(0.9, 0.98, 1.06);
    color *= 0.8 + 0.8 * v_light;
    color = mix(color, NAVY, v_fog);
  }
  outColor = vec4(color * alpha, alpha);
}
`;
