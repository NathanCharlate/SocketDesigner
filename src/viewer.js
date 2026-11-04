import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const VIEW_DIRS = {
  front: { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  back: { dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  side: { dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  side2: { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  top: { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  persp: { dir: new THREE.Vector3(-0.55, 0.3, 1).normalize(), up: new THREE.Vector3(0, 1, 0) },
};

export class Viewer {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.localClippingEnabled = true;
    r.setClearColor(0x1b2026);
    container.prepend(r.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(30, 1, 1, 20000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
    this.camera = this.persp;
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.18;
    this.controls.zoomToCursor = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 1.4));
    this.key = new THREE.DirectionalLight(0xffffff, 1.7);
    this.scene.add(this.key, this.key.target);
    this.fill = new THREE.DirectionalLight(0xbcd2ff, 0.5);
    this.fill.position.set(0, -1, 0);
    this.scene.add(this.fill);

    this.floor = new THREE.GridHelper(1200, 48, 0x46505c, 0x2a3138);
    this.floor.visible = false;
    this.scene.add(this.floor);

    this.raycaster = new THREE.Raycaster();
    this.view = 'persp';
    this.viewSize = 500;
    this.tool = null;
    this._dragging = false;
    this._initPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.setView('persp', new THREE.Vector3(0, 150, 0), 450);
    r.setAnimationLoop(() => this.render());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this._updateOrtho();
  }

  _updateOrtho() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const H = this.viewSize * 1.25, aspect = w / Math.max(1, h);
    this.ortho.left = (-H * aspect) / 2;
    this.ortho.right = (H * aspect) / 2;
    this.ortho.top = H / 2;
    this.ortho.bottom = -H / 2;
    this.ortho.updateProjectionMatrix();
  }

  render() {
    this.controls.update();
    const c = this.camera;
    this.key.position.copy(c.position).add(new THREE.Vector3(0, this.viewSize, 0));
    this.key.target.position.copy(this.controls.target);
    this.renderer.render(this.scene, c);
    this.labels.render(this.scene, c);
  }

  /** name: 'persp' | 'front' | 'side' | 'side2' | 'back' | 'top' */
  setView(name, center = this.controls.target.clone(), size = this.viewSize) {
    this.view = name;
    this.viewSize = size;
    const { dir, up } = VIEW_DIRS[name];
    if (name === 'persp') {
      this.camera = this.persp;
      const dist = (size / (2 * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)))) * 1.25;
      this.persp.position.copy(center).addScaledVector(dir, dist);
      this.controls.enableRotate = true;
    } else {
      this.camera = this.ortho;
      this.ortho.zoom = 1;
      this._updateOrtho();
      this.ortho.position.copy(center).addScaledVector(dir, 3000);
      this.controls.enableRotate = false;
    }
    this.camera.up.copy(up);
    this.camera.lookAt(center);
    this.controls.object = this.camera;
    this.controls.target.copy(center);
    this.controls.update();
    this._applyMouse();
    this.onViewChange?.(name);
  }

  fit(box, view = this.view) {
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    this.setView(view, c, Math.max(s.x, s.y, s.z) * 1.05);
  }

  _initPointer() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.tool) return;
      if (this.tool.down?.(e)) {
        this._dragging = true;
        el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.tool) return;
      if (this._dragging) this.tool.drag?.(e);
      else this.tool.hover?.(e);
    });
    el.addEventListener('pointerup', (e) => {
      if (!this._dragging) return;
      this._dragging = false;
      el.releasePointerCapture(e.pointerId);
      this.tool?.up?.(e);
    });
    el.addEventListener('pointerleave', () => this.tool?.leave?.());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setTool(tool) {
    if (this.tool && this.tool !== tool) this.tool.leave?.();
    this.tool = tool;
    this.renderer.domElement.style.cursor = tool?.cursor ?? '';
    this._applyMouse();
  }

  _applyMouse() {
    const rot = this.view === 'persp';
    const c = this.controls;
    if (this.tool) c.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: rot ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN };
    else c.mouseButtons = { LEFT: rot ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  pick(e, objects, recursive = false) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.firstHitOnly = true;
    return this.raycaster.intersectObjects(objects.filter((o) => o && o.visible), recursive);
  }
}
