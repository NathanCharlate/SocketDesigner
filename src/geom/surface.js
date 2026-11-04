import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { tubeIndex } from './mesh-utils.js';

/**
 * "Radial grid" representation of the shape, in the limb frame:
 * long axis = Y (distal end near y≈0), front (anterior) = +Z.
 *
 * - a distal dome: rays from the centre C=(0,hc,0), polar angle 0→90°
 * - a cylindrical part: horizontal rays from the axis, from hc up to htop[j] (top of column)
 *
 * Each vertex is defined by a distance r along its ray. Vertex 0 = distal pole,
 * then nRings rings of nCols vertices. Ring nDome is horizontal (dome / cylinder junction).
 */
export class GridSurface {
  constructor(nCols, nDome, nCyl, hc, htop) {
    this.nCols = nCols;
    this.nDome = nDome;
    this.nCyl = nCyl;
    this.nRings = nDome + nCyl;
    this.hc = hc;
    this.htop = htop;
    this.nV = 1 + this.nRings * nCols;
    this.cos = new Float32Array(nCols);
    this.sin = new Float32Array(nCols);
    for (let j = 0; j < nCols; j++) {
      const t = (2 * Math.PI * j) / nCols;
      this.cos[j] = Math.cos(t);
      this.sin[j] = Math.sin(t);
    }
    this.r = new Float32Array(this.nV);
    this._index = null;
  }

  idx(a, j) {
    return a === 0 ? 0 : 1 + (a - 1) * this.nCols + j;
  }

  ray(a, j, o, d) {
    if (a <= this.nDome) {
      const phi = (a / this.nDome) * Math.PI * 0.5;
      const s = Math.sin(phi);
      o.set(0, this.hc, 0);
      d.set(s * this.cos[j], -Math.cos(phi), s * this.sin[j]);
    } else {
      const b = a - this.nDome;
      o.set(0, this.hc + ((this.htop[j] - this.hc) * b) / this.nCyl, 0);
      d.set(this.cos[j], 0, this.sin[j]);
    }
  }

  index() {
    if (!this._index) this._index = tubeIndex(this.nRings, this.nCols, true, false);
    return this._index;
  }

  positions(r = this.r) {
    const P = new Float32Array(this.nV * 3);
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    this.ray(0, 0, o, d);
    P[0] = o.x + d.x * r[0]; P[1] = o.y + d.y * r[0]; P[2] = o.z + d.z * r[0];
    for (let a = 1; a <= this.nRings; a++) {
      for (let j = 0; j < this.nCols; j++) {
        const i = this.idx(a, j);
        this.ray(a, j, o, d);
        P[3 * i] = o.x + d.x * r[i];
        P[3 * i + 1] = o.y + d.y * r[i];
        P[3 * i + 2] = o.z + d.z * r[i];
      }
    }
    return P;
  }

  /** Laplacian smoothing of the radius field (does not shrink a cylinder or a cone). */
  smoothR(src, iterations, lambda) {
    let a = Float32Array.from(src);
    let b = new Float32Array(a.length);
    const n = this.nCols, R = this.nRings;
    for (let it = 0; it < iterations; it++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += a[1 + j];
      b[0] = a[0] + lambda * (s / n - a[0]);
      for (let k = 1; k <= R; k++) {
        const base = 1 + (k - 1) * n;
        for (let j = 0; j < n; j++) {
          const i = base + j;
          let sum = a[base + ((j + n - 1) % n)] + a[base + ((j + 1) % n)] + (k === 1 ? a[0] : a[i - n]);
          let cnt = 3;
          if (k < R) { sum += a[i + n]; cnt++; }
          b[i] = a[i] + lambda * (sum / cnt - a[i]);
        }
      }
      const t = a; a = b; b = t;
    }
    return a;
  }

  /** Point of meridian j at height y=h (linear interpolation). Returns false if above the top. */
  pointAtHeight(P, j, h, out) {
    let prev = 0;
    let prevY = P[1];
    if (h <= prevY) {
      out.set(P[0], P[1], P[2]);
      return true;
    }
    for (let k = 1; k <= this.nRings; k++) {
      const i = 1 + (k - 1) * this.nCols + j;
      const y = P[3 * i + 1];
      if (y >= h) {
        const f = (h - prevY) / Math.max(1e-9, y - prevY);
        out.set(
          P[3 * prev] + (P[3 * i] - P[3 * prev]) * f,
          h,
          P[3 * prev + 2] + (P[3 * i + 2] - P[3 * prev + 2]) * f,
        );
        return true;
      }
      prev = i;
      prevY = y;
    }
    return false;
  }

  /** Horizontal section: array of nCols points, or null if the section leaves the shape. */
  slice(P, h) {
    const out = new Float32Array(this.nCols * 3);
    const v = new THREE.Vector3();
    for (let j = 0; j < this.nCols; j++) {
      if (!this.pointAtHeight(P, j, h, v)) return null;
      out[3 * j] = v.x; out[3 * j + 1] = v.y; out[3 * j + 2] = v.z;
    }
    return out;
  }

  /** Area centroid and perimeter of a section. */
  static sliceStats(S) {
    const n = S.length / 3;
    let A = 0, cx = 0, cz = 0, per = 0;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      const x0 = S[3 * j], z0 = S[3 * j + 2], x1 = S[3 * k], z1 = S[3 * k + 2];
      const c = x0 * z1 - x1 * z0;
      A += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c;
      per += Math.hypot(x1 - x0, z1 - z0);
    }
    A *= 0.5;
    if (Math.abs(A) < 1e-6) return { area: 0, cx: 0, cz: 0, perimeter: per };
    return { area: Math.abs(A), cx: cx / (6 * A), cz: cz / (6 * A), perimeter: per };
  }

  /** Mean radius of the cylindrical part (used as the scale of the trim line). */
  meanRadius(r = this.r) {
    let s = 0, c = 0;
    for (let i = 1 + this.nDome * this.nCols; i < this.nV; i++) { s += r[i]; c++; }
    return c ? s / c : 50;
  }

  /**
   * Resamples a scan mesh (already in the limb frame) into a radial grid.
   * keepPlane: cut plane; the side where distanceToPoint <= 0 is kept.
   */
  static fromGeometry(geometry, keepPlane, opts = {}) {
    const nCols = opts.nCols ?? 180;
    const nDome = opts.nDome ?? 20;
    const spacing = opts.spacing ?? 2;
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const ymin = bb.min.y, ymax = bb.max.y;
    const bvh = new MeshBVH(geometry);

    // Dome centre: about 0.6 × distal radius above the distal end.
    const pos = geometry.attributes.position.array;
    let rs = 0, rc = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const y = pos[i + 1] - ymin;
      if (y > 25 && y < 40) { rs += Math.hypot(pos[i], pos[i + 2]); rc++; }
    }
    const rd = rc ? rs / rc : 30;
    const hc = ymin + THREE.MathUtils.clamp(rd * 0.6, 10, 45);

    const ray = new THREE.Ray();
    const farHit = (o, d) => {
      ray.origin.copy(o);
      ray.direction.copy(d);
      const hits = bvh.raycast(ray, THREE.DoubleSide);
      let best = -1;
      for (const h of hits) if (h.distance > best) best = h.distance;
      return best;
    };

    // Sample the columns every 1 mm to find the top of each column (cut plane).
    const step = 1;
    const nS = Math.max(2, Math.ceil((ymax - hc) / step) + 1);
    const samples = new Float32Array(nCols * nS).fill(NaN);
    const htop = new Float32Array(nCols);
    const rtop = new Float32Array(nCols);
    const o = new THREE.Vector3(), d = new THREE.Vector3(), p = new THREE.Vector3();
    for (let j = 0; j < nCols; j++) {
      const t = (2 * Math.PI * j) / nCols;
      d.set(Math.cos(t), 0, Math.sin(t));
      let last = -1, miss = 0, lastDist = 0, lastR = NaN;
      htop[j] = hc;
      rtop[j] = NaN;
      for (let k = 0; k < nS; k++) {
        const h = hc + k * step;
        o.set(0, h, 0);
        const r = farHit(o, d);
        if (r < 0) {
          miss++;
          if (last >= 0 && miss * step > 15) break;
          continue;
        }
        p.copy(d).multiplyScalar(r).add(o);
        const dist = keepPlane ? keepPlane.distanceToPoint(p) : -1;
        if (dist > 0) {
          if (last >= 0) {
            const f = lastDist / (lastDist - dist);
            const hl = hc + last * step;
            htop[j] = hl + f * (h - hl);
            rtop[j] = lastR + f * (r - lastR);
          }
          break;
        }
        miss = 0;
        samples[j * nS + k] = r;
        last = k; lastDist = dist; lastR = r;
        htop[j] = h; rtop[j] = r;
      }
      if (htop[j] < hc + 10) { htop[j] = hc + 10; rtop[j] = NaN; }
    }

    let maxTop = 0;
    for (let j = 0; j < nCols; j++) maxTop = Math.max(maxTop, htop[j]);
    const nCyl = Math.max(4, Math.ceil((maxTop - hc) / spacing));
    const surf = new GridSurface(nCols, nDome, nCyl, hc, htop);
    const r = surf.r.fill(NaN);

    // Cylindrical part: interpolate the samples.
    for (let a = nDome + 1; a <= surf.nRings; a++) {
      const b = a - nDome;
      for (let j = 0; j < nCols; j++) {
        const i = surf.idx(a, j);
        if (b === nCyl && !Number.isNaN(rtop[j])) { r[i] = rtop[j]; continue; }
        const h = hc + ((htop[j] - hc) * b) / nCyl;
        const u = (h - hc) / step;
        const k0 = Math.min(nS - 1, Math.floor(u));
        const k1 = Math.min(nS - 1, k0 + 1);
        const f = u - k0;
        const v0 = samples[j * nS + k0], v1 = samples[j * nS + k1];
        if (!Number.isNaN(v0) && !Number.isNaN(v1)) r[i] = v0 + (v1 - v0) * f;
        else if (!Number.isNaN(v0)) r[i] = v0;
        else if (!Number.isNaN(v1)) r[i] = v1;
      }
    }
    // Dome: rays from the centre C.
    for (let a = 0; a <= nDome; a++) {
      for (let j = 0; j < (a === 0 ? 1 : nCols); j++) {
        surf.ray(a, j, o, d);
        const h = farHit(o, d);
        if (h > 0) r[surf.idx(a, j)] = h;
      }
    }
    surf.fillHoles(r);
    surf.ymin = ymin;
    return surf;
  }

  /** Fills missing radii (holes in the scan) by averaging neighbours. */
  fillHoles(r) {
    const n = this.nCols, R = this.nRings;
    for (let pass = 0; pass < 400; pass++) {
      let missing = 0;
      const nr = Float32Array.from(r);
      for (let i = 0; i < this.nV; i++) {
        if (!Number.isNaN(r[i])) continue;
        missing++;
        const nb = [];
        if (i === 0) for (let j = 0; j < n; j++) nb.push(1 + j);
        else {
          const k = Math.floor((i - 1) / n) + 1, j = (i - 1) % n, base = 1 + (k - 1) * n;
          nb.push(base + ((j + n - 1) % n), base + ((j + 1) % n), k === 1 ? 0 : i - n);
          if (k < R) nb.push(i + n);
        }
        let s = 0, c = 0;
        for (const q of nb) if (!Number.isNaN(r[q])) { s += r[q]; c++; }
        if (c) nr[i] = s / c;
      }
      r.set(nr);
      if (!missing) break;
    }
    for (let i = 0; i < r.length; i++) if (Number.isNaN(r[i])) r[i] = 40;
  }
}
