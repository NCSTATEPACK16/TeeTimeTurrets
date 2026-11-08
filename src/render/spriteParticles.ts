import * as THREE from "three";
import { ATLAS_COLS, ATLAS_ROWS } from "./spriteAtlas";
import { SpritePool } from "./spritePool";

/**
 * Draws a `SpritePool` as one instanced draw of camera-facing quads. Two instances of this live in
 * `EffectsLayer`: a normal-blended one for smoke, dust, spray and confetti, and an additive one for
 * flashes, fire and sparks.
 *
 * Per-instance data is three small attributes rewritten each frame from the pool; nothing is
 * allocated after construction. Dead sprites are drawn at size 0, so the instance count never
 * changes. Fog is applied so a far explosion sinks into the haze like the ground does.
 */

const VERTEX = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iParams; // size, angle, alpha, frame
  attribute vec3 iColor;
  uniform vec2 uCell;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    float c = cos(iParams.y);
    float s = sin(iParams.y);
    vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iParams.x;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = iPos + right * corner.x + up * corner.y;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float frame = iParams.w;
    float col = mod(frame, ${ATLAS_COLS.toFixed(1)});
    float row = floor(frame / ${ATLAS_COLS.toFixed(1)});
    vUv = (vec2(col, ${(ATLAS_ROWS - 1).toFixed(1)} - row) + uv) * uCell;
    vAlpha = iParams.z;
    vColor = iColor;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uAdditive;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec4 tex = texture2D(uAtlas, vUv);
    float a = tex.a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * tex.rgb * mix(1.0, a, uAdditive), a);
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogF = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      // Additive sprites fade into fog by dimming; mixing them toward the fog colour would make
      // a far flash glow fog-white.
      if (uAdditive > 0.5) gl_FragColor.rgb *= 1.0 - fogF;
      else gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF);
    #endif
    #include <colorspace_fragment>
  }
`;

export class SpriteParticles {
  readonly pool: SpritePool;
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly pos: THREE.InstancedBufferAttribute;
  private readonly params: THREE.InstancedBufferAttribute;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly color = new THREE.Color();

  constructor(capacity: number, atlas: THREE.Texture, additive: boolean, random: () => number) {
    this.pool = new SpritePool(capacity, random);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute("position", quad.getAttribute("position"));
    this.geometry.setAttribute("uv", quad.getAttribute("uv"));
    this.geometry.instanceCount = capacity;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.pos, this.params, this.colors]) a.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("iPos", this.pos);
    this.geometry.setAttribute("iParams", this.params);
    this.geometry.setAttribute("iColor", this.colors);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uAtlas: { value: null },
          uCell: { value: new THREE.Vector2(1 / ATLAS_COLS, 1 / ATLAS_ROWS) },
          uAdditive: { value: additive ? 1 : 0 },
        },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // Set after the merge: `UniformsUtils.merge` clones values, and a texture must stay shared.
    this.material.uniforms.uAtlas!.value = atlas;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // sprites span the course; any bounds would be stale
    // Glow draws after smoke, so a fireball reads through its own smoke.
    this.mesh.renderOrder = additive ? 3 : 2;
    quad.dispose();
  }

  update(dt: number): void {
    const pool = this.pool;
    pool.update(dt);
    const sprites = pool.sprites;
    const pos = this.pos.array as Float32Array;
    const params = this.params.array as Float32Array;
    const colors = this.colors.array as Float32Array;
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i]!;
      const p = i * 4;
      if (s.life <= 0) {
        params[p] = 0;
        continue;
      }
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.y;
      pos[i * 3 + 2] = s.z;
      params[p] = pool.sizeOf(s);
      params[p + 1] = s.angle;
      params[p + 2] = pool.alphaOf(s);
      params[p + 3] = s.frame;
      this.color.setHex(s.color);
      colors[i * 3] = this.color.r;
      colors[i * 3 + 1] = this.color.g;
      colors[i * 3 + 2] = this.color.b;
    }
    this.pos.needsUpdate = true;
    this.params.needsUpdate = true;
    this.colors.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
