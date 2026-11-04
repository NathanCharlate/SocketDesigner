import * as THREE from 'three';
import { el, section, button, row, note, slider, checkbox, stat } from '../ui.js';
import { t, numberLocale } from '../i18n.js';
import { parseMeshFile, keepLargestComponent } from '../geom/mesh-utils.js';
import { GridSurface } from '../geom/surface.js';
import { closedVolume } from '../geom/rectify.js';

const SAMPLE_URL = 'samples/sample-positive.stl';

/** Stands the scan upright (long axis = Y), axis through x=z=0, distal end at y=0. */
function autoOrient(g, { convertUp = true } = {}) {
  g.computeBoundingBox();
  const s = g.boundingBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(s.x, s.y, s.z);
  if (maxDim < 2) g.scale(1000, 1000, 1000); // metres
  else if (maxDim < 60) g.scale(10, 10, 10); // centimetres
  if (convertUp) {
    if (s.z >= s.y && s.z >= s.x) g.rotateX(-Math.PI / 2);
    else if (s.x >= s.y && s.x >= s.z) g.rotateZ(Math.PI / 2);
  }
  for (let it = 0; it < 3; it++) verticalize(g);
}

function slabCentroid(pos, y0, y1) {
  let x = 0, y = 0, z = 0, n = 0;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 1] >= y0 && pos[i + 1] <= y1) { x += pos[i]; y += pos[i + 1]; z += pos[i + 2]; n++; }
  }
  return n ? new THREE.Vector3(x / n, y / n, z / n) : null;
}

function verticalize(g) {
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const H = max.y - min.y;
  const pos = g.attributes.position.array;
  const c1 = slabCentroid(pos, min.y + 0.2 * H, min.y + 0.35 * H);
  const c2 = slabCentroid(pos, min.y + 0.55 * H, min.y + 0.7 * H);
  if (c1 && c2) {
    const axis = c2.clone().sub(c1).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0));
    const m = new THREE.Matrix4().makeTranslation(c1.x, c1.y, c1.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
      .multiply(new THREE.Matrix4().makeTranslation(-c1.x, -c1.y, -c1.z));
    g.applyMatrix4(m);
  }
  g.computeBoundingBox();
  const p = g.attributes.position.array;
  const b = g.boundingBox;
  const h = b.max.y - b.min.y;
  const a = slabCentroid(p, b.min.y + 0.2 * h, b.min.y + 0.35 * h);
  const c = slabCentroid(p, b.min.y + 0.55 * h, b.min.y + 0.7 * h);
  const cx = a && c ? (a.x + c.x) / 2 : 0, cz = a && c ? (a.z + c.z) / 2 : 0;
  g.translate(-cx, -b.min.y, -cz);
  g.computeBoundingBox();
}

export function createStep1(app) {
  const v = app.viewer;
  const group = new THREE.Group();
  group.visible = false;
  v.scene.add(group);

  const rawMat = new THREE.MeshStandardMaterial({ color: 0xc9bfb2, roughness: 0.7, side: THREE.DoubleSide, clippingPlanes: [] });
  let rawMesh = null;
  const planeMesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  const planeRing = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, i) => new THREE.Vector3(Math.cos((i / 96) * Math.PI * 2), 0, Math.sin((i / 96) * Math.PI * 2)))),
    new THREE.LineBasicMaterial({ color: 0xff8a3d }),
  );
  planeMesh.add(planeRing);
  group.add(planeMesh);

  // "Anterior" arrow
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 120, 0x4fc3ff, 22, 12);
  group.add(arrow);
  const axisLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -20, 0), new THREE.Vector3(0, 500, 0)]),
    new THREE.LineDashedMaterial({ color: 0x8aa0b4, dashSize: 6, gapSize: 4 }),
  );
  axisLine.computeLineDistances();
  group.add(axisLine);

  let showRaw = true;
  let previewCut = true;

  // ---------- panel ----------
  const fileInput = el('input', { type: 'file', accept: '.stl,.ply,.obj', hidden: true });
  fileInput.addEventListener('change', () => fileInput.files[0] && loadFile(fileInput.files[0]));
  const drop = el('div', { class: 'drop' }, el('strong', {}, t('Drop a scan here')), el('span', {}, t('STL, PLY or OBJ — or click to browse')));
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
  const sTris = stat(t('Triangles')), sSize = stat(t('Dimensions'));

  const yawS = slider({ label: t('Rotation about the axis (front = blue arrow)'), min: -180, max: 180, step: 1, value: 0, unit: '°', onInput: (x) => { app.yaw = x; updateRaw(); } });
  const hS = slider({ label: t('Plane height'), min: 20, max: 500, step: 1, value: app.cut.height, unit: 'mm', onInput: (x) => { app.cut.height = x; updatePlane(); } });
  const txS = slider({ label: t('Antero-posterior tilt'), min: -35, max: 35, step: 0.5, value: 0, unit: '°', onInput: (x) => { app.cut.tiltX = x; updatePlane(); } });
  const tzS = slider({ label: t('Medio-lateral tilt'), min: -35, max: 35, step: 0.5, value: 0, unit: '°', onInput: (x) => { app.cut.tiltZ = x; updatePlane(); } });
  const itS = slider({ label: t('Iterations'), min: 0, max: 80, step: 1, value: app.smoothing.iterations, onInput: (x) => { app.smoothing.iterations = x; applySmoothing(); } });
  const lamS = slider({ label: t('Strength'), min: 0.1, max: 1, step: 0.05, value: app.smoothing.lambda, digits: 2, onInput: (x) => { app.smoothing.lambda = x; applySmoothing(); } });
  const sHeight = stat(t('Usable length')), sCirc = stat(t('Max circumference')), sVol = stat(t('Volume'));

  const rawToggle = checkbox(t('Show raw scan'), showRaw, (c) => { showRaw = c; refreshVisibility(); });
  const cutToggle = checkbox(t('Preview the cut'), previewCut, (c) => { previewCut = c; updatePlane(); });

  const genBtn = button(t('Generate working shape'), () => generate(), 'primary wide');

  const sampleRow = row(button(t('Load sample positive'), () => loadUrl(SAMPLE_URL, 'sample-positive.stl')));
  sampleRow.hidden = true;
  // The sample scan is not published with the app; only show the button when it exists locally.
  fetch(SAMPLE_URL, { method: 'HEAD' })
    .then((r) => { sampleRow.hidden = !(r.ok && !(r.headers.get('content-type') || '').includes('text/html')); })
    .catch(() => {});

  const orientCard = section(t('2 · Orientation'),
    row(button(t('Auto straighten'), () => { if (!app.raw) return; autoOrient(app.raw, { convertUp: false }); afterGeometryChange(); }),
      button(t('Flip ↕'), () => { if (!app.raw) return; app.raw.rotateX(Math.PI); verticalize(app.raw); afterGeometryChange(); })),
    yawS.root,
    note(t('The long axis of the scan is made vertical, distal end down. Rotate the shape so the tibial crest / patellar tendon faces the blue arrow (anterior).')),
  );
  const cutCard = section(t('3 · Cut plane'), hS.root, txS.root, tzS.root, cutToggle.root,
    note(t('Everything above the plane is removed (unwanted scan area).')));
  const smoothCard = section(t('4 · Smoothing'),
    itS.root, lamS.root,
    note(t('Radial smoothing: it regularises the surface without shrinking the shape.')),
    row(sHeight.root, sCirc.root), row(sVol.root),
    rawToggle.root);

  const panel = el('div', { class: 'step' },
    el('h2', {}, t('Import')),
    section(t('1 · Scan'),
      drop, fileInput,
      sampleRow,
      row(sTris.root, sSize.root)),
    orientCard, cutCard,
    el('div', { class: 'card' }, genBtn),
    smoothCard,
  );

  // ---------- logic ----------
  async function loadUrl(url, name) {
    await app.busy(t('Loading…'), async () => {
      const buf = await (await fetch(url)).arrayBuffer();
      setGeometry(parseMeshFile(name, buf), name);
    });
  }

  async function loadFile(file) {
    await app.busy(t('Reading file…'), async () => {
      const buf = await file.arrayBuffer();
      setGeometry(parseMeshFile(file.name, buf), file.name);
    });
  }

  function setGeometry(g, name) {
    g = keepLargestComponent(g);
    autoOrient(g);
    app.raw = g;
    app.rawName = name;
    app.yaw = 0;
    yawS.set(0);
    const H = g.boundingBox.max.y;
    app.cut = { height: Math.round(H * 0.75), tiltX: 0, tiltZ: 0 };
    hS.setRange(10, Math.ceil(H));
    hS.set(app.cut.height); txS.set(0); tzS.set(0);
    showRaw = true;
    rawToggle.input.checked = true;
    afterGeometryChange();
    v.fit(new THREE.Box3().setFromObject(rawMesh), 'persp');
  }

  function afterGeometryChange() {
    const g = app.raw;
    g.computeBoundingBox();
    g.computeBoundsTree?.();
    if (!rawMesh) {
      rawMesh = new THREE.Mesh(g, rawMat);
      group.add(rawMesh);
    } else rawMesh.geometry = g;
    const s = g.boundingBox.getSize(new THREE.Vector3());
    sTris.set((g.index.count / 3).toLocaleString(numberLocale()));
    sSize.set(`${s.x.toFixed(0)} × ${s.z.toFixed(0)} × ${s.y.toFixed(0)} mm`);
    hS.setRange(10, Math.ceil(g.boundingBox.max.y));
    updateRaw();
    updatePlane();
    app.hint(t('Orient the shape, place the cut plane, then click "Generate working shape"'));
  }

  function keepPlane() {
    const n = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(THREE.MathUtils.degToRad(app.cut.tiltX), 0, THREE.MathUtils.degToRad(app.cut.tiltZ), 'XZY'));
    return new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(0, app.cut.height, 0));
  }

  function updateRaw() {
    if (!rawMesh) return;
    rawMesh.rotation.y = THREE.MathUtils.degToRad(app.yaw);
    rawMesh.updateMatrixWorld();
  }

  function updatePlane() {
    const p = keepPlane();
    const R = app.raw ? Math.max(90, app.raw.boundingBox.getSize(new THREE.Vector3()).x * 0.75) : 120;
    planeMesh.scale.setScalar(R);
    planeMesh.position.set(0, app.cut.height, 0);
    planeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.normal);
    rawMat.clippingPlanes = previewCut ? [p.clone().negate()] : [];
    rawMat.needsUpdate = true;
  }

  function refreshVisibility() {
    if (rawMesh) {
      rawMesh.visible = showRaw || !app.surf;
      rawMat.transparent = !!app.surf;
      rawMat.opacity = app.surf ? 0.25 : 1;
      rawMat.depthWrite = !app.surf;
    }
    if (app.shapeMesh) app.shapeMesh.visible = !!app.surf;
  }

  async function generate() {
    if (!app.raw) { alert(t('Import a scan first.')); return; }
    await app.busy(t('Resampling the shape…'), () => {
      const g = app.raw.clone();
      g.rotateY(THREE.MathUtils.degToRad(app.yaw));
      const surf = GridSurface.fromGeometry(g, keepPlane());
      g.dispose();
      const sameGrid = app.surf && app.surf.nV === surf.nV;
      app.surf = surf;
      if (!sameGrid) app.rect.weights = new Float32Array(surf.nV);
      if (!app.rect.sections.length) {
        let top = Infinity;
        for (const h of surf.htop) top = Math.min(top, h);
        const H = top;
        app.rect.sections = [
          { h: Math.round(H * 0.08), pct: 0 },
          { h: Math.round(H * 0.35), pct: 3 },
          { h: Math.round(H * 0.65), pct: 5 },
          { h: Math.round(H * 0.92), pct: 4 },
        ];
      }
      app.trim = null;
      showRaw = false;
      rawToggle.input.checked = false;
      applySmoothing(true);
    });
  }

  function applySmoothing(surfChanged = false) {
    if (!app.surf) return;
    app.rBase = app.surf.smoothR(app.surf.r, app.smoothing.iterations, app.smoothing.lambda);
    app.bump(...(surfChanged ? ['surf', 'smooth'] : ['smooth']));
    const { P0 } = app.base();
    app.showShape(P0, 'neutral');
    refreshVisibility();
    updateStats();
  }

  function updateStats() {
    const s = app.surf;
    const { P0 } = app.base();
    let top = Infinity;
    for (const h of s.htop) top = Math.min(top, h);
    sHeight.set(`${top.toFixed(0)} mm`);
    let maxPer = 0;
    for (let h = 10; h < top; h += 5) {
      const S = s.slice(P0, h);
      if (S) maxPer = Math.max(maxPer, GridSurface.sliceStats(S).perimeter);
    }
    sCirc.set(`${(maxPer / 10).toFixed(1)} cm`);
    sVol.set(`${closedVolume(s, P0).toFixed(0)} cm³`);
  }

  return {
    title: t('Import'),
    panel,
    enter() {
      group.visible = true;
      v.floor.visible = false;
      if (app.surf) {
        const { P0 } = app.base();
        app.showShape(P0, 'neutral');
        yawS.set(app.yaw); hS.set(app.cut.height); txS.set(app.cut.tiltX); tzS.set(app.cut.tiltZ);
        itS.set(app.smoothing.iterations); lamS.set(app.smoothing.lambda);
        updateStats();
      }
      refreshVisibility();
      arrow.visible = true;
      app.hint(app.raw || app.surf ? t('Left click: rotate · right click: pan · wheel: zoom') : t('Import a scan of the residual limb to get started.'));
    },
    leave() {
      group.visible = false;
      if (app.shapeMesh) app.shapeMesh.visible = false;
    },
  };
}
