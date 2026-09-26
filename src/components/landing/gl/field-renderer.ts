import { FLOATS_PER_INSTANCE } from './field-geometry';
import { FIELD_FRAGMENT, FIELD_VERTEX } from './field-shaders';

/**
 * Raw WebGL2 renderer for the visual-data field: one static instance buffer,
 * one texture (the Cloudinary atlas), one instanced draw call per frame.
 * Everything that changes per frame travels as a handful of uniforms.
 */

export interface FieldFrame {
  /** Seconds. */
  time: number;
  /** Eased pointer, −1…1 around the viewport centre. */
  camX: number;
  camY: number;
  /** Pointer position in canvas CSS pixels, and light strength 0…1. */
  lightX: number;
  lightY: number;
  light: number;
  /** 0 = raw scatter, 1 = organised clusters. */
  order: number;
  /** 0…1 materialise-in after the atlas arrives. */
  intro: number;
}

export interface FieldRenderer {
  /** Canvas size in CSS pixels and the device-pixel ratio used for its backing store. */
  setSize(cssWidth: number, cssHeight: number, dpr: number): void;
  draw(frame: FieldFrame): void;
  dispose(): void;
}

const UNIFORMS = ['u_res', 'u_dpr', 'u_time', 'u_cam', 'u_light', 'u_order', 'u_intro', 'u_cell', 'u_tex'] as const;
type UniformName = (typeof UNIFORMS)[number];

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    if (process.env.NODE_ENV !== 'production') console.warn('[DataField] shader:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createFieldRenderer(
  gl: WebGL2RenderingContext,
  atlas: TexImageSource,
  instances: Float32Array,
): FieldRenderer | null {
  const vs = compile(gl, gl.VERTEX_SHADER, FIELD_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FIELD_FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    if (program) gl.deleteProgram(program);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== 'production') console.warn('[DataField] link:', gl.getProgramInfoLog(program));
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteProgram(program);
    return null;
  }

  const uniforms = {} as Record<UniformName, WebGLUniformLocation | null>;
  for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);

  // Geometry: one shared unit quad + per-instance attributes.
  const vao = gl.createVertexArray();
  const quad = gl.createBuffer();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, instances, gl.STATIC_DRAW);
  const stride = FLOATS_PER_INSTANCE * 4;
  for (let slot = 0; slot < 4; slot += 1) {
    const location = slot + 1;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, slot * 16);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  const count = instances.length / FLOATS_PER_INSTANCE;

  // The atlas: mipmapped so tiny shards stay calm instead of shimmering.
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  // Premultiplied output over a transparent canvas.
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  let width = 1;
  let height = 1;
  let dpr = 1;

  return {
    setSize(cssWidth, cssHeight, ratio) {
      width = Math.max(1, cssWidth);
      height = Math.max(1, cssHeight);
      dpr = ratio;
    },
    draw(frame) {
      if (gl.isContextLost()) return;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.u_tex, 0);
      gl.uniform2f(uniforms.u_res, width, height);
      gl.uniform1f(uniforms.u_dpr, dpr);
      gl.uniform1f(uniforms.u_time, frame.time);
      gl.uniform2f(uniforms.u_cam, frame.camX, frame.camY);
      gl.uniform3f(uniforms.u_light, frame.lightX, frame.lightY, frame.light);
      gl.uniform1f(uniforms.u_order, frame.order);
      gl.uniform1f(uniforms.u_intro, frame.intro);
      // Organised grid cell scales with the viewport: 6px on phones, 11px on wide screens.
      gl.uniform1f(uniforms.u_cell, Math.min(11, Math.max(6, width / 130)));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}
