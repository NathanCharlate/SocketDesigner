import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { el, section, button, row, note, slider, checkbox, segmented, stat, numberInput } from '../ui.js';
import { t, numberLocale } from '../i18n.js';
import { buildAlignedSocket, finalizeSocket, holePositions } from '../geom/socket.js';
import { Foot } from '../geom/foot.js';
import { downloadSTL, Y_UP_TO_Z_UP } from '../geom/mesh-utils.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;

export function createStep4(app) {
  const v = app.viewer;
  const A = () => app.align;
  const sideSign = () => (A().side === 'left' ? 1 : -1); // sign of X on the lateral side

  const group = new THREE.Group();
  group.visible = false;
  v.scene.add(group);

  const footMat = new THREE.MeshStandardMaterial({ color: 0xd9c3a5, roughness: 0.8 });
  const footMesh = new THREE.Mesh(new THREE.BufferGeometry(), footMat);
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.75, roughness: 0.32 });
  const pyramid = new THREE.Mesh(new THREE.CylinderGeometry(14, 20, 12, 4).rotateY(Math.PI / 4), metal);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 1, 40), metal);
  const adapter = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48), new THREE.MeshStandardMaterial({ color: 0x8d96a0, metalness: 0.7, roughness: 0.35 }));
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x7fa6c9, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide });
  const socketMesh = new THREE.Mesh(new THREE.BufferGeometry(), socketMat);
  group.add(footMesh, pyramid, tube, adapter, socketMesh);

  // Reference planes / axes
  const mkPlane = (color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    const edge = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, depthTest: false }));
    edge.renderOrder = 8;
    const g = new THREE.Group();
    g.add(m, edge);
    g.userData = { plane: m, edge };
    return g;
  };
  const sagRef = mkPlane(0xff5d5d);
  const frontRef = mkPlane(0x4fa3ff);
  const sagFootPt = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff5d5d, depthTest: false }));
  const frontFootPt = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4fa3ff, depthTest: false }));
  sagFootPt.renderOrder = frontFootPt.renderOrder = 9;
  group.add(sagRef, frontRef, sagFootPt, frontFootPt);

  // Condyle axis
  const condGroup = new THREE.Group();
  const condMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, depthTest: false });
  const condA = new THREE.Mesh(new THREE.SphereGeometry(3.5, 16, 12), condMat);
  const condB = condA.clone();
  const condMid = new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  const condLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd54f, depthTest: false }));
  for (const o of [condA, condB, condMid, condLine]) o.renderOrder = 12;
  condGroup.add(condA, condB, condMid, condLine);
  group.add(condGroup);
  const condLabel = new CSS2DObject(el('div', { class: 'label3d' }, t('Condyle axis')));
  condMid.add(condLabel);
  condLabel.visible = false;

  let tool = 'none';
  let pendingCond = null;
  let finalGeom = null;
  let aligned = null;

  // ---------- panel ----------
  const sideSeg = segmented([['right', t('Right')], ['left', t('Left')]], A().side, (s) => { A().side = s; rebuildFoot(); update(); });
  const lenS = slider({ label: t('Foot length'), min: 18, max: 32, step: 0.5, value: A().footLength, unit: 'cm', digits: 1, onInput: (x) => { A().footLength = x; rebuildFoot(); update(); } });
  const heelS = slider({ label: t('Heel height'), min: 0, max: 5, step: 0.1, value: A().heelHeight, unit: 'cm', digits: 1, onInput: (x) => { A().heelHeight = x; rebuildFoot(); update(); } });
  const sagS = slider({ label: t('Side-view vertical axis (from the heel)'), min: 0, max: 320, step: 1, value: 100, unit: 'mm', onInput: (x) => { A().sagZ = x; update(); } });
  const frontS = slider({ label: t('Front-view vertical axis (+ lateral)'), min: -60, max: 60, step: 1, value: A().frontX, unit: 'mm', onInput: (x) => { A().frontX = x; update(); } });
  const pylZS = slider({ label: t('Pylon: position from the heel'), min: 0, max: 320, step: 1, value: 100, unit: 'mm', onInput: (x) => { A().pylonZ = x; update(); } });
  const pylXS = slider({ label: t('Pylon: offset (+ lateral)'), min: -40, max: 40, step: 1, value: A().pylonX, unit: 'mm', onInput: (x) => { A().pylonX = x; update(); } });
  const toolSeg = segmented([['none', t('Orbit')], ['sag', t('Side pt.')], ['front', t('Front pt.')], ['pylon', t('Pylon')], ['condyle', t('Condyles')]], tool, (x) => setTool(x));

  const flexS = slider({ label: t('Flexion (+) / extension (−)'), min: -10, max: 25, step: 0.5, value: A().flex, unit: '°', digits: 1, onInput: (x) => { A().flex = x; update(); } });
  const abdS = slider({ label: t('Abduction (+) / adduction (−)'), min: -15, max: 15, step: 0.5, value: A().abd, unit: '°', digits: 1, onInput: (x) => { A().abd = x; update(); } });
  const rotS = slider({ label: t('External (+) / internal (−) rotation'), min: -30, max: 30, step: 0.5, value: A().rot, unit: '°', digits: 1, onInput: (x) => { A().rot = x; update(); } });
  const apS = slider({ label: t('Antero-posterior shift (+ anterior)'), min: -60, max: 60, step: 0.5, value: A().ap, unit: 'mm', digits: 1, onInput: (x) => { A().ap = x; update(); } });
  const mlS = slider({ label: t('Medio-lateral shift (+ lateral)'), min: -60, max: 60, step: 0.5, value: A().ml, unit: 'mm', digits: 1, onInput: (x) => { A().ml = x; update(); } });
  const hS = slider({ label: t('Floor → condyle axis height'), min: 200, max: 700, step: 1, value: 450, unit: 'mm', onInput: (x) => { A().height = x; update(); } });
  const yawToggle = checkbox(t('Orient the condyle axis perpendicular to the line of progression'), A().useCondyleYaw, (c) => { A().useCondyleYaw = c; update(); });

  const P = () => A().plate, Hh = () => A().holes;
  const gapS = slider({ label: t('Distal end → underside of the plate'), min: 8, max: 40, step: 0.5, value: P().gap, unit: 'mm', digits: 1, onInput: (x) => { P().gap = x; update(); } });
  const plDS = slider({ label: t('Plate diameter'), min: 50, max: 90, step: 1, value: P().diameter, unit: 'mm', onInput: (x) => { P().diameter = x; update(); } });
  const plTS = slider({ label: t('Plate thickness (straight part)'), min: 2, max: 15, step: 0.5, value: P().thickness, unit: 'mm', digits: 1, onInput: (x) => { P().thickness = x; update(); } });
  const blS = slider({ label: t('Cone blend height'), min: 15, max: 90, step: 1, value: P().blend, unit: 'mm', onInput: (x) => { P().blend = x; update(); } });
  const adS = slider({ label: t('4R54 + adapters height'), min: 20, max: 120, step: 1, value: A().adapterHeight, unit: 'mm', onInput: (x) => { A().adapterHeight = x; update(); } });

  const holeD = numberInput({ value: Hh().diameter, step: 0.1, min: 3, max: 12, onChange: (x) => { Hh().diameter = x; invalidateFinal(); } });
  const holeSp = numberInput({ value: Hh().spacing, step: 0.5, min: 20, max: 60, onChange: (x) => { Hh().spacing = x; update(); } });
  const holeRot = numberInput({ value: Hh().rotation, step: 1, min: -90, max: 90, onChange: (x) => { Hh().rotation = x; update(); } });
  const nutT = checkbox(t('Square nut pockets (print pause)'), Hh().nut.enabled, (c) => { Hh().nut.enabled = c; invalidateFinal(); });
  const nutS = numberInput({ value: Hh().nut.size, step: 0.1, onChange: (x) => { Hh().nut.size = x; invalidateFinal(); } });
  const nutH = numberInput({ value: Hh().nut.height, step: 0.1, onChange: (x) => { Hh().nut.height = x; invalidateFinal(); } });
  const nutZ = numberInput({ value: Hh().nut.z, step: 0.5, onChange: (x) => { Hh().nut.z = x; invalidateFinal(); } });
  const recT = checkbox(t('Central recess'), Hh().recess.enabled, (c) => { Hh().recess.enabled = c; invalidateFinal(); });
  const recD = numberInput({ value: Hh().recess.diameter, step: 1, onChange: (x) => { Hh().recess.diameter = x; invalidateFinal(); } });
  const recP = numberInput({ value: Hh().recess.depth, step: 0.5, onChange: (x) => { Hh().recess.depth = x; invalidateFinal(); } });

  const sTube = stat(t('Tube length')), sOff = stat(t('Distal end / pylon')), sThick = stat(t('Material under the limb')), sCond = stat(t('Condyle axis (frontal)'));
  const condStatus = el('p', { class: 'note' });
  const finalStatus = el('p', { class: 'note' });
  const genBtn = button(t('Generate final socket'), () => generateFinal(), 'primary wide');
  const dlBtn = button(t('Download STL'), () => exportSocket(), 'wide');

  const panel = el('div', { class: 'step' },
    el('h2', {}, t('Alignment')),
    section(t('Foot'), el('div', { class: 'field' }, el('label', {}, t('Side')), sideSeg.root), lenS.root, heelS.root),
    section(t('Reference axes'),
      note(t('Pick a tool then click the foot (side view for the sagittal axis, front view for the frontal axis), or set the values.')),
      toolSeg.root, sagS.root, frontS.root, pylZS.root, pylXS.root),
    section(t('Condyle axis'),
      note(t('"Condyles" tool: click a medial point then a lateral point on the socket. The midpoint of the axis is placed on both vertical axes.')),
      condStatus,
      row(button(t('Define (2 clicks)'), () => { toolSeg.set('condyle'); setTool('condyle'); }), button(t('Clear'), () => { A().condyle = null; update(); }, 'danger')),
      yawToggle.root),
    section(t('Socket position'),
      row(button(t('Align to axes'), () => autoAlign(), 'primary'), button(t('Side view'), () => sideView()), button(t('Front view'), () => frontView())),
      flexS.root, abdS.root, rotS.root, apS.root, mlS.root, hS.root,
      el('div', { class: 'stats' }, sTube.root, sOff.root, sThick.root, sCond.root)),
    section(t('Distal connection — Ottobock 4R54'),
      gapS.root, plDS.root, plTS.root, blS.root, adS.root,
      el('div', { class: 'grid2' },
        el('label', {}, t('Hole Ø (mm)')), holeD,
        el('label', {}, t('Square spacing (mm)')), holeSp,
        el('label', {}, t('Pattern rotation (°)')), holeRot),
      nutT.root,
      el('div', { class: 'grid2' },
        el('label', {}, t('Nut: width (mm)')), nutS,
        el('label', {}, t('Nut: height (mm)')), nutH,
        el('label', {}, t('Nut: from the underside (mm)')), nutZ),
      recT.root,
      el('div', { class: 'grid2' }, el('label', {}, t('Recess Ø (mm)')), recD, el('label', {}, t('Recess depth (mm)')), recP),
      note(t('Default values measured on a reference socket (4 holes Ø6.5 on a 36 mm square, M6 square nuts). Check them against the 4R54 instructions for use.'))),
    section(t('Export'), genBtn, dlBtn, finalStatus),
  );

  // ---------- geometry ----------
  let foot = null;
  function rebuildFoot() {
    const a = A();
    foot = new Foot(a.footLength * 10, a.heelHeight * 10, a.side);
    footMesh.geometry.dispose();
    footMesh.geometry = foot.geometry();
    const L = a.footLength * 10;
    sagS.setRange(0, Math.round(L));
    pylZS.setRange(0, Math.round(L));
  }

  function condyleLimb() {
    const c = A().condyle;
    if (!c) return null;
    const a = new THREE.Vector3(...c[0]), b = new THREE.Vector3(...c[1]);
    return { a, b, mid: a.clone().add(b).multiplyScalar(0.5) };
  }

  function pivotLimb() {
    const c = condyleLimb();
    if (c) return c.mid;
    const top = Math.min(...app.surf.htop);
    return new THREE.Vector3(0, top * 0.85, 0);
  }

  function socketMatrix() {
    const a = A(), sg = sideSign();
    const c = condyleLimb();
    let yaw = sg * a.rot * DEG;
    if (c && a.useCondyleYaw) {
      const d = c.b.clone().sub(c.a);
      yaw += Math.atan2(d.z, d.x);
      // keep the same overall orientation (front = +Z)
      if (Math.cos(Math.atan2(d.z, d.x)) < 0) yaw += Math.PI;
    }
    const piv = pivotLimb();
    const target = new THREE.Vector3(sg * (a.frontX + a.ml), a.height, a.sagZ + a.ap);
    return new THREE.Matrix4().makeTranslation(target.x, target.y, target.z)
      .multiply(new THREE.Matrix4().makeRotationX(a.flex * DEG))
      .multiply(new THREE.Matrix4().makeRotationZ(sg * a.abd * DEG))
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeTranslation(-piv.x, -piv.y, -piv.z));
  }

  function plateParams() {
    const a = A();
    return { ...a.plate, cx: sideSign() * a.pylonX, cz: a.pylonZ };
  }

  function computeAligned() {
    ensureDefaults();
    return buildAlignedSocket(app.inner(), app.thickness, socketMatrix(), plateParams());
  }

  function footTopAtPylon() {
    return foot.topY(A().pylonZ) + 12;
  }

  function ensureDefaults() {
    const a = A();
    if (!foot) rebuildFoot();
    const L = a.footLength * 10;
    if (a.sagZ == null) a.sagZ = Math.round(L / 2 - 30);
    if (a.pylonZ == null) a.pylonZ = a.sagZ;
    if (a.height == null) {
      a.height = 0;
      const tmp = buildAlignedSocket(app.inner(), app.thickness, socketMatrix(), plateParams());
      const wantYb = footTopAtPylon() + 120 + a.adapterHeight;
      a.height = Math.round(wantYb - tmp.plate.yb);
    }
  }

  function syncSliders() {
    const a = A();
    sideSeg.set(a.side);
    lenS.set(a.footLength); heelS.set(a.heelHeight);
    sagS.set(a.sagZ); frontS.set(a.frontX); pylZS.set(a.pylonZ); pylXS.set(a.pylonX);
    flexS.set(a.flex); abdS.set(a.abd); rotS.set(a.rot); apS.set(a.ap); mlS.set(a.ml); hS.set(a.height);
    yawToggle.input.checked = a.useCondyleYaw;
    gapS.set(a.plate.gap); plDS.set(a.plate.diameter); plTS.set(a.plate.thickness); blS.set(a.plate.blend); adS.set(a.adapterHeight);
  }

  let scheduled = false;
  function update() {
    invalidateFinal();
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      rebuild();
    });
  }

  function invalidateFinal() {
    if (finalGeom) { finalGeom.dispose(); finalGeom = null; }
    finalStatus.textContent = t('Preview without holes. Click "Generate" to compute the mounting holes.');
    dlBtn.disabled = false;
  }

  function rebuild() {
    ensureDefaults();
    const a = A(), sg = sideSign();
    const M = socketMatrix();
    aligned = buildAlignedSocket(app.inner(), app.thickness, M, plateParams());
    socketMesh.geometry.dispose();
    socketMesh.geometry = aligned.geometry;
    socketMesh.geometry.computeBoundsTree();
    socketMesh.visible = true;

    const L = a.footLength * 10;
    const { cx, cz, yb } = aligned.plate;
    const fy = foot.topY(a.pylonZ);
    pyramid.position.set(cx, fy + 6, cz);
    const tubeBottom = fy + 12, tubeTop = yb - a.adapterHeight;
    const tl = tubeTop - tubeBottom;
    tube.visible = tl > 1;
    tube.scale.set(1, Math.max(1, tl), 1);
    tube.position.set(cx, tubeBottom + tl / 2, cz);
    adapter.scale.set(a.plate.diameter / 2 - 4, a.adapterHeight, a.plate.diameter / 2 - 4);
    adapter.position.set(cx, yb - a.adapterHeight / 2, cz);
    adapter.geometry.dispose();
    adapter.geometry = new THREE.CylinderGeometry(1, 0.55, 1, 48);
    sTube.set(tl > 0 ? `${tl.toFixed(0)} mm` : `${tl.toFixed(0)} mm ⚠`);
    sTube.root.classList.toggle('warn', tl < 20);

    // Reference planes
    const H = Math.max(900, a.height + 200);
    const xf = sg * a.frontX;
    const setPlane = (g, w, h, pos, rotY, x0, x1, axis) => {
      g.userData.plane.scale.set(w, h, 1);
      g.userData.plane.position.copy(pos);
      g.userData.plane.rotation.set(0, rotY, 0);
      const pts = axis === 'z'
        ? [new THREE.Vector3(x0, 0, a.sagZ), new THREE.Vector3(x0, H, a.sagZ)]
        : [new THREE.Vector3(xf, 0, x0), new THREE.Vector3(xf, H, x0)];
      g.userData.edge.geometry.dispose();
      g.userData.edge.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    };
    setPlane(sagRef, 260, H, new THREE.Vector3(0, H / 2, a.sagZ), 0, xf, 0, 'z');
    setPlane(frontRef, L + 160, H, new THREE.Vector3(xf, H / 2, L / 2), Math.PI / 2, a.sagZ, 0, 'x');
    sagFootPt.position.set(foot.centerX(a.sagZ / L), foot.topY(a.sagZ), a.sagZ);
    frontFootPt.position.set(xf, foot.topY(a.sagZ), a.sagZ);
    applyViewVisibility();

    // Condyles
    const c = condyleLimb();
    condGroup.visible = !!c || !!pendingCond;
    if (c) {
      const wa = c.a.clone().applyMatrix4(M), wb = c.b.clone().applyMatrix4(M), wm = c.mid.clone().applyMatrix4(M);
      condA.position.copy(wa); condB.position.copy(wb); condMid.position.copy(wm);
      condB.visible = condMid.visible = true;
      const dir = wb.clone().sub(wa).normalize();
      condLine.geometry.dispose();
      condLine.geometry = new THREE.BufferGeometry().setFromPoints([wa.clone().addScaledVector(dir, -40), wb.clone().addScaledVector(dir, 40)]);
      const ang = Math.atan2(wb.y - wa.y, Math.abs(wb.x - wa.x)) / DEG;
      sCond.set(t('{deg}° tilt', { deg: Math.abs(ang).toFixed(1) }));
      condStatus.textContent = t('Axis defined · width {w} mm · midpoint {h} mm above the distal end.', { w: c.a.distanceTo(c.b).toFixed(0), h: c.mid.y.toFixed(0) });
    } else {
      sCond.set('—');
      condStatus.textContent = pendingCond ? t('Click the second point…') : t('Axis not defined: the pivot defaults to 85 % of the height.');
      if (pendingCond) {
        condA.position.copy(new THREE.Vector3(...pendingCond).applyMatrix4(M));
        condB.visible = condMid.visible = false;
        condLine.geometry.dispose();
        condLine.geometry = new THREE.BufferGeometry();
      }
    }

    // Offset of the distal end relative to the pylon
    const distal = new THREE.Vector3(...app.inner().pole).applyMatrix4(M);
    const dAP = distal.z - cz, dML = (distal.x - cx) * sg;
    sOff.set(`AP ${dAP >= 0 ? '+' : ''}${dAP.toFixed(0)} · ML ${dML >= 0 ? '+' : ''}${dML.toFixed(0)} mm`);
    const under = a.plate.gap - a.plate.thickness;
    sThick.set(`${under.toFixed(1)} mm`);
    sThick.root.classList.toggle('warn', under < 4);
  }

  function applyViewVisibility() {
    const view = v.view;
    sagRef.visible = view !== 'front' && view !== 'back';
    frontRef.visible = view !== 'side' && view !== 'side2';
    sagRef.userData.plane.visible = view === 'persp' || view === 'top';
    frontRef.userData.plane.visible = view === 'persp' || view === 'top';
  }

  function autoAlign() {
    const a = A();
    a.ap = 0;
    a.ml = 0;
    if (a.condyle) a.useCondyleYaw = true;
    syncSliders();
    update();
  }

  function sceneBox() {
    const b = new THREE.Box3().setFromObject(footMesh);
    if (socketMesh.geometry.attributes.position) b.union(new THREE.Box3().setFromObject(socketMesh));
    return b;
  }
  function sideView() { v.fit(sceneBox(), A().side === 'left' ? 'side2' : 'side'); }
  function frontView() { v.fit(sceneBox(), 'front'); }

  // ---------- holes / export ----------
  async function generateFinal() {
    await app.busy(t('Computing holes (boolean operations)…'), async () => {
      if (!aligned) rebuild();
      const res = await finalizeSocket(aligned, A().holes);
      finalGeom = res.geometry;
      socketMesh.geometry.dispose();
      socketMesh.geometry = toCreasedNormals(finalGeom.clone(), THREE.MathUtils.degToRad(35));
      socketMesh.geometry.computeBoundsTree();
      finalStatus.textContent = res.warnings.length ? res.warnings.map((w) => t(w)).join(' ') : t('Socket ready: {n} triangles, volume {v} cm³ (watertight).', { n: (finalGeom.index.count / 3).toLocaleString(numberLocale()), v: (res.volume / 1000).toFixed(0) });
    });
  }

  async function exportSocket() {
    if (!finalGeom) await generateFinal();
    if (!finalGeom) return;
    const { cx, cz, yb } = aligned.plate;
    const m = Y_UP_TO_Z_UP.clone().multiply(new THREE.Matrix4().makeTranslation(-cx, -yb, -cz));
    downloadSTL(finalGeom, `socket-${A().side}.stl`, m);
  }
  app.exportSocket = async () => {
    if (app.current !== 3) app.goTo(3);
    await exportSocket();
  };

  // ---------- tools ----------
  const toolImpl = {
    cursor: 'crosshair',
    down(e) {
      const a = A(), sg = sideSign();
      if (tool === 'condyle') {
        const hit = v.pick(e, [socketMesh])[0];
        if (!hit) return false;
        const p = hit.point.clone().applyMatrix4(socketMatrix().invert());
        if (!pendingCond) {
          pendingCond = p.toArray();
          a.condyle = null;
        } else {
          a.condyle = [pendingCond, p.toArray()];
          pendingCond = null;
          a.ap = 0; a.ml = 0;
          syncSliders();
          toolSeg.set('none');
          setTool('none');
        }
        update();
        return false;
      }
      const hit = v.pick(e, [footMesh])[0];
      if (!hit) return false;
      if (tool === 'sag') a.sagZ = Math.round(hit.point.z);
      if (tool === 'front') a.frontX = Math.round(sg * hit.point.x);
      if (tool === 'pylon') { a.pylonZ = Math.round(hit.point.z); a.pylonX = Math.round(sg * hit.point.x); }
      syncSliders();
      update();
      return false;
    },
  };

  function setTool(next) {
    tool = next;
    if (next !== 'condyle') pendingCond = null;
    v.setTool(next === 'none' ? null : toolImpl);
    const hints = {
      none: t('Left click: rotate · right click: pan · wheel: zoom'),
      sag: t('Click the foot to place the side-view vertical axis'),
      front: t('Click the foot to place the front-view vertical axis'),
      pylon: t('Click the foot to place the pylon axis'),
      condyle: t('Click the medial condyle point then the lateral condyle point on the socket'),
    };
    app.hint(hints[next]);
  }

  return {
    title: t('Alignment'),
    panel,
    enter() {
      group.visible = true;
      condLabel.visible = true;
      v.floor.visible = true;
      rebuildFoot();
      ensureDefaults();
      syncSliders();
      toolSeg.set('none');
      setTool('none');
      rebuild();
      v.onViewChange = applyViewVisibility;
      sideView();
    },
    leave() {
      group.visible = false;
      v.floor.visible = false;
      v.onViewChange = null;
      condLabel.visible = false;
    },
  };
}
