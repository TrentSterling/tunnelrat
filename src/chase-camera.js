// Camera-only obstruction query. Flight, collision, assets and mission state are
// untouched. Static decoration is indexed once per level, not once per frame.
import * as THREE from 'three';

export const CHASE_OFFSET = new THREE.Vector3(0, 1.9, 6.2);
const SKIN = .002;
const ROCK_STEP = .1;

export class ChaseCamera {
  constructor(field, roots = []) {
    this.field = field;
    this.obstacles = [];
    const instance = new THREE.Matrix4();
    for (const root of roots.filter(Boolean)) {
      root.updateWorldMatrix(true, true);
      root.traverse(o => {
        if (!o.isMesh) return;
        const geo = o.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        for (let i = 0; i < (o.isInstancedMesh ? o.count : 1); i++) {
          const matrix = o.matrixWorld.clone();
          if (o.isInstancedMesh) { o.getMatrixAt(i, instance); matrix.multiply(instance); }
          this.obstacles.push({ geo, matrix, box: geo.boundingBox.clone().applyMatrix4(matrix) });
        }
      });
    }
    this.ray = new THREE.Ray();
    this.box = new THREE.Box3();
    this.triangle = new THREE.Triangle();
    this.point = new THREE.Vector3();
    this.closest = new THREE.Vector3();
    this.worldOffset = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.lean = new THREE.Vector3();
    this.inverse = new THREE.Quaternion();
  }

  // Earliest contact of a sphere moving along the boom with a triangle. Distance
  // to a triangle is 1-Lipschitz, so advancing by the remaining clearance cannot
  // cross its surface. Includes triangle edges, backs and vertices, not just a
  // front-face ray. A grazing iteration limit fails conservatively toward ship.
  triangleContact(maxDistance, radius) {
    let t = 0;
    for (let i = 0; i < 64; i++) {
      this.ray.at(t, this.point);
      this.triangle.closestPointToPoint(this.point, this.closest);
      const gap = this.point.distanceTo(this.closest) - radius;
      if (gap <= SKIN) return Math.max(0, t - SKIN);
      t += gap;
      if (t > maxDistance) return maxDistance;
    }
    return Math.max(0, t - SKIN);
  }

  // Clip the complete final segment, so smoothing or velocity lean cannot place
  // the camera beyond an obstruction. Radius covers near-plane corners + shake.
  constrain(origin, quaternion, offset, radius = .25) {
    this.worldOffset.copy(offset).applyQuaternion(quaternion);
    const length = this.worldOffset.length();
    if (length < 1e-9) return offset;
    this.ray.origin.copy(origin);
    this.ray.direction.copy(this.worldOffset).multiplyScalar(1 / length);
    let limit = length;
    // Retain the old 0.8m rock margin and add tolerance between samples.
    // This is the game's approximate density, not a new collider.
    const clearance = Math.max(.8, radius) + ROCK_STEP;
    for (let t = 0; ; t = Math.min(length, t + ROCK_STEP)) {
      this.ray.at(t, this.point);
      if (this.field.sample(this.point.x, this.point.y, this.point.z) >= -clearance) {
        limit = Math.max(0, t - ROCK_STEP); break;
      }
      if (t === length) break;
    }
    for (const { geo, matrix, box } of this.obstacles) {
      this.box.copy(box).expandByScalar(radius + SKIN);
      if (!this.box.containsPoint(origin)) {
        if (!this.ray.intersectBox(this.box, this.point) || origin.distanceTo(this.point) > limit) continue;
      }
      const position = geo.attributes.position, index = geo.index;
      const count = index ? index.count : position.count;
      for (let i = 0; i < count; i += 3) {
        this.triangle.a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
        this.triangle.b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
        this.triangle.c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);
        limit = this.triangleContact(limit, radius);
      }
      if (limit === 0) break;
    }
    return offset.multiplyScalar(limit / length);
  }

  update(offset, dt, origin, quaternion, velocity, radius = .25) {
    this.inverse.copy(quaternion).invert();
    this.lean.copy(velocity).applyQuaternion(this.inverse).multiplyScalar(-1).clampLength(0, .6);
    this.target.copy(CHASE_OFFSET).add(this.lean);
    // Retract immediately for safety, extend with the existing exponential follow.
    this.constrain(origin, quaternion, this.target, radius);
    offset.lerp(this.target, 1 - Math.exp(-Math.max(0, dt) * 8));
    return this.constrain(origin, quaternion, offset, radius);
  }
}
