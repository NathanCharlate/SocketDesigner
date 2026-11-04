import * as THREE from 'three';
import './style.css';
import { App } from './app.js';
import { el, button } from './ui.js';
import { t, getLang, setLang, LANGUAGES } from './i18n.js';
import { createStep1 } from './steps/step1.js';
import { createStep2 } from './steps/step2.js';
import { createStep3 } from './steps/step3.js';
import { createStep4 } from './steps/step4.js';
import { tubeGeometry, downloadSTL, Y_UP_TO_Z_UP } from './geom/mesh-utils.js';

document.documentElement.lang = getLang();
document.querySelector('.brand span').textContent = t('transtibial socket');
document.querySelector('.legend-labels').innerHTML = `<span>−8 mm</span><span>${t('compression')}</span><span>0</span><span>+4 mm</span>`;

const app = new App();
window.app = app;
app.registerSteps([createStep1(app), createStep2(app), createStep3(app), createStep4(app)]);

// Restore the work in progress after a language switch (the page is reloaded).
const PENDING_KEY = 'socketdesigner:pending';
let restored = false;
try {
  const pending = sessionStorage.getItem(PENDING_KEY);
  if (pending) {
    sessionStorage.removeItem(PENDING_KEY);
    const { project, step } = JSON.parse(pending);
    app.load(project);
    app.goTo(step);
    restored = true;
  }
} catch (e) {
  console.warn('Could not restore the previous session', e);
}
if (!restored) app.goTo(0);

// ---------- view toolbar ----------
const views = [
  ['persp', t('3D')], ['front', t('Front')], ['side', t('Side')], ['back', t('Back')], ['top', t('Top')],
];
const viewBar = document.getElementById('view-toolbar');
const viewBtns = views.map(([name, label]) => {
  const b = button(label, () => {
    let n = name;
    if (name === 'side' && app.align.side === 'left') n = 'side2';
    app.viewer.fit(visibleBox(), n);
  }, 'ghost');
  b.dataset.view = name;
  viewBar.append(b);
  return b;
});
viewBar.append(button(t('Fit'), () => app.viewer.fit(visibleBox()), 'ghost'));
const highlightView = () => {
  const cur = app.viewer.view === 'side2' ? 'side' : app.viewer.view;
  for (const b of viewBtns) b.classList.toggle('on', b.dataset.view === cur);
};
const origSetView = app.viewer.setView.bind(app.viewer);
app.viewer.setView = (...args) => { origSetView(...args); highlightView(); };
highlightView();

function visibleBox() {
  const box = new THREE.Box3();
  app.viewer.scene.traverseVisible((o) => {
    if (o.isMesh && o.geometry?.attributes?.position && !o.userData.noFit && o.material && !o.material.transparent) {
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 300, 100));
  return box;
}

// ---------- global actions ----------
const actions = document.getElementById('actions');
const projInput = el('input', { type: 'file', accept: '.json', hidden: true });
projInput.addEventListener('change', async () => {
  const f = projInput.files[0];
  if (!f) return;
  await app.busy(t('Opening project…'), async () => {
    app.load(JSON.parse(await f.text()));
    app.current = -1;
    app.goTo(1);
  });
  projInput.value = '';
});

const langSelect = el('select', { class: 'lang', title: t('Language') }, LANGUAGES.map(([code, label]) => el('option', { value: code }, label)));
langSelect.value = getLang();
langSelect.addEventListener('change', () => {
  if (app.surf) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ project: app.serialize(), step: Math.max(0, app.current) }));
    } catch (e) {
      if (!confirm(t('The current work could not be kept. Switch language anyway?'))) {
        langSelect.value = getLang();
        return;
      }
    }
  }
  setLang(langSelect.value);
});

actions.append(
  projInput,
  button(t('Open project'), () => projInput.click(), 'ghost'),
  button(t('Save project'), () => {
    if (!app.surf) return alert(t('Nothing to save: generate the working shape first.'));
    const blob = new Blob([JSON.stringify(app.serialize())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'socket-project.json';
    a.click();
  }, 'ghost'),
  button(t('Export positive STL'), () => {
    if (!app.surf) return alert(t('Generate the working shape first.'));
    const { P1 } = app.rectified();
    const s = app.surf, n = s.nCols;
    const rings = [];
    for (let a = 1; a <= s.nRings; a++) rings.push(P1.slice(3 * s.idx(a, 0), 3 * (s.idx(a, 0) + n)));
    const top = rings[rings.length - 1];
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < n; j++) { cx += top[3 * j]; cy += top[3 * j + 1]; cz += top[3 * j + 2]; }
    const g = tubeGeometry(rings, n, P1.slice(0, 3), [cx / n, cy / n, cz / n]);
    downloadSTL(g, 'rectified-positive.stl', Y_UP_TO_Z_UP);
  }, 'ghost'),
  button(t('Export socket STL'), () => {
    if (!app.surf) return alert(t('Generate the working shape first.'));
    app.exportSocket();
  }, 'primary'),
  langSelect,
);
