import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { getManifold } from './manifold.js';
import { tubeGeometry, orientOutward } from './mesh-utils.js';

/**
 * Inner surface of the socket (limb frame): the rectified positive resampled so that the last ring
 * follows the trim line exactly.
 * The lower rings sit at uniform heights (same height for every column) so the distal cone can be
 * blended onto them; only the upper rings stretch up to the trim line.
 */
export function buildInner(surf, P1, trimAt, spacing = 2.5) {
  const n = surf.nCols;
  const hc = surf.hc;
  const ht = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const th = (2 * Math.PI * j) / n;
    ht[j] = Math.max(hc + 15, Math.min(trimAt(th), surf.htop[j]));
  }
  let minHt = Infinity, maxHt = -Infinity;
  for (const h of ht) { minHt = Math.min(minHt, h); maxHt = Math.max(maxHt, h); }
  const nLow = Math.max(1, Math.floor((minHt - 8 - hc) / spacing));
  const hLow = hc + nLow * spacing;
  const nUp = Math.max(2, Math.ceil((maxHt - hLow) / spacing));

  const rings = [];
  const ringHeight = []; // common height (uniform rings) or null
  for (let a = 1; a < surf.nDome; a++) {
    const ring = new Float32Array(3 * n);
    for (let j = 0; j < n; j++) {
      const i = surf.idx(a, j);
      ring[3 * j] = P1[3 * i]; ring[3 * j + 1] = P1[3 * i + 1]; ring[3 * j + 2] = P1[3 * i + 2];
    }
    rings.push(ring);
    ringHeight.push(null);
  }
  const firstUniform = rings.length;
  const v = new THREE.Vector3();
  const pushRing = (hOf, common) => {
    const ring = new Float32Array(3 * n);
    for (let j = 0; j < n; j++) {
      surf.pointAtHeight(P1, j, hOf(j), v);
      ring[3 * j] = v.x; ring[3 * j + 1] = v.y; ring[3 * j + 2] = v.z;
    }
    rings.push(ring);
    ringHeight.push(common);
  };
  for (let b = 0; b <= nLow; b++) {
    const h = hc + b * spacing;
    pushRing(() => h, h);
  }
  for (let u = 1; u <= nUp; u++) pushRing((j) => hLow + ((ht[j] - hLow) * u) / nUp, null);
  const pole = new Float32Array([P1[0], P1[1], P1[2]]);

  const g = tubeGeometry(rings, n, pole, null);
  g.computeVertexNormals();
  const normals = g.attributes.normal.array.slice();
  g.dispose();

  return {
    n, rings, pole, normals, ht, ringHeight, firstUniform, lastUniform: firstUniform + nLow, distalY: pole[1],
    ringAtHeight(h) {
      let best = firstUniform;
      for (let k = firstUniform; k <= firstUniform + nLow; k++) if (ringHeight[k] <= h) best = k;
      return best;
    },
  };
}

/** Rings of the outer surface (offset along the normals). */
export function outerRings(inner, t) {
  const { n, rings, pole, normals } = inner;
  const outer = rings.map((r, k) => {
    const o = new Float32Array(r.length);
    const base = 3 * (1 + k * n);
    for (let i = 0; i < r.length; i++) o[i] = r[i] + normals[base + i] * t;
    return o;
  });
  const outerPole = new Float32Array([pole[0] + normals[0] * t, pole[1] + normals[1] * t, pole[2] + normals[2] * t]);
  return { outer, outerPole };
}

/** Rounded proximal edge (half circle) between the inner ring and the outer ring. */
function rimRings(inTop, inPrev, outTop, steps = 8) {
  const n = inTop.length / 3;
  const res = [];
  for (let k = 1; k < steps; k++) res.push(new Float32Array(3 * n));
  for (let j = 0; j < n; j++) {
    const I = new THREE.Vector3().fromArray(inTop, 3 * j);
    const O = new THREE.Vector3().fromArray(outTop, 3 * j);
    const u = I.clone().sub(new THREE.Vector3().fromArray(inPrev, 3 * j)).normalize();
    const M = I.clone().add(O).multiplyScalar(0.5);
    const hv = O.clone().sub(I).multiplyScalar(0.5);
    const rad = hv.length();
    for (let k = 1; k < steps; k++) {
      const al = (Math.PI * k) / steps;
      const p = M.clone().addScaledVector(hv, -Math.cos(al)).addScaledVector(u, rad * Math.sin(al));
      p.toArray(res[k - 1], 3 * j);
    }
  }
  return res;
}

/** Plain shell (step 3 preview): inner surface + rounded rim + offset outer surface, rounded bottom. */
export function buildShell(inner, t) {
  const { n, rings, pole } = inner;
  const { outer, outerPole } = outerRings(inner, t);
  const last = rings.length - 1;
  const rim = rimRings(rings[last], rings[last - 1], outer[last]);
  const seq = [...rings, ...rim, ...outer.slice().reverse()];
  const g = orientOutward(tubeGeometry(seq, n, pole, outerPole));
  g.computeVertexNormals();
  return g;
}

function transformRing(r, M) {
  const o = new Float32Array(r.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < r.length; i += 3) {
    v.set(r[i], r[i + 1], r[i + 2]).applyMatrix4(M);
    o[i] = v.x; o[i + 1] = v.y; o[i + 2] = v.z;
  }
  return o;
}

/**
 * Aligned socket (world frame, Y up) with a horizontal distal plate centred on the pylon axis,
 * blended into the shell by a smooth (Hermite) cone.
 * plate = { cx, cz, gap, thickness, diameter, blend }
 */
export function buildAlignedSocket(inner, t, M, plate) {
  const { n } = inner;
  const { outer } = outerRings(inner, t);
  const innerW = inner.rings.map((r) => transformRing(r, M));
  const poleW = transformRing(inner.pole, M);
  const outerW = outer.map((r) => transformRing(r, M));

  let minY = poleW[1];
  for (const r of innerW) for (let i = 1; i < r.length; i += 3) minY = Math.min(minY, r[i]);
  const yb = minY - plate.gap;
  const yt = yb + plate.thickness;
  const R = plate.diameter / 2;

  const last = innerW.length - 1;
  const rim = rimRings(innerW[last], innerW[last - 1], outerW[last]);
  const kb = Math.min(inner.ringAtHeight(inner.distalY + plate.blend), outerW.length - 2);

  // Horizontal directions of the columns after rotation.
  const rot = new THREE.Matrix3().setFromMatrix4(M);
  const dirs = [];
  for (let j = 0; j < n; j++) {
    const th = (2 * Math.PI * j) / n;
    const d = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)).applyMatrix3(rot);
    d.y = 0;
    d.normalize();
    dirs.push(d);
  }

  const nL = 18;
  const loft = [];
  for (let i = 1; i <= nL; i++) loft.push(new Float32Array(3 * n));
  const plateBottom = new Float32Array(3 * n);
  const P0 = new THREE.Vector3(), Pa = new THREE.Vector3(), P1 = new THREE.Vector3(), T0 = new THREE.Vector3(), T1 = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let j = 0; j < n; j++) {
    P0.fromArray(outerW[kb], 3 * j);
    Pa.fromArray(outerW[kb + 1], 3 * j);
    P1.set(plate.cx + dirs[j].x * R, yt, plate.cz + dirs[j].z * R);
    const L = P0.distanceTo(P1);
    T0.copy(P0).sub(Pa).normalize().multiplyScalar(L * 0.9);
    T1.set(0, -L * 0.9, 0);
    for (let i = 1; i <= nL; i++) {
      const s = i / nL, s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      q.set(0, 0, 0).addScaledVector(P0, h00).addScaledVector(T0, h10).addScaledVector(P1, h01).addScaledVector(T1, h11);
      q.toArray(loft[i - 1], 3 * j);
    }
    plateBottom[3 * j] = P1.x; plateBottom[3 * j + 1] = yb; plateBottom[3 * j + 2] = P1.z;
  }

  const outerDown = [];
  for (let k = outerW.length - 1; k >= kb; k--) outerDown.push(outerW[k]);
  const seq = [...innerW, ...rim, ...outerDown, ...loft, plateBottom];
  const endPole = new Float32Array([plate.cx, yb, plate.cz]);
  const g = orientOutward(tubeGeometry(seq, n, poleW, endPole));
  g.computeVertexNormals();

  const innerGeom = tubeGeometry(innerW, n, poleW, null);
  return {
    geometry: g,
    innerGeometry: innerGeom,
    plate: { cx: plate.cx, cz: plate.cz, yb, yt, R },
    distalMinY: minY,
  };
}

/** Positions of the 4 holes (square pattern) in the world frame. */
export function holePositions(plate, holes) {
  const a = holes.spacing / 2;
  const rot = THREE.MathUtils.degToRad(holes.rotation || 0);
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[a, a], [-a, a], [-a, -a], [a, -a]].map(([x, z]) => [plate.cx + x * c - z * s, plate.cz + x * s + z * c]);
}

/**
 * Holes for the adapter, using robust booleans (manifold-3d → guaranteed watertight mesh):
 *  - 4 through holes up into the socket cavity
 *  - optional square nut pockets
 *  - optional central recess
 */
export async function finalizeSocket(aligned, holes) {
  const { Manifold, Mesh } = await getManifold();
  const { plate } = aligned;
  const g = aligned.geometry;
  const bvh = new MeshBVH(g);

  const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(g.attributes.position.array), triVerts: Uint32Array.from(g.index.array) });
  mesh.merge();
  const trash = [];
  const keep = (m) => (trash.push(m), m);
  let solid = keep(new Manifold(mesh));
  if (solid.status() !== 'NoError') throw new Error(`Socket mesh is not watertight (${solid.status()})`);

  const vertical = (m) => keep(m.rotate([-90, 0, 0])); // manifold's Z axis → scene Y axis
  const pts = holePositions(plate, holes);
  const ray = new THREE.Ray();
  const warnings = [];
  const cutters = [];
  for (const [x, z] of pts) {
    ray.origin.set(x, plate.yb - 5, z);
    ray.direction.set(0, 1, 0);
    const hits = bvh.raycast(ray, THREE.DoubleSide).sort((a, b) => a.distance - b.distance);
    let top;
    if (hits.length >= 2 && hits[1].distance < 80) top = plate.yb - 5 + hits[1].distance + 3;
    else {
      top = plate.yt + 15;
      if (!warnings.length) warnings.push('A hole does not open into the socket cavity (large offset?).');
    }
    const len = top - (plate.yb - 2);
    cutters.push(keep(vertical(keep(Manifold.cylinder(len, holes.diameter / 2, holes.diameter / 2, 40))).translate([x, plate.yb - 2, z])));
  }
  if (holes.nut?.enabled) {
    for (const [x, z] of pts) {
      const b = keep(Manifold.cube([holes.nut.size, holes.nut.height, holes.nut.size], true));
      cutters.push(keep(keep(b.rotate([0, -(holes.rotation || 0), 0])).translate([x, plate.yb + holes.nut.z + holes.nut.height / 2, z])));
    }
  }
  if (holes.recess?.enabled) {
    const c = vertical(keep(Manifold.cylinder(holes.recess.depth + 2, holes.recess.diameter / 2, holes.recess.diameter / 2, 64)));
    cutters.push(keep(c.translate([plate.cx, plate.yb - 2, plate.cz])));
  }
  for (const c of cutters) solid = keep(solid.subtract(c));

  const out = solid.getMesh();
  const res = new THREE.BufferGeometry();
  const np = out.numProp;
  const pos = new Float32Array((out.vertProperties.length / np) * 3);
  for (let i = 0, k = 0; i < out.vertProperties.length; i += np, k += 3) {
    pos[k] = out.vertProperties[i]; pos[k + 1] = out.vertProperties[i + 1]; pos[k + 2] = out.vertProperties[i + 2];
  }
  res.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  res.setIndex(new THREE.BufferAttribute(Uint32Array.from(out.triVerts), 1));
  res.computeVertexNormals();
  const volume = solid.volume();
  for (const m of trash) m.delete();
  return { geometry: res, warnings, volume };
}
