import * as THREE from "three";
import { FIELD_SIZE, NCOLS, NROWS, heightAt } from "../sim/terrain";
import type { BallTransform } from "../sim/world";

const BALL_RADIUS = 0.15;

/** Pure consumer of sim state: builds the scene once, then reads interpolated transforms every frame. */
export class RenderScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ball: THREE.Mesh;
  private readonly aimArrow: THREE.ArrowHelper;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly aimDirScratch = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc7ff);
    // Fog and far plane are sized to FIELD_SIZE: at the old 25/65 the fog closed in well
    // inside the playable area and hid most of a full drive's landing zone.
    this.scene.fog = new THREE.Fog(0x8fc7ff, FIELD_SIZE * 0.5, FIELD_SIZE * 2);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      FIELD_SIZE * 2.5,
    );

    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(12, 18, 8);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    this.scene.add(buildGroundMesh());

    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 20, 16);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    this.ball = new THREE.Mesh(ballGeo, ballMat);
    this.scene.add(this.ball);

    this.aimArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 2, 0xffee55, 0.5, 0.3);
    this.scene.add(this.aimArrow);

    this.cameraTarget.set(0, 0, 0);
    window.addEventListener("resize", () => this.onResize());
  }

  draw(interpolated: BallTransform, aimYawRadians: number, power: number): void {
    this.ball.position.set(interpolated.position.x, interpolated.position.y, interpolated.position.z);
    this.ball.quaternion.set(
      interpolated.rotation.x,
      interpolated.rotation.y,
      interpolated.rotation.z,
      interpolated.rotation.w,
    );

    this.aimArrow.position.copy(this.ball.position);
    this.aimArrow.position.y += BALL_RADIUS;
    this.aimDirScratch.set(Math.cos(aimYawRadians), 0, Math.sin(aimYawRadians));
    this.aimArrow.setDirection(this.aimDirScratch);
    this.aimArrow.setLength(1.2 + power * 2, 0.4, 0.25);

    this.cameraTarget.lerp(this.ball.position, 0.08);
    this.camera.position.set(this.cameraTarget.x - 6, this.cameraTarget.y + 4.5, this.cameraTarget.z + 7);
    this.camera.lookAt(this.cameraTarget);

    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

/**
 * Vertex layout matches Rapier's heightfield exactly: PlaneGeometry iterates
 * row-major (row = heightSegments, col = widthSegments) and after rotateX(-90deg)
 * row maps to world Z, col maps to world X -- the same mapping terrain.ts uses
 * for the physics heightfield's column-major heights array (verified empirically,
 * not assumed, against the installed Rapier build).
 */
function buildGroundMesh(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE, NCOLS, NROWS);
  const position = geometry.attributes.position;
  for (let row = 0; row <= NROWS; row++) {
    for (let col = 0; col <= NCOLS; col++) {
      const index = row * (NCOLS + 1) + col;
      const worldX = (col / NCOLS - 0.5) * FIELD_SIZE;
      const worldZ = (row / NROWS - 0.5) * FIELD_SIZE;
      position.setZ(index, heightAt(worldX, worldZ));
    }
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.95 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
