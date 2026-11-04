import fs from 'fs';
import * as THREE from 'three';
import { parseMeshFile, keepLargestComponent, signedVolume } from '../src/geom/mesh-utils.js';
import { GridSurface } from '../src/geom/surface.js';
import { gridNormals, centroidCurve, rectify, reductionFunction, closedVolume } from '../src/geom/rectify.js';
import { TrimCurve } from '../src/geom/trimcurve.js';
import { buildInner, buildShell, buildAlignedSocket, finalizeSocket } from '../src/geom/socket.js';
import { Foot } from '../src/geom/foot.js';

const t0 = performance.now();
const lap = (m) => console.log(m, (performance.now() - t0).toFixed(0) + 'ms');
const buf = fs.readFileSync(process.argv[2] ?? 'public/samples/sample-positive.stl');
let g = parseMeshFile('x.stl', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
g = keepLargestComponent(g); lap('parsed ' + g.index.count / 3);
g.rotateX(-Math.PI / 2); g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0);
const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 290, 0));
const surf = GridSurface.fromGeometry(g, plane); lap('grid');
console.log('nV', surf.nV, 'hc', surf.hc.toFixed(1), 'nCyl', surf.nCyl, 'htop', Math.min(...surf.htop).toFixed(1), Math.max(...surf.htop).toFixed(1));
const rB = surf.smoothR(surf.r, 8, 0.5);
const P0 = surf.positions(rB), N0 = gridNormals(surf, P0);
const cen = centroidCurve(surf, P0); lap('base');
const secs = [{ h: 20, pct: 0 }, { h: 100, pct: 3 }, { h: 180, pct: 5 }, { h: 260, pct: 4 }];
const w = new Float32Array(surf.nV);
const { P1, disp } = rectify(P0, N0, cen, reductionFunction(secs), w, 0); lap('rectify');
console.log('vol', closedVolume(surf, P0).toFixed(0), '->', closedVolume(surf, P1).toFixed(0), 'disp min', Math.min(...disp).toFixed(2));
for (const h of [20, 100, 180, 260]) { const a = surf.slice(P0, h), b = surf.slice(P1, h); console.log('h', h, a && (GridSurface.sliceStats(a).perimeter / 10).toFixed(1), b && (GridSurface.sliceStats(b).perimeter / 10).toFixed(1)); }
const R = surf.meanRadius(rB); const tc = new TrimCurve(R);
for (const [d, f] of [[90, .8], [180, .97], [270, .72], [0, .97]]) tc.add(d * Math.PI / 180 * R, surf.hc + (Math.min(...surf.htop) - 4 - surf.hc) * f);
const inner = buildInner(surf, P1, tc.heightFunction()); lap('inner rings ' + inner.rings.length);
const shell = buildShell(inner, 5); lap('shell');
console.log('shell vol cm3', (signedVolume(shell.attributes.position.array, shell.index.array) / 1000).toFixed(1));
const M = new THREE.Matrix4().makeTranslation(0, 450, 100).multiply(new THREE.Matrix4().makeRotationX(5 * Math.PI / 180)).multiply(new THREE.Matrix4().makeTranslation(0, -240, 0));
const al = buildAlignedSocket(inner, 5, M, { cx: 0, cz: 100, gap: 15, thickness: 5, diameter: 68, blend: 40 }); lap('aligned');
console.log('aligned vol', (signedVolume(al.geometry.attributes.position.array, al.geometry.index.array) / 1000).toFixed(1), 'plate', al.plate);
const fin = await finalizeSocket(al, { diameter: 6.5, spacing: 36, rotation: 0, nut: { enabled: true, size: 10.2, height: 6.5, z: 5 }, recess: { enabled: false } }); lap('csg');
const fp = fin.geometry.attributes.position.array; let fv = 0; for (let i = 0; i < fp.length; i += 9) fv += fp[i]*(fp[i+4]*fp[i+8]-fp[i+5]*fp[i+7]) - fp[i+1]*(fp[i+3]*fp[i+8]-fp[i+5]*fp[i+6]) + fp[i+2]*(fp[i+3]*fp[i+7]-fp[i+4]*fp[i+6]);
console.log('manifold vol', (fin.volume/1000).toFixed(2), fin.warnings);
const foot = new Foot(260, 10, 'right'); const fg = foot.geometry(); console.log('foot vol', (signedVolume(fg.attributes.position.array, fg.index.array) / 1000).toFixed(0), 'top@100', foot.topY(100).toFixed(0));
{
  const G = fin.geometry; console.log('index?', !!G.index, 'attrs', Object.keys(G.attributes), 'count', G.attributes.position.count, 'drawRange', G.drawRange, 'groups', G.groups.length);
  const nonIdx = G.index ? G.toNonIndexed() : G; const p = nonIdx.attributes.position.array;
  let vv = 0; for (let i = 0; i < p.length; i += 9) vv += p[i]*(p[i+4]*p[i+8]-p[i+5]*p[i+7]) - p[i+1]*(p[i+3]*p[i+8]-p[i+5]*p[i+6]) + p[i+2]*(p[i+3]*p[i+7]-p[i+4]*p[i+6]);
  console.log('final vol', (vv/6000).toFixed(2), 'tris', p.length/9);
  // open edges check
  const key = (i) => `${p[i].toFixed(3)},${p[i+1].toFixed(3)},${p[i+2].toFixed(3)}`;
  const edges = new Map();
  for (let t = 0; t < p.length; t += 9) { const k = [key(t), key(t+3), key(t+6)]; for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e+1)%3]; const id = a < b ? a + '|' + b : b + '|' + a; edges.set(id, (edges.get(id) || 0) + 1); } }
  let open = 0, nonman = 0; for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) nonman++; }
  console.log('edges', edges.size, 'open', open, 'nonmanifold', nonman);
}
function edgeStats(G, label) {
  const nonIdx = G.index ? G.toNonIndexed() : G; const p = nonIdx.attributes.position.array;
  const key = (i) => `${p[i].toFixed(4)},${p[i+1].toFixed(4)},${p[i+2].toFixed(4)}`;
  const edges = new Map(); let degen = 0;
  for (let t = 0; t < p.length; t += 9) { const k = [key(t), key(t+3), key(t+6)]; if (k[0]===k[1]||k[1]===k[2]||k[0]===k[2]) {degen++; continue;} for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e+1)%3]; const id = a < b ? a + '|' + b : b + '|' + a; edges.set(id, (edges.get(id) || 0) + 1); } }
  let open = 0, nonman = 0; for (const c of edges.values()) { if (c === 1) open++; else if (c > 2) nonman++; }
  console.log(label, 'tris', p.length/9, 'degen', degen, 'open', open, 'nonmanifold', nonman);
}
edgeStats(al.geometry, 'aligned');
edgeStats(shell, 'shell');
edgeStats(fin.geometry, 'final');
{
  const { Y_UP_TO_Z_UP } = await import('../src/geom/mesh-utils.js');
  const m = Y_UP_TO_Z_UP.clone().multiply(new THREE.Matrix4().makeTranslation(-al.plate.cx, -al.plate.yb, -al.plate.cz));
  const gg = fin.geometry.clone().applyMatrix4(m); gg.computeBoundingBox(); console.log('export bbox', gg.boundingBox.min.toArray().map(x=>x.toFixed(1)), gg.boundingBox.max.toArray().map(x=>x.toFixed(1)));
}
