import { Color, Vector3, type Node } from 'three/webgpu';
import {
  abs,
  cos,
  cross,
  dot,
  exp,
  float,
  Fn,
  length,
  Loop,
  max,
  min,
  mix,
  normalize,
  pow,
  reflect,
  sin,
  sqrt,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { envConfig } from './envConfig';

/*
 * Port to TSL of "Very fast procedural ocean" by afl_ext (Shadertoy MdXyzX, 2017; permissive
 * license, see ATTRIBUTION.md). Same wave sum, normal, cheap atmosphere, sun and shading terms.
 * Two changes for a raster engine: the surface is a mesh at the water level instead of a
 * raymarched heightfield, so the waves shade the normal only; and world meters map to the
 * shader's wave units through `waveScale`, so a pond can use small, short waves.
 */

type N2 = Node<'vec2'>;
type N3 = Node<'vec3'>;

const w = envConfig.water;

/** Live-editable wave settings (?tune=1 adds sliders). Iteration counts are compile-time. */
export const waterUniforms = {
  waveScale: uniform(w.waveScale),
  waveHeight: uniform(w.waveHeight),
  drag: uniform(w.drag),
  timeScale: uniform(w.timeScale),
  exposure: uniform(w.exposure),
  distanceSmoothing: uniform(w.distanceSmoothing),
  scatterColor: uniform(new Color(...w.scatterColor)),
  scatterStrength: uniform(w.scatterStrength),
  sunDirection: uniform(sunDirection()),
};

/** envConfig.sun as a unit vector toward the sun (compass azimuth: 0 = north (-Z), 90 = east (+X)). */
export function sunDirection(): Vector3 {
  const az = (envConfig.sun.azimuthDeg * Math.PI) / 180;
  const el = (envConfig.sun.elevationDeg * Math.PI) / 180;
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** getwaves(): sum of exp(sin) waves, each dragging the sample point along the last one's slope. 0..1. */
function waves(iterations: number) {
  return Fn(([start]: [N2]) => {
    const position = vec2(start).toVar();
    const phaseShift = length(position).mul(0.1);
    const iter = float(0).toVar();
    const frequency = float(1).toVar();
    const timeMultiplier = float(2).toVar();
    const weight = float(1).toVar();
    const sumOfValues = float(0).toVar();
    const sumOfWeights = float(0).toVar();
    const t = time.mul(waterUniforms.timeScale);
    Loop(iterations, () => {
      const p = vec2(sin(iter), cos(iter));
      const x = dot(p, position).mul(frequency).add(t.mul(timeMultiplier)).add(phaseShift);
      const wave = exp(sin(x).sub(1));
      const dx = wave.mul(cos(x));
      position.addAssign(p.mul(dx.negate()).mul(weight).mul(waterUniforms.drag));
      sumOfValues.addAssign(wave.mul(weight));
      sumOfWeights.addAssign(weight);
      weight.assign(mix(weight, 0, 0.2));
      frequency.mulAssign(1.18);
      timeMultiplier.mulAssign(1.07);
      iter.addAssign(1232.399963);
    });
    return sumOfValues.div(sumOfWeights);
  });
}

const wavesNormal = waves(w.normalIterations);

/** extra_cheap_atmosphere() times getAtmosphere()'s 0.5. Valid for dir.y >= 0. */
export const atmosphere = Fn(([raydir, sundir]: [N3, N3]) => {
  const skyColor = vec3(5.5, 13.0, 22.4).div(22.4);
  const specialTrick = float(1).div(raydir.y.add(0.1));
  const specialTrick2 = float(1).div(sundir.y.mul(11).add(1));
  const raySunDt = pow(abs(dot(sundir, raydir)), 2);
  const sunDt = pow(max(0, dot(sundir, raydir)), 8);
  const mie = sunDt.mul(specialTrick).mul(0.2);
  const sunColor = mix(vec3(1), max(vec3(0), vec3(1).sub(skyColor)), specialTrick2);
  const blueSky = skyColor.mul(sunColor);
  const blueSky2 = max(
    vec3(0),
    blueSky.sub(vec3(5.5, 13.0, 22.4).mul(0.002).mul(specialTrick.add(sundir.y.mul(sundir.y).mul(-6)))),
  )
    .mul(specialTrick)
    .mul(raySunDt.mul(0.24).add(0.24));
  return blueSky2
    .mul(pow(float(1).sub(raydir.y), 3).add(1))
    .add(mie.mul(sunColor))
    .mul(0.5);
});

/** getSun(): a tight, very bright disc. */
export const sun = Fn(([dir, sundir]: [N3, N3]) => pow(max(0, dot(dir, sundir)), 720).mul(210));

/** Sky color for a world direction, as the shader draws it (before its x2 exposure). */
export const skyColor = Fn(([dir]: [N3]) => {
  const d = normalize(vec3(dir.x, max(dir.y, 0), dir.z));
  return atmosphere(d, waterUniforms.sunDirection).add(sun(d, waterUniforms.sunDirection));
});

/**
 * Water color at a world point on the surface, seen from `eye`: the shader's normal(), distance
 * smoothing, Schlick fresnel, upward-bounced sky reflection plus sun, and crest-lit scattering.
 */
export const waterColor = Fn(([worldPos, eye]: [N3, N3]) => {
  const scale = waterUniforms.waveScale;
  const depth = waterUniforms.waveHeight.mul(scale); // the shader's WATER_DEPTH, in wave units
  const pos = worldPos.xz.mul(scale);
  const e = float(0.01);
  const h0 = wavesNormal(pos);
  const a = vec3(pos.x, h0.mul(depth), pos.y);
  const bx = vec3(pos.x.sub(e), wavesNormal(pos.sub(vec2(e, 0))).mul(depth), pos.y);
  const bz = vec3(pos.x, wavesNormal(pos.add(vec2(0, e))).mul(depth), pos.y.add(e));
  const n0 = normalize(cross(a.sub(bx), a.sub(bz)));

  const toPoint = worldPos.sub(eye);
  const dist = length(toPoint);
  const ray = toPoint.div(dist);
  const smoothing = waterUniforms.distanceSmoothing.mul(min(1, sqrt(dist.mul(0.01)).mul(1.1)));
  const n = normalize(mix(n0, vec3(0, 1, 0), smoothing));

  const fresnel = pow(float(1).sub(max(0, dot(n.negate(), ray))), 5).mul(0.96).add(0.04);
  const r0 = normalize(reflect(ray, n));
  const r = vec3(r0.x, abs(r0.y), r0.z);
  const reflection = atmosphere(r, waterUniforms.sunDirection).add(sun(r, waterUniforms.sunDirection));
  const scattering = waterUniforms.scatterColor.mul(waterUniforms.scatterStrength).mul(h0.add(0.2));
  return reflection.mul(fresnel).add(scattering).mul(waterUniforms.exposure);
});
