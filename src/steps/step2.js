import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { el, section, button, row, note, slider, checkbox, segmented, stat, numberInput } from '../ui.js';
import { t } from '../i18n.js';
import { GridSurface } from '../geom/surface.js';
import { reductionFunction, closedVolume } from '../geom/rectify.js';

const SECTION_COLORS = ['#ffb74d', '#4fc3f7', '#ba68c8', '#81c784', '#f06292', '#fff176', '#4db6ac', '#ff8a65', '#9fa8da'];

export function createStep2(app) {
  const v = app.viewer;
  const group = new THREE.Group();
  group.visible = false;
  v.scene.add(group);

  const ghost = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x9fb4c8, wireframe: true, transparent: true, opacity: 0.12 }));
  ghost.visible = false;
  group.add(ghost);

  const ringsGroup = new THREE.Group();
  group.add(ringsGroup);

  const brushRing = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2), Math.sin((i / 64) * Math.PI * 2), 0))),
    new THREE.LineBasicMaterial({ color: 0x2ee59d, depthTest: false, transparent: true }),
  );
  brushRing.renderOrder = 10;
  brushRing.visible = false;
  group.add(brushRing);

  const previewRing = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
  previewRing.visible = false;
  group.add(previewRing);

  let colorMode = 'heat';
  let tool = 'none'; // 'none' | 'paint' | 'erase' | 'place'
  const brush = { radius: 20, strength: 1 };

  // ---------- panel ----------
  const sectionList = el('div', { class: 'section-list' });
  const chart = el('div', { class: 'chart' });
  const toolSeg = segmented([['none', t('Orbit')], ['place', t('Place section')], ['paint', t('Paint zone')], ['erase', t('Erase')]], tool, (x) => setTool(x));
  const radiusS = slider({ label: t('Brush radius'), min: 4, max: 70, step: 1, value: brush.radius, unit: 'mm', onInput: (x) => { brush.radius = x; } });
  const strengthS = slider({ label: t('Protection (share of the reduction cancelled)'), min: 0, max: 100, step: 5, value: 100, unit: '%', onInput: (x) => { brush.strength = x / 100; } });
  const reliefS = slider({ label: t('Added material in zones'), min: 0, max: 6, step: 0.5, value: app.rect.relief, unit: 'mm', digits: 1, onInput: (x) => { app.rect.relief = x; changed(); } });
  const modeSeg = segmented([['heat', t('Displacement map')], ['zones', t('Zones')]], colorMode, (m) => { colorMode = m; refreshShape(); });
  const ghostToggle = checkbox(t('Overlay the shape before reduction'), false, (c) => { ghost.visible = c; });
  const sVol0 = stat(t('Initial volume')), sVol1 = stat(t('Rectified volume')), sDV = stat(t('Change'));

  const panel = el('div', { class: 'step' },
    el('h2', {}, t('Rectification')),
    section(t('Reduction sections'),
      note(t('Each cross-section gets a reduction as a % of its circumference. Between two sections the reduction is interpolated smoothly.')),
      el('div', { class: 'section-head' }, el('span', {}, ''), el('span', {}, t('Height')), el('span', {}, t('Reduction')), el('span', {}, t('Circumference')), el('span', {}, '')),
      sectionList,
      row(button(t('+ Add section'), () => addSection()), button(t('Place by clicking'), () => { toolSeg.set('place'); setTool('place'); })),
      chart),
    section(t('Relief zones'),
      note(t('Paint the areas where the reduction must not apply (or only partly): fibular head, tibial crest, distal end…')),
      toolSeg.root, radiusS.root, strengthS.root, reliefS.root,
      row(button(t('Clear all zones'), () => { app.rect.weights.fill(0); changed(); }, 'danger'))),
    section(t('Display'), modeSeg.root, ghostToggle.root,
      el('div', { class: 'stats' }, sVol0.root, sVol1.root, sDV.root)),
  );

  // ---------- sections ----------
  function sortedSections() {
    return app.rect.sections.map((s, i) => ({ ...s, i })).sort((a, b) => a.h - b.h);
  }

  function addSection(h) {
    const secs = app.rect.sections;
    if (h == null) {
      const top = Math.min(...app.surf.htop);
      const hs = secs.map((s) => s.h).sort((a, b) => a - b);
      // in the middle of the largest gap
      const pts = [0, ...hs, top];
      let best = 0, bi = 0;
      for (let i = 0; i < pts.length - 1; i++) if (pts[i + 1] - pts[i] > best) { best = pts[i + 1] - pts[i]; bi = i; }
      h = Math.round((pts[bi] + pts[bi + 1]) / 2);
    }
    const pct = +reductionFunction(secs)(h).toFixed(1);
    secs.push({ h: Math.round(h), pct });
    changed(true);
  }

  function buildList() {
    sectionList.innerHTML = '';
    const { P0 } = app.base();
    const { P1 } = app.rectified();
    sortedSections().forEach((s, k) => {
      const color = SECTION_COLORS[k % SECTION_COLORS.length];
      const S0 = app.surf.slice(P0, s.h), S1 = app.surf.slice(P1, s.h);
      const per = S0 && S1 ? `${(GridSurface.sliceStats(S0).perimeter / 10).toFixed(1)} → ${(GridSurface.sliceStats(S1).perimeter / 10).toFixed(1)} cm` : t('outside shape');
      sectionList.append(el('div', { class: 'section-row' },
        el('span', { class: 'swatch', style: `background:${color}` }, `S${k + 1}`),
        el('span', { class: 'cell' }, numberInput({ value: s.h, step: 1, min: 0, onChange: (x) => { app.rect.sections[s.i].h = x; changed(true); } }), el('small', {}, 'mm')),
        el('span', { class: 'cell' }, numberInput({ value: s.pct, step: 0.5, min: -10, max: 30, width: 56, onChange: (x) => { app.rect.sections[s.i].pct = x; changed(true); } }), el('small', {}, '%')),
        el('span', { class: 'per' }, per),
        el('button', { class: 'icon', title: t('Delete'), onClick: () => { app.rect.sections.splice(s.i, 1); changed(true); } }, '✕'),
      ));
    });
  }

  function buildChart() {
    const secs = sortedSections();
    const top = Math.min(...app.surf.htop);
    const f = reductionFunction(app.rect.sections);
    const W = 300, H = 150, pad = 26;
    let maxP = 6;
    for (const s of secs) maxP = Math.max(maxP, Math.ceil(s.pct + 1));
    const X = (p) => pad + (p / maxP) * (W - pad - 8);
    const Y = (h) => H - 14 - (h / top) * (H - 24);
    let d = '';
    for (let h = 0; h <= top; h += top / 80) d += `${d ? 'L' : 'M'}${X(Math.max(0, f(h))).toFixed(1)},${Y(h).toFixed(1)}`;
    const dots = secs.map((s, k) => `<circle cx="${X(s.pct)}" cy="${Y(s.h)}" r="4" fill="${SECTION_COLORS[k % SECTION_COLORS.length]}"/>`).join('');
    const ticks = [0, maxP / 2, maxP].map((p) => `<text x="${X(p)}" y="${H - 2}" text-anchor="middle">${p}%</text>`).join('');
    chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%">
      <line x1="${pad}" y1="${Y(0)}" x2="${pad}" y2="${Y(top)}" class="ax"/>
      <line x1="${pad}" y1="${Y(0)}" x2="${W - 8}" y2="${Y(0)}" class="ax"/>
      <text x="4" y="${Y(top) + 4}">${top.toFixed(0)}</text><text x="8" y="${Y(0)}">0</text>
      <path d="${d}" class="curve"/>${dots}${ticks}</svg>`;
  }

  function buildRings() {
    for (const c of [...ringsGroup.children]) {
      ringsGroup.remove(c);
      c.geometry?.dispose();
      c.traverse((o) => o.isCSS2DObject && o.element.remove());
    }
    const { P1 } = app.rectified();
    const n = app.surf.nCols;
    sortedSections().forEach((s, k) => {
      const S = app.surf.slice(P1, s.h);
      if (!S) return;
      const pts = [];
      for (let j = 0; j < n; j++) {
        const x = S[3 * j], z = S[3 * j + 2];
        const r = Math.hypot(x, z) || 1;
        pts.push(new THREE.Vector3(x + (x / r) * 0.8, s.h, z + (z / r) * 0.8));
      }
      const color = SECTION_COLORS[k % SECTION_COLORS.length];
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
      const lab = el('div', { class: 'label3d', style: `border-color:${color}` }, `S${k + 1} · ${s.pct}%`);
      const obj = new CSS2DObject(lab);
      const a = pts[Math.round(n / 4) % n];
      obj.position.set(a.x, a.y, a.z + 6);
      line.add(obj);
      ringsGroup.add(line);
    });
  }

  function refreshShape() {
    const { P1, disp } = app.rectified();
    app.showShape(P1, colorMode, disp);
    app.legend(colorMode === 'heat');
  }

  function updateStats() {
    const { P0 } = app.base();
    const { P1 } = app.rectified();
    const v0 = closedVolume(app.surf, P0), v1 = closedVolume(app.surf, P1);
    sVol0.set(`${v0.toFixed(0)} cm³`);
    sVol1.set(`${v1.toFixed(0)} cm³`);
    sDV.set(`${(((v1 - v0) / v0) * 100).toFixed(1)} %`);
  }

  let pending = false;
  function changed(full = false) {
    app.bump('rect');
    if (full) { buildList(); buildChart(); }
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      refreshShape();
      buildRings();
      if (!painting) { buildList(); updateStats(); }
    });
  }

  // ---------- tools ----------
  let painting = false;
  let lastBrush = null;
  const hitShape = (e) => app.viewer.pick(e, [app.shapeMesh])[0];

  function applyBrush(p) {
    const { P1 } = app.rectified();
    const w = app.rect.weights;
    const R = brush.radius, R2 = R * R;
    for (let i = 0; i < w.length; i++) {
      const dx = P1[3 * i] - p.x, dy = P1[3 * i + 1] - p.y, dz = P1[3 * i + 2] - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2) continue;
      const f = (1 - d2 / R2) ** 2;
      if (tool === 'paint') w[i] = Math.max(w[i], brush.strength * f);
      else w[i] *= 1 - f;
    }
    changed();
  }

  function showBrush(hit) {
    if (!hit) { brushRing.visible = false; return; }
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    brushRing.position.copy(hit.point).addScaledVector(n, 0.5);
    brushRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    brushRing.scale.setScalar(brush.radius);
    brushRing.material.color.set(tool === 'erase' ? 0xff6b6b : 0x2ee59d);
    brushRing.visible = true;
  }

  function showPreviewRing(h) {
    const S = h != null && app.surf.slice(app.rectified().P1, h);
    if (!S) { previewRing.visible = false; return; }
    previewRing.geometry.dispose();
    previewRing.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(S, 3));
    previewRing.visible = true;
  }

  const toolImpl = {
    cursor: 'crosshair',
    down(e) {
      const hit = hitShape(e);
      if (!hit) return false;
      if (tool === 'place') {
        addSection(hit.point.y);
        previewRing.visible = false;
        return false;
      }
      painting = true;
      lastBrush = hit.point.clone();
      applyBrush(hit.point);
      return true;
    },
    drag(e) {
      const hit = hitShape(e);
      showBrush(hit);
      if (!hit) return;
      // continuous stroke: intermediate points between two mouse events
      const d = lastBrush ? lastBrush.distanceTo(hit.point) : 0;
      const step = brush.radius / 3;
      if (d > step && d < brush.radius * 6) {
        const n = Math.ceil(d / step);
        for (let k = 1; k < n; k++) applyBrush(lastBrush.clone().lerp(hit.point, k / n));
      }
      applyBrush(hit.point);
      lastBrush = hit.point.clone();
    },
    up() {
      painting = false;
      lastBrush = null;
      changed(true);
      updateStats();
    },
    hover(e) {
      const hit = hitShape(e);
      if (tool === 'place') showPreviewRing(hit?.point.y);
      else showBrush(hit);
    },
    leave() {
      brushRing.visible = false;
      previewRing.visible = false;
    },
  };

  function setTool(next) {
    tool = next;
    brushRing.visible = false;
    previewRing.visible = false;
    if (next === 'none') {
      v.setTool(null);
      app.hint(t('Left click: rotate · right click: pan · wheel: zoom'));
    } else {
      v.setTool(toolImpl);
      if (next === 'paint' || next === 'erase') { colorMode = 'zones'; modeSeg.set('zones'); refreshShape(); }
      app.hint(next === 'place'
        ? t('Click the shape to add a section at that height · right click: rotate')
        : t('Left drag: paint · right click: rotate · middle click: pan'));
    }
  }

  return {
    title: t('Rectification'),
    panel,
    enter() {
      group.visible = true;
      v.floor.visible = false;
      if (!app.rect.weights || app.rect.weights.length !== app.surf.nV) app.rect.weights = new Float32Array(app.surf.nV);
      const { P0 } = app.base();
      ghost.geometry.dispose();
      ghost.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(P0, 3)).setIndex(app.surf.index());
      reliefS.set(app.rect.relief);
      toolSeg.set('none');
      setTool('none');
      refreshShape();
      buildList();
      buildChart();
      buildRings();
      updateStats();
    },
    leave() {
      group.visible = false;
      ringsGroup.traverse((o) => o.isCSS2DObject && (o.element.style.display = 'none'));
      for (const c of [...ringsGroup.children]) {
        ringsGroup.remove(c);
        c.traverse((o) => o.isCSS2DObject && o.element.remove());
      }
      if (app.shapeMesh) app.shapeMesh.visible = false;
      app.legend(false);
    },
  };
}
