/**
 * Closed trim line around the limb, defined in the unrolled space (s, h):
 *   s = θ · Rref (arc length in mm around the axis), h = height (mm).
 * Anchor points joined by cubic Bézier curves. Each anchor has in/out handles
 * (relative vectors in mm) and a mode:
 *   'auto'   : handles computed automatically (smooth curve)
 *   'smooth' : manual symmetric handles
 *   'corner' : manual independent handles (sharp corner possible)
 */
export class TrimCurve {
  constructor(Rref) {
    this.Rref = Rref;
    this.anchors = [];
  }

  get period() {
    return 2 * Math.PI * this.Rref;
  }

  wrap(s) {
    const P = this.period;
    return ((s % P) + P) % P;
  }

  sort() {
    for (const a of this.anchors) a.s = this.wrap(a.s);
    this.anchors.sort((a, b) => a.s - b.s);
  }

  add(s, h) {
    const a = { s: this.wrap(s), h, mode: 'auto', hin: { s: -10, h: 0 }, hout: { s: 10, h: 0 } };
    this.anchors.push(a);
    this.sort();
    this.updateAuto();
    return this.anchors.indexOf(a);
  }

  remove(i) {
    if (this.anchors.length <= 3) return false;
    this.anchors.splice(i, 1);
    this.updateAuto();
    return true;
  }

  /** Neighbours of an anchor, with s unwrapped around it. */
  neighbours(i) {
    const n = this.anchors.length, P = this.period;
    const a = this.anchors[i];
    const prev = this.anchors[(i - 1 + n) % n], next = this.anchors[(i + 1) % n];
    let ps = prev.s, ns = next.s;
    while (ps >= a.s) ps -= P;
    while (ns <= a.s) ns += P;
    return { prev: { s: ps, h: prev.h }, next: { s: ns, h: next.h } };
  }

  updateAuto() {
    const n = this.anchors.length;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const a = this.anchors[i];
      if (a.mode !== 'auto') continue;
      const { prev, next } = this.neighbours(i);
      let tx = next.s - prev.s, ty = next.h - prev.h;
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      const dn = Math.hypot(next.s - a.s, next.h - a.h) / 3;
      const dp = Math.hypot(a.s - prev.s, a.h - prev.h) / 3;
      a.hout = { s: tx * dn, h: ty * dn };
      a.hin = { s: -tx * dp, h: -ty * dp };
    }
  }

  /** Moves a handle (side = 'hin' | 'hout') to vector v, honouring the mode. */
  setHandle(i, side, v) {
    const a = this.anchors[i];
    if (a.mode === 'auto') a.mode = 'smooth';
    a[side] = { s: v.s, h: v.h };
    if (a.mode === 'smooth') {
      const other = side === 'hin' ? 'hout' : 'hin';
      const lo = Math.hypot(a[other].s, a[other].h);
      const l = Math.hypot(v.s, v.h) || 1;
      a[other] = { s: (-v.s / l) * lo, h: (-v.h / l) * lo };
    }
  }

  /** Bézier segments (s unwrapped, increasing over one turn). */
  segments() {
    const n = this.anchors.length, P = this.period;
    const segs = [];
    for (let i = 0; i < n; i++) {
      const a = this.anchors[i], b = this.anchors[(i + 1) % n];
      let bs = b.s;
      while (bs <= a.s) bs += P;
      segs.push([
        { s: a.s, h: a.h },
        { s: a.s + a.hout.s, h: a.h + a.hout.h },
        { s: bs + b.hin.s, h: b.h + b.hin.h },
        { s: bs, h: b.h },
      ]);
    }
    return segs;
  }

  sample(perSeg = 40) {
    const pts = [];
    for (const [p0, p1, p2, p3] of this.segments()) {
      for (let k = 0; k < perSeg; k++) {
        const t = k / perSeg, u = 1 - t;
        const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
        pts.push({
          s: b0 * p0.s + b1 * p1.s + b2 * p2.s + b3 * p3.s,
          h: b0 * p0.h + b1 * p1.h + b2 * p2.h + b3 * p3.h,
        });
      }
    }
    if (pts.length) pts.push({ s: pts[0].s + this.period, h: pts[0].h });
    return pts;
  }

  /** Function θ → trim height (lowest crossing if the curve folds back). */
  heightFunction() {
    const pts = this.sample(48);
    const P = this.period;
    const R = this.Rref;
    return (theta) => {
      let best = Infinity, nearest = Infinity, nearestH = pts.length ? pts[0].h : 0;
      for (let shift = -1; shift <= 1; shift++) {
        const s = this.wrap(theta * R) + shift * P;
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], b = pts[k + 1];
          const lo = Math.min(a.s, b.s), hi = Math.max(a.s, b.s);
          if (s >= lo && s <= hi) {
            const f = hi - lo < 1e-9 ? 0 : (s - a.s) / (b.s - a.s);
            best = Math.min(best, a.h + (b.h - a.h) * f);
          }
          const d = Math.abs(a.s - s);
          if (d < nearest) { nearest = d; nearestH = a.h; }
        }
      }
      return Number.isFinite(best) ? best : nearestH;
    };
  }

  toJSON() {
    return { Rref: this.Rref, anchors: this.anchors };
  }
}
