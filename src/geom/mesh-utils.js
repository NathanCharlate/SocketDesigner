import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Reads a scan file (STL, PLY, OBJ) and returns an indexed geometry (positions only). */
export function parseMeshFile(name, buffer) {
  const ext = name.split('.').pop().toLowerCase();
  let geom;
  if (ext === 'stl') geom = new STLLoader().parse(buffer);
  else if (ext === 'ply') geom = new PLYLoader().parse(buffer);
  else if (ext === 'obj') {
    const text = new TextDecoder().decode(buffer);
    const group = new OBJLoader().parse(text);
    const parts = [];
    group.traverse((o) => {
      if (o.isMesh) {
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        parts.push(stripToPosition(g));
      }
    });
    geom = mergeGeometries(parts);
  } else throw new Error(`Unsupported format: .${ext}`);
  return mergeVertices(stripToPosition(geom), 1e-4);
}

function stripToPosition(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  if (g.index) out.setIndex(g.index);
  return out;
}

/** Keeps only the largest connected component (removes isolated scan fragments). */
export function keepLargestComponent(geom) {
  const index = geom.index.array;
  const nV = geom.attributes.position.count;
  const parent = new Int32Array(nV);
  for (let i = 0; i < nV; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let t = 0; t < index.length; t += 3) {
    const a = find(index[t]), b = find(index[t + 1]), c = find(index[t + 2]);
    parent[b] = a;
    parent[find(c)] = a;
  }
  const count = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const r = find(index[t]);
    count.set(r, (count.get(r) || 0) + 1);
  }
  let best = -1, bestN = -1;
  for (const [r, n] of count) if (n > bestN) { best = r; bestN = n; }
  if (count.size <= 1) return geom;

  const pos = geom.attributes.position.array;
  const remap = new Int32Array(nV).fill(-1);
  const newPos = [];
  const newIdx = [];
  for (let t = 0; t < index.length; t += 3) {
    if (find(index[t]) !== best) continue;
    for (let k = 0; k < 3; k++) {
      const v = index[t + k];
      if (remap[v] < 0) {
        remap[v] = newPos.length / 3;
        newPos.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
      }
      newIdx.push(remap[v]);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  out.setIndex(newIdx);
  return out;
}

/**
 * Builds the index of a "tube" of rings of n vertices, with optional poles at the start and end.
 * Vertex layout: [start pole] ring0 … ringK-1 [end pole].
 */
export function tubeIndex(nRings, n, startPole, endPole) {
  const idx = [];
  const o = startPole ? 1 : 0;
  const ring = (k, j) => o + k * n + ((j + n) % n);
  if (startPole) for (let j = 0; j < n; j++) idx.push(0, ring(0, j), ring(0, j + 1));
  for (let k = 0; k < nRings - 1; k++) {
    for (let j = 0; j < n; j++) {
      const l0 = ring(k, j), l1 = ring(k, j + 1), u0 = ring(k + 1, j), u1 = ring(k + 1, j + 1);
      idx.push(l0, u0, u1, l0, u1, l1);
    }
  }
  if (endPole) {
    const e = o + nRings * n;
    for (let j = 0; j < n; j++) idx.push(ring(nRings - 1, j), e, ring(nRings - 1, j + 1));
  }
  return idx;
}

export function tubeGeometry(rings, n, startPole, endPole) {
  const nV = rings.length * n + (startPole ? 1 : 0) + (endPole ? 1 : 0);
  const pos = new Float32Array(nV * 3);
  let o = 0;
  if (startPole) { pos.set(startPole, 0); o = 3; }
  for (const r of rings) { pos.set(r, o); o += r.length; }
  if (endPole) pos.set(endPole, o);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(tubeIndex(rings.length, n, !!startPole, !!endPole));
  return g;
}

export function signedVolume(pos, index) {
  let v = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = 3 * index[t], b = 3 * index[t + 1], c = 3 * index[t + 2];
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
       - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
       + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}

/** Orients the faces of a closed mesh outwards. */
export function orientOutward(geom) {
  const idx = geom.index.array;
  if (signedVolume(geom.attributes.position.array, idx) < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
    geom.index.needsUpdate = true;
  }
  return geom;
}

const NEUTRAL = [0.84, 0.8, 0.74];
/** Displacement colour map (mm): red = compression, blue = relief. */
export function heatColor(d, out, o) {
  let r, g, b;
  if (d < 0) {
    const t = Math.min(1, -d / 8);
    if (t < 0.4) {
      const u = t / 0.4;
      r = NEUTRAL[0] + (0.98 - NEUTRAL[0]) * u; g = NEUTRAL[1] + (0.82 - NEUTRAL[1]) * u; b = NEUTRAL[2] + (0.3 - NEUTRAL[2]) * u;
    } else {
      const u = (t - 0.4) / 0.6;
      r = 0.98 + (0.82 - 0.98) * u; g = 0.82 + (0.14 - 0.82) * u; b = 0.3 + (0.12 - 0.3) * u;
    }
  } else {
    const t = Math.min(1, d / 4);
    r = NEUTRAL[0] + (0.25 - NEUTRAL[0]) * t; g = NEUTRAL[1] + (0.58 - NEUTRAL[1]) * t; b = NEUTRAL[2] + (0.95 - NEUTRAL[2]) * t;
  }
  out[o] = r; out[o + 1] = g; out[o + 2] = b;
}
export const NEUTRAL_COLOR = NEUTRAL;

/** Export frame: Y-up (scene) → Z-up (slicer). */
export const Y_UP_TO_Z_UP = new THREE.Matrix4().makeRotationX(Math.PI / 2);

export function downloadSTL(geometry, filename, matrix) {
  const g = geometry.clone();
  if (matrix) g.applyMatrix4(matrix);
  const mesh = new THREE.Mesh(g);
  const data = new STLExporter().parse(mesh, { binary: true });
  const blob = new Blob([data], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  g.dispose();
}

export { mergeVertices, mergeGeometries };
