import * as THREE from 'three';
import { Viewer } from './viewer.js';
import { el } from './ui.js';
import { t } from './i18n.js';
import { gridNormals, centroidCurve, rectify, reductionFunction } from './geom/rectify.js';
import { buildInner } from './geom/socket.js';
import { GridSurface } from './geom/surface.js';
import { TrimCurve } from './geom/trimcurve.js';
import { heatColor, NEUTRAL_COLOR } from './geom/mesh-utils.js';

/** Shared application state and derived data (cached by version number). */
export class App {
  constructor() {
    this.viewer = new Viewer(document.getElementById('viewport'));
    this.panel = document.getElementById('panel');
    this.hintEl = document.getElementById('hint');
    this.legendEl = document.getElementById('legend');
    this.busyEl = document.getElementById('busy');

    this.ver = { surf: 0, smooth: 0, rect: 0, trim: 0 };
    this._cache = {};

    // Step 1
    this.raw = null; // scan geometry in the limb frame (before the axial rotation)
    this.rawName = '';
    this.yaw = 0; // rotation about the axis (°), applied when the working shape is generated
    this.cut = { height: 250, tiltX: 0, tiltZ: 0 };
    this.surf = null;
    this.rBase = null;
    this.smoothing = { iterations: 8, lambda: 0.5 };
    // Step 2
    this.rect = { sections: [], weights: null, relief: 0 };
    // Step 3
    this.trim = null;
    this.thickness = 5;
    // Step 4
    this.align = defaultAlign();

    this.shapeMesh = null;
    this.steps = [];
    this.current = -1;
  }

  // ---------- cache ----------
  memo(key, deps, fn) {
    const c = this._cache[key];
    if (c && c.deps.length === deps.length && c.deps.every((d, i) => d === deps[i])) return c.value;
    const value = fn();
    this._cache[key] = { deps, value };
    return value;
  }

  bump(...keys) {
    for (const k of keys) this.ver[k]++;
    this.refreshTabs();
  }

  base() {
    return this.memo('base', [this.ver.surf, this.ver.smooth], () => {
      const P0 = this.surf.positions(this.rBase);
      const N0 = gridNormals(this.surf, P0);
      return { P0, N0, centroidAt: centroidCurve(this.surf, P0) };
    });
  }

  rectified() {
    return this.memo('rect', [this.ver.surf, this.ver.smooth, this.ver.rect], () => {
      const { P0, N0, centroidAt } = this.base();
      return rectify(P0, N0, centroidAt, reductionFunction(this.rect.sections), this.rect.weights, this.rect.relief);
    });
  }

  inner() {
    return this.memo('inner', [this.ver.surf, this.ver.smooth, this.ver.rect, this.ver.trim], () => {
      this.ensureTrim();
      return buildInner(this.surf, this.rectified().P1, this.trim.heightFunction());
    });
  }

  /** Default (PTB-like) trim line when none exists. */
  ensureTrim() {
    if (this.trim && this.trim.anchors.length >= 3) return;
    const s = this.surf;
    const R = s.meanRadius(this.rBase);
    let top = Infinity;
    for (const h of s.htop) top = Math.min(top, h);
    const tc = new TrimCurve(R);
    const at = (deg, f) => tc.add((deg * Math.PI / 180) * R, s.hc + (top - 4 - s.hc) * f);
    at(90, 0.8); at(135, 0.88); at(180, 0.97); at(225, 0.82); at(270, 0.72); at(315, 0.82); at(0, 0.97); at(45, 0.88);
    this.trim = tc;
  }

  // ---------- shape mesh (grid) ----------
  ensureShapeMesh() {
    const s = this.surf;
    if (this.shapeMesh && this.shapeMesh.userData.nV === s.nV) return this.shapeMesh;
    if (this.shapeMesh) {
      this.viewer.scene.remove(this.shapeMesh);
      this.shapeMesh.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.nV * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(s.nV * 3), 3));
    g.setIndex(s.index());
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide }));
    m.userData.nV = s.nV;
    this.viewer.scene.add(m);
    this.shapeMesh = m;
    return m;
  }

  /** Updates the shape mesh. colorMode: 'neutral' | 'heat' | 'zones' */
  showShape(P, colorMode = 'neutral', disp = null) {
    const m = this.ensureShapeMesh();
    const g = m.geometry;
    g.attributes.position.array.set(P);
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    const col = g.attributes.color.array;
    const w = this.rect.weights;
    for (let v = 0; v < this.surf.nV; v++) {
      if (colorMode === 'neutral' || !disp) { col[3 * v] = NEUTRAL_COLOR[0]; col[3 * v + 1] = NEUTRAL_COLOR[1]; col[3 * v + 2] = NEUTRAL_COLOR[2]; }
      else heatColor(disp[v], col, 3 * v);
      if (colorMode === 'zones' && w && w[v] > 0) {
        const a = 0.75 * w[v];
        col[3 * v] += (0.18 - col[3 * v]) * a;
        col[3 * v + 1] += (0.82 - col[3 * v + 1]) * a;
        col[3 * v + 2] += (0.48 - col[3 * v + 2]) * a;
      }
    }
    g.attributes.color.needsUpdate = true;
    if (g.boundsTree) g.boundsTree.refit();
    else g.computeBoundsTree();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    m.visible = true;
  }

  // ---------- general UI ----------
  hint(text) {
    this.hintEl.innerHTML = text || '';
    this.hintEl.hidden = !text;
  }

  legend(show) {
    this.legendEl.hidden = !show;
  }

  async busy(msg, fn) {
    this.busyEl.querySelector('span').textContent = msg;
    this.busyEl.hidden = false;
    await new Promise((r) => setTimeout(r, 30));
    try {
      return await fn();
    } catch (e) {
      console.error(e);
      alert(t('Error: {msg}', { msg: e.message }));
    } finally {
      this.busyEl.hidden = true;
    }
  }

  registerSteps(steps) {
    this.steps = steps;
    const nav = document.getElementById('steps');
    nav.innerHTML = '';
    steps.forEach((s, i) => {
      s.tab = el('button', { class: 'tab', onClick: () => this.goTo(i) }, el('b', {}, String(i + 1)), s.title);
      nav.append(s.tab);
    });
    this.refreshTabs();
  }

  refreshTabs() {
    this.steps.forEach((s, i) => {
      s.tab.disabled = i > 0 && !this.surf;
      s.tab.classList.toggle('active', i === this.current);
    });
  }

  goTo(i) {
    if (i === this.current) return;
    if (i > 0 && !this.surf) return;
    if (this.current >= 0) this.steps[this.current].leave?.();
    this.viewer.setTool(null);
    this.hint('');
    this.legend(false);
    this.current = i;
    this.panel.innerHTML = '';
    this.panel.append(this.steps[i].panel);
    this.steps[i].enter?.();
    this.refreshTabs();
  }

  // ---------- project ----------
  serialize() {
    const s = this.surf;
    return {
      app: 'SocketDesigner', version: 1,
      surf: { nCols: s.nCols, nDome: s.nDome, nCyl: s.nCyl, hc: s.hc, ymin: s.ymin, htop: Array.from(s.htop), r: Array.from(s.r, (x) => +x.toFixed(3)) },
      cut: this.cut, smoothing: this.smoothing,
      rect: { sections: this.rect.sections, relief: this.rect.relief, weights: this.rect.weights ? Array.from(this.rect.weights, (x) => +x.toFixed(3)) : null },
      trim: this.trim ? this.trim.toJSON() : null,
      thickness: this.thickness,
      align: this.align,
    };
  }

  load(data) {
    if (data.app !== 'SocketDesigner') throw new Error(t('Invalid project file'));
    const d = data.surf;
    const s = new GridSurface(d.nCols, d.nDome, d.nCyl, d.hc, Float32Array.from(d.htop));
    s.r.set(d.r);
    s.ymin = d.ymin;
    this.surf = s;
    this.cut = data.cut;
    this.smoothing = data.smoothing;
    this.rBase = s.smoothR(s.r, this.smoothing.iterations, this.smoothing.lambda);
    this.rect = { sections: data.rect.sections, relief: data.rect.relief, weights: data.rect.weights ? Float32Array.from(data.rect.weights) : new Float32Array(s.nV) };
    if (data.trim) {
      this.trim = new TrimCurve(data.trim.Rref);
      this.trim.anchors = data.trim.anchors;
    } else this.trim = null;
    this.thickness = data.thickness;
    this.align = { ...defaultAlign(), ...data.align };
    this.bump('surf', 'smooth', 'rect', 'trim');
  }
}

export function defaultAlign() {
  return {
    side: 'right',
    footLength: 26, // cm
    heelHeight: 1, // cm
    sagZ: null, // mm from the heel (side-view vertical axis)
    frontX: 0, // mm from the foot axis (front-view vertical axis, + = lateral)
    pylonZ: null, // mm from the heel
    pylonX: 0, // mm, + = lateral
    condyle: null, // [[x,y,z],[x,y,z]] in the limb frame
    useCondyleYaw: true,
    flex: 5,
    abd: 0,
    rot: 0,
    ap: 0,
    ml: 0,
    height: null, // mm, floor → midpoint of the condyle axis
    adapterHeight: 45,
    plate: { gap: 15, thickness: 5, diameter: 68, blend: 40 },
    holes: { diameter: 6.5, spacing: 36, rotation: 0, nut: { enabled: true, size: 10.2, height: 6.5, z: 5 }, recess: { enabled: false, diameter: 30, depth: 8 } },
  };
}
