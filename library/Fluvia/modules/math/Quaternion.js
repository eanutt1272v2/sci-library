class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  static fromAxisAngle(axis, angle) {
    const s = Math.sin(angle * 0.5);
    return new Quaternion(
      axis.x * s,
      axis.y * s,
      axis.z * s,
      Math.cos(angle * 0.5),
    );
  }

  static fromEuler(pitch, yaw) {
    const qYaw = Quaternion.fromAxisAngle({ x: 0, y: 0, z: 1 }, yaw);
    const qPitch = Quaternion.fromAxisAngle({ x: 1, y: 0, z: 0 }, pitch);

    return qYaw.multiply(qPitch);
  }

  multiply(q) {
    return new Quaternion(
      this.x * q.w + this.w * q.x + this.y * q.z - this.z * q.y,
      this.y * q.w + this.w * q.y + this.z * q.x - this.x * q.z,
      this.z * q.w + this.w * q.z + this.x * q.y - this.y * q.x,
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
    );
  }

  applyToVector(v) {
    const { x, y, z } = v;
    const { x: qx, y: qy, z: qz, w: qw } = this;
    const ix = qw * x + qy * z - qz * y,
      iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x,
      iw = -qx * x - qy * y - qz * z;
    return {
      x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
      y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
      z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
    };
  }

  normalise() {
    const l = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2 + this.w ** 2);
    if (l > 0) {
      this.x /= l;
      this.y /= l;
      this.z /= l;
      this.w /= l;
    }
    return this;
  }
}

// Stage 1 compatibility bridge: keeps this file working as a classic <script>
// global for consumers not yet migrated to ES modules. Remove once all
// consumers import it directly.
globalThis.Quaternion = Quaternion;

export { Quaternion };
