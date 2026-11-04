import Module from 'manifold-3d/manifold.js';

let ready = null;

/** Loads the manifold-3d WASM module (once). */
export function getManifold() {
  if (!ready) {
    ready = (async () => {
      let config = {};
      if (typeof window !== 'undefined') {
        const { default: wasmUrl } = await import('manifold-3d/manifold.wasm?url');
        config = { locateFile: () => wasmUrl };
      }
      const wasm = await Module(config);
      wasm.setup();
      return wasm;
    })();
  }
  return ready;
}
