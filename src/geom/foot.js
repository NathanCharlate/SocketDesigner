import * as THREE from 'three';
import { tubeGeometry, orientOutward } from './mesh-utils.js';

function table(pts) {
  return (t) => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
      if (t <= t1) {
        const u = (t - t0) / (t1 - t0);
        const s = u * u * (3 - 2 * u);
        return v0 + (v1 - v0) * s;
      }
    }
    return pts[pts.length - 1][1];
  };
}

const HALF_WIDTH = table([[0, 0.1], [0.04, 0.125], [0.12, 0.14], [0.35, 0.145], [0.6, 0.165], [0.73, 0.185], [0.86, 0.17], [0.95, 0.12], [1, 0.05]]);
const THICK = table([[0, 0.12], [0.05, 0.2], [0.17, 0.27], [0.32, 0.3], [0.45, 0.25], [0.6, 0.16], [0.75, 0.1], [0.9, 0.07], [1, 0.035]]);
const BALL = 0.72;

/**
 * Stylised parametric foot. World frame: heel at z=0, toes towards +Z, floor at y=0.
 * length and heel in mm. side: 'right' | 'left'. The medial side of the right foot is towards +X.
 */
export class Foot {
  constructor(length, heel, side) {
    this.L = length;
    this.H = heel;
    this.medialSign = side === 'right' ? 1 : -1;
  }

  soleY(t) {
    let y;
    if (t >= BALL) {
      const u = (t - BALL) / (1 - BALL);
      y = 0.03 * this.L * u * u;
    } else {
      const u = (BALL - t) / BALL;
      y = this.H * (1 - Math.cos((Math.PI * u) / 2));
    }
    if (t < 0.06) y += 8 * ((0.06 - t) / 0.06) ** 2;
    return y;
  }

  centerX(t) {
    return this.medialSign * 0.035 * this.L * Math.max(0, (t - 0.45) / 0.55) ** 2;
  }

  /** Height of the top of the foot at abscissa z (mm). */
  topY(z) {
    const t = THREE.MathUtils.clamp(z / this.L, 0, 1);
    return this.soleY(t) + THICK(t) * this.L;
  }

  geometry() {
    const L = this.L;
    const nS = 48, m = 40;
    const rings = [];
    for (let i = 0; i < nS; i++) {
      const t = 0.006 + (0.988 * i) / (nS - 1);
      const w = HALF_WIDTH(t) * L, th = THICK(t) * L, ys = this.soleY(t), cx = this.centerX(t);
      const ring = new Float32Array(3 * m);
      for (let k = 0; k < m; k++) {
        const psi = (2 * Math.PI * k) / m;
        const c = Math.cos(psi), s = Math.sin(psi);
        const ex = Math.sign(c) * Math.abs(c) ** (2 / 3.2);
        const ey = s < 0 ? -(Math.abs(s) ** (2 / 4)) : Math.abs(s) ** (2 / 2.4);
        ring[3 * k] = cx + w * ex;
        ring[3 * k + 1] = ys + th * (0.5 + 0.5 * ey);
        ring[3 * k + 2] = t * L;
      }
      rings.push(ring);
    }
    const heel = [this.centerX(0), this.soleY(0) + THICK(0) * L * 0.5, 0];
    const toe = [this.centerX(1), this.soleY(1) + THICK(1) * L * 0.5, L];
    const g = orientOutward(tubeGeometry(rings, m, heel, toe));
    g.computeVertexNormals();
    return g;
  }
}
