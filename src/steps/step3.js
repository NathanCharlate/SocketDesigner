import * as THREE from 'three';
import { el, section, button, row, note, slider, checkbox, segmented, stat } from '../ui.js';
import { t } from '../i18n.js';
import { buildShell } from '../geom/socket.js';

export function createStep3(app) {
  const v = app.viewer;
  const group = new THREE.Group();
  group.visible = false;
  v.scene.add(group);

  const curveLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff5252, depthTest: true }));
  const curveLineBehind = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xff5252, transparent: true, opacity: 0.35, depthTest: false, dashSize: 3, gapSize: 3 }));
  curveLineBehind.renderOrder = 5;
  group.add(curveLine, curveLineBehind);
  const handlesGroup = new THREE.Group();
  group.add(handlesGroup);

  const shellMat = new THREE.MeshStandardMaterial({ color: 0x7fa6c9, roughness: 0.45, metalness: 0.05 });
  const shellMesh = new THREE.Mesh(new THREE.BufferGeometry(), shellMat);
  shellMesh.visible = false;
  group.add(shellMesh);

  const anchorGeo = new THREE.SphereGeometry(3.2, 20, 14);
  const handleGeo = new THREE.BoxGeometry(4, 4, 4);
  const matAnchor = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  const matAnchorSel = new THREE.MeshBasicMaterial({ color: 0xffd54f, depthTest: false });
  const matHandle = new THREE.MeshBasicMaterial({ color: 0xff8a80, depthTest: false });

  let selected = -1;
  let showHandles = true;
  let preview = false;
  let drag = null; // { type:'anchor'|'hin'|'hout', i }

  // ---------- panel ----------
  const thickS = slider({ label: t('Socket wall thickness'), min: 2, max: 10, step: 0.5, value: app.thickness, unit: 'mm', digits: 1, onInput: (x) => { app.thickness = x; if (preview) updateShell(); } });
  const selBox = el('div', { class: 'selbox' });
  const handlesToggle = checkbox(t('Show Bézier handles'), showHandles, (c) => { showHandles = c; buildGizmos(); });
  const previewToggle = checkbox(t('Socket preview (shell)'), preview, (c) => setPreview(c));
  const sMin = stat(t('Lowest point')), sMax = stat(t('Highest point'));

  const panel = el('div', { class: 'step' },
    el('h2', {}, t('Trim line')),
    section(t('Proximal trim line'),
      note(t('Click the shape to add a point. Drag the points (white) and handles (red) to shape the curve. Delete: remove the selected point.')),
      selBox,
      row(button(t('Default line'), () => { app.trim = null; app.ensureTrim(); selected = -1; changed(); }), button(t('Smooth all points'), () => { for (const a of app.trim.anchors) a.mode = 'auto'; app.trim.updateAuto(); changed(); })),
      handlesToggle.root,
      el('div', { class: 'stats' }, sMin.root, sMax.root)),
    section(t('Socket'), thickS.root, previewToggle.root,
      note(t('The thickness is applied outwards from the rectified positive. The proximal edge is rounded.'))),
  );

  // ---------- (s,h) ↔ 3D conversions ----------
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  function surfacePoint(s, h, out) {
    const surf = app.surf, n = surf.nCols;
    const { P1 } = app.rectified();
    const th = (((s / app.trim.Rref) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const u = (th / (2 * Math.PI)) * n;
    const j0 = Math.floor(u) % n, j1 = (j0 + 1) % n, f = u - Math.floor(u);
    const hh = Math.min(h, Math.min(surf.htop[j0], surf.htop[j1]));
    surf.pointAtHeight(P1, j0, hh, tmp);
    surf.pointAtHeight(P1, j1, hh, tmp2);
    out.copy(tmp).lerp(tmp2, f);
    out.y = h;
    // small radial offset so the curve stays visible above the surface
    const r = Math.hypot(out.x, out.z) || 1;
    out.x += (out.x / r) * 0.6;
    out.z += (out.z / r) * 0.6;
    return out;
  }

  function toSH(p) {
    const th = Math.atan2(p.z, p.x);
    return { s: app.trim.wrap(th * app.trim.Rref), h: p.y };
  }

  // ---------- curve rendering ----------
  function buildCurve() {
    const pts = app.trim.sample(48).map((q) => surfacePoint(q.s, q.h, new THREE.Vector3()));
    for (const l of [curveLine, curveLineBehind]) {
      l.geometry.dispose();
      l.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
    curveLineBehind.computeLineDistances();
    let mn = Infinity, mx = -Infinity;
    for (const p of pts) { mn = Math.min(mn, p.y); mx = Math.max(mx, p.y); }
    sMin.set(`${mn.toFixed(0)} mm`);
    sMax.set(`${mx.toFixed(0)} mm`);
  }

  function buildGizmos() {
    for (const c of [...handlesGroup.children]) { handlesGroup.remove(c); if (c.isLine) c.geometry.dispose(); }
    const A = app.trim.anchors;
    A.forEach((a, i) => {
      const m = new THREE.Mesh(anchorGeo, i === selected ? matAnchorSel : matAnchor);
      surfacePoint(a.s, a.h, m.position);
      m.userData = { type: 'anchor', i };
      m.renderOrder = 20;
      handlesGroup.add(m);
      if (!showHandles || (a.mode === 'auto' && i !== selected)) return;
      for (const side of ['hin', 'hout']) {
        const hpos = surfacePoint(a.s + a[side].s, a.h + a[side].h, new THREE.Vector3());
        const hm = new THREE.Mesh(handleGeo, matHandle);
        hm.position.copy(hpos);
        hm.userData = { type: side, i };
        hm.renderOrder = 20;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([m.position, hpos]), new THREE.LineBasicMaterial({ color: 0xff8a80, depthTest: false }));
        line.renderOrder = 19;
        handlesGroup.add(hm, line);
      }
    });
  }

  function buildSelBox() {
    selBox.innerHTML = '';
    const a = app.trim.anchors[selected];
    if (!a) {
      selBox.append(el('p', { class: 'muted' }, t('{n} points · none selected', { n: app.trim.anchors.length })));
      return;
    }
    const deg = ((a.s / app.trim.Rref) * 180) / Math.PI;
    const mode = segmented([['auto', t('Auto')], ['smooth', t('Smooth')], ['corner', t('Corner')]], a.mode, (m) => {
      a.mode = m;
      if (m === 'auto') app.trim.updateAuto();
      changed();
    });
    const hS = slider({ label: t('Point {n} — height', { n: selected + 1 }), min: 0, max: Math.ceil(Math.max(...app.surf.htop)), step: 1, value: Math.round(a.h), unit: 'mm', onInput: (x) => { a.h = x; app.trim.updateAuto(); changed(false); } });
    selBox.append(hS.root,
      el('div', { class: 'field' }, el('label', {}, t('Angular position: {deg}° · point type', { deg: deg.toFixed(0) })), mode.root),
      row(button(t('Delete point'), () => deleteSelected(), 'danger')));
  }

  let pendingFull = false, scheduled = false;
  function changed(full = true) {
    app.bump('trim');
    pendingFull ||= full;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      buildCurve();
      buildGizmos();
      if (pendingFull) buildSelBox();
      pendingFull = false;
      if (preview && !drag) updateShell();
    });
  }

  function deleteSelected() {
    if (selected < 0) return;
    if (!app.trim.remove(selected)) { alert(t('At least 3 points are required.')); return; }
    selected = -1;
    changed();
  }

  function updateShell() {
    const g = buildShell(app.inner(), app.thickness);
    shellMesh.geometry.dispose();
    shellMesh.geometry = g;
  }

  function setPreview(on) {
    preview = on;
    previewToggle.input.checked = on;
    if (on) updateShell();
    shellMesh.visible = on;
    if (app.shapeMesh) app.shapeMesh.visible = !on;
    curveLine.visible = curveLineBehind.visible = handlesGroup.visible = !on;
    v.setTool(on ? null : toolImpl);
    app.hint(on ? t('Shell preview · left click: rotate') : hintText);
  }

  // ---------- interaction ----------
  const hintText = t('Click: add a point · drag: move point/handle · right click: rotate · Delete: remove the point');
  const toolImpl = {
    cursor: 'crosshair',
    down(e) {
      const g = v.pick(e, handlesGroup.children.filter((c) => c.isMesh))[0];
      if (g) {
        drag = g.object.userData;
        if (drag.type === 'anchor' && selected !== drag.i) { selected = drag.i; buildSelBox(); buildGizmos(); }
        return true;
      }
      const hit = v.pick(e, [app.shapeMesh])[0];
      if (hit) {
        const { s, h } = toSH(hit.point);
        selected = app.trim.add(s, h);
        changed();
        drag = { type: 'anchor', i: selected };
        return true;
      }
      if (selected >= 0) { selected = -1; buildSelBox(); buildGizmos(); }
      return false;
    },
    drag(e) {
      if (!drag) return;
      const hit = v.pick(e, [app.shapeMesh])[0];
      if (!hit) return;
      const q = toSH(hit.point);
      const tr = app.trim;
      const a = tr.anchors[drag.i];
      if (drag.type === 'anchor') {
        a.s = q.s; a.h = q.h;
        tr.sort();
        drag.i = selected = tr.anchors.indexOf(a);
        tr.updateAuto();
      } else {
        let ds = q.s - a.s;
        const P = tr.period;
        if (ds > P / 2) ds -= P;
        if (ds < -P / 2) ds += P;
        tr.setHandle(drag.i, drag.type, { s: ds, h: q.h - a.h });
        tr.updateAuto();
      }
      changed(false);
    },
    up() {
      drag = null;
      changed(true);
    },
  };

  function onKey(e) {
    if (app.current !== 2 || preview) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLInputElement)) deleteSelected();
  }
  window.addEventListener('keydown', onKey);

  return {
    title: t('Trim line'),
    panel,
    enter() {
      group.visible = true;
      v.floor.visible = false;
      app.ensureTrim();
      const { P1, disp } = app.rectified();
      app.showShape(P1, 'heat', disp);
      app.legend(true);
      thickS.set(app.thickness);
      selected = -1;
      buildCurve();
      buildGizmos();
      buildSelBox();
      setPreview(preview);
    },
    leave() {
      group.visible = false;
      drag = null;
      if (app.shapeMesh) app.shapeMesh.visible = false;
    },
  };
}
