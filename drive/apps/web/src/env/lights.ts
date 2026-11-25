import { DirectionalLight, HemisphereLight, type Scene } from 'three/webgpu';
import { envConfig } from './envConfig';

/** Hemisphere fill plus one sun. No shadows until M3. */
export function addLights(scene: Scene): DirectionalLight {
  const h = envConfig.hemisphere;
  scene.add(new HemisphereLight(h.sky, h.ground, h.intensity));
  const s = envConfig.sun;
  const sun = new DirectionalLight(s.color, s.intensity);
  const az = (s.azimuthDeg * Math.PI) / 180;
  const el = (s.elevationDeg * Math.PI) / 180;
  // Compass azimuth: 0 = north (-Z), 90 = east (+X).
  sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(s.distance);
  scene.add(sun, sun.target);
  return sun;
}
