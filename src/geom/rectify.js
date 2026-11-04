import * as THREE from 'three';
import { GridSurface } from './surface.js';

/**
 * Monotone (Fritsch-Carlson) interpolation of the reduction (%) between sections, constant beyond the ends.
 * Returns a function h → %.
 */
export function reductionFunction(sections) {
  const s = sections.filter((x) => Number.isFinite(x.h) && Number.isFinite(x.pct)).sort((a, b) => a.h - b.h);
  if (!s.length) return () => 0;
  if (s.length === 1) return () => s[0].pct;
  const n = s.length;
  const xs = s.map((x) => x.h), ys = s.map((x) => x.pct);
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(1e-6, xs[i + 1] - xs[i]));
    m.push((ys[i + 1] - ys[i]) / dx[i]);
  }
  const t = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return (h) => {
    if (h <= xs[0]) return ys[0];
    if (h >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (h > xs[i + 1]) i++;
    const u = (h - xs[i]) / dx[i], u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * dx[i] * t[i]
      + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * dx[i] * t[i + 1];
  };
}

/** Curve of section centroids (so each section is scaled about its own centre). */
export function centroidCurve(surf, P) {
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 1; i < P.length; i += 3) { ymin = Math.min(ymin, P[i]); ymax = Math.max(ymax, P[i]); }
  const step = 2;
  const hs = [], cx = [], cz = [];
  for (let h = ymin + 1; h <= ymax; h += step) {
    const S = surf.slice(P, h);
    if (!S) break;
    const st = GridSurface.sliceStats(S);
    hs.push(h); cx.push(st.cx); cz.push(st.cz);
  }
  if (!hs.length) return () => [0, 0];
  return (h) => {
    if (h <= hs[0]) return [cx[0], cz[0]];
    const last = hs.length - 1;
    if (h >= hs[last]) return [cx[last], cz[last]];
    const u = (h - hs[0]) / step;
    const i = Math.min(last - 1, Math.floor(u));
    const f = u - i;
    return [cx[i] + (cx[i + 1] - cx[i]) * f, cz[i] + (cz[i + 1] - cz[i]) * f];
  };
}

/**
 * Applies the reduction:
 *  - horizontal uniform scaling of each section about its centre by a factor (1 - p)
 *    (p = circumference reduction in %), attenuated by the zone weight w: factor 1 - p·(1 - w)
 *  - optional added material in zones (w · reliefMM along the normal)
 * Returns the rectified positions and the signed normal displacement (mm, negative = compression).
 */
export function rectify(P0, N0, centroidAt, pctAt, weights, reliefMM) {
  const nV = P0.length / 3;
  const P1 = new Float32Array(P0.length);
  const disp = new Float32Array(nV);
  for (let v = 0; v < nV; v++) {
    const x = P0[3 * v], y = P0[3 * v + 1], z = P0[3 * v + 2];
    const w = weights ? weights[v] : 0;
    const p = pctAt(y) / 100;
    const s = 1 - p * (1 - w);
    const [cx, cz] = centroidAt(y);
    const nx = N0[3 * v], ny = N0[3 * v + 1], nz = N0[3 * v + 2];
    const add = w * reliefMM;
    const X = cx + (x - cx) * s + nx * add;
    const Y = y + ny * add;
    const Z = cz + (z - cz) * s + nz * add;
    P1[3 * v] = X; P1[3 * v + 1] = Y; P1[3 * v + 2] = Z;
    disp[v] = (X - x) * nx + (Y - y) * ny + (Z - z) * nz;
  }
  return { P1, disp };
}

/** Vertex normals of a grid (pole + rings). */
export function gridNormals(surf, P) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(surf.index());
  g.computeVertexNormals();
  const N = g.attributes.normal.array;
  g.dispose();
  return N;
}

/** Volume (cm³) of the shape closed by a cap at the centre of the top ring. */
export function closedVolume(surf, P) {
  const idx = surf.index();
  const n = surf.nCols;
  const top = 1 + (surf.nRings - 1) * n;
  let cx = 0, cy = 0, cz = 0;
  for (let j = 0; j < n; j++) { cx += P[3 * (top + j)]; cy += P[3 * (top + j) + 1]; cz += P[3 * (top + j) + 2]; }
  cx /= n; cy /= n; cz /= n;
  const tri = (a, b, c) =>
    P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
    - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
    + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) v += tri(3 * idx[t], 3 * idx[t + 1], 3 * idx[t + 2]);
  // cap: fan (Lj, centre, Lj+1) closing the top ring
  const C = new Float32Array([cx, cy, cz]);
  for (let j = 0; j < n; j++) {
    const a = 3 * (top + j), b = 3 * (top + ((j + 1) % n));
    const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2];
    v += ax * (C[1] * bz - C[2] * by) - ay * (C[0] * bz - C[2] * bx) + az * (C[0] * by - C[1] * bx);
  }
  return Math.abs(v / 6) / 1000;
}
