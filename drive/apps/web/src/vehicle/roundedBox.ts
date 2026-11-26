import { BoxGeometry, Vector3 } from 'three/webgpu';

/*
 * A port of three.js's RoundedBoxGeometry (examples/jsm/geometries/RoundedBoxGeometry.js, r186),
 * importing from three/webgpu so free drive loads one three core. The addon imports 'three',
 * which would load a second core beside three/webgpu. Copyright © 2010-2026 three.js authors,
 * MIT License (see NOTICE). Vertex positions, normals and UVs are computed as the original does.
 */

const tempNormal = new Vector3();

function getUv(
  faceDirVector: Vector3,
  normal: Vector3,
  uvAxis: 'x' | 'y' | 'z',
  projectionAxis: 'x' | 'y' | 'z',
  radius: number,
  sideLength: number,
): number {
  const totArcLength = (2 * Math.PI * radius) / 4;
  // Length of the planes between the arcs on each axis.
  const centerLength = Math.max(sideLength - 2 * radius, 0);
  const halfArc = Math.PI / 4;
  // The normal projected onto the plane across `projectionAxis`.
  tempNormal.copy(normal);
  tempNormal[projectionAxis] = 0;
  tempNormal.normalize();
  // UV space given to a single arc, and how far along it the point is.
  const arcUvRatio = (0.5 * totArcLength) / (totArcLength + centerLength);
  const arcAngleRatio = 1.0 - tempNormal.angleTo(faceDirVector) / halfArc;
  if (Math.sign(tempNormal[uvAxis]) === 1) return arcAngleRatio * arcUvRatio;
  const lenUv = centerLength / (totArcLength + centerLength);
  return lenUv + arcUvRatio + arcUvRatio * (1.0 - arcAngleRatio);
}

/**
 * A box with rounded corners and edges, non-indexed, as three's RoundedBoxGeometry builds it. The
 * radius is clamped to half the shortest side, as the original does; callers that must not
 * clamp check it first (cartGraph.ts does).
 */
export function roundedBoxGeometry(width = 1, height = 1, depth = 1, segments = 2, radius = 0.1): BoxGeometry {
  // Odd, so a plane joins the rounded corners.
  const totalSegments = segments * 2 + 1;
  radius = Math.min(width / 2, height / 2, depth / 2, radius);
  // A unit box whose vertices are moved onto the rounded box.
  const geometry = new BoxGeometry(1, 1, 1, totalSegments, totalSegments, totalSegments);
  if (totalSegments === 1) return geometry;

  const flat = geometry.toNonIndexed();
  geometry.index = null;
  geometry.attributes.position = flat.attributes.position!;
  geometry.attributes.normal = flat.attributes.normal!;
  geometry.attributes.uv = flat.attributes.uv!;

  const position = new Vector3();
  const normal = new Vector3();
  const box = new Vector3(width, height, depth).divideScalar(2).subScalar(radius);
  const positions = geometry.attributes.position.array as Float32Array;
  const normals = geometry.attributes.normal.array as Float32Array;
  const uvs = geometry.attributes.uv.array as Float32Array;
  const faceTris = positions.length / 6;
  const faceDirVector = new Vector3();
  const halfSegmentSize = 0.5 / totalSegments;

  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    position.fromArray(positions, i);
    normal.copy(position);
    normal.x -= Math.sign(normal.x) * halfSegmentSize;
    normal.y -= Math.sign(normal.y) * halfSegmentSize;
    normal.z -= Math.sign(normal.z) * halfSegmentSize;
    normal.normalize();

    positions[i + 0] = box.x * Math.sign(position.x) + normal.x * radius;
    positions[i + 1] = box.y * Math.sign(position.y) + normal.y * radius;
    positions[i + 2] = box.z * Math.sign(position.z) + normal.z * radius;
    normals[i + 0] = normal.x;
    normals[i + 1] = normal.y;
    normals[i + 2] = normal.z;

    switch (Math.floor(i / faceTris)) {
      case 0: // right: UVs along Z then Y
        faceDirVector.set(1, 0, 0);
        uvs[j + 0] = getUv(faceDirVector, normal, 'z', 'y', radius, depth);
        uvs[j + 1] = 1.0 - getUv(faceDirVector, normal, 'y', 'z', radius, height);
        break;
      case 1: // left
        faceDirVector.set(-1, 0, 0);
        uvs[j + 0] = 1.0 - getUv(faceDirVector, normal, 'z', 'y', radius, depth);
        uvs[j + 1] = 1.0 - getUv(faceDirVector, normal, 'y', 'z', radius, height);
        break;
      case 2: // top: UVs along X then Z
        faceDirVector.set(0, 1, 0);
        uvs[j + 0] = 1.0 - getUv(faceDirVector, normal, 'x', 'z', radius, width);
        uvs[j + 1] = getUv(faceDirVector, normal, 'z', 'x', radius, depth);
        break;
      case 3: // bottom
        faceDirVector.set(0, -1, 0);
        uvs[j + 0] = 1.0 - getUv(faceDirVector, normal, 'x', 'z', radius, width);
        uvs[j + 1] = 1.0 - getUv(faceDirVector, normal, 'z', 'x', radius, depth);
        break;
      case 4: // front: UVs along X then Y
        faceDirVector.set(0, 0, 1);
        uvs[j + 0] = 1.0 - getUv(faceDirVector, normal, 'x', 'y', radius, width);
        uvs[j + 1] = 1.0 - getUv(faceDirVector, normal, 'y', 'x', radius, height);
        break;
      case 5: // back
        faceDirVector.set(0, 0, -1);
        uvs[j + 0] = getUv(faceDirVector, normal, 'x', 'y', radius, width);
        uvs[j + 1] = 1.0 - getUv(faceDirVector, normal, 'y', 'x', radius, height);
        break;
    }
  }
  flat.dispose();
  return geometry;
}
