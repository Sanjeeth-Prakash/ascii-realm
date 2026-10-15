// Moonlight / sunlight shadow map that follows the player. The light camera is
// snapped to whole shadow-map texels so shadows never shimmer while moving.

import * as THREE from 'three';

export class MoonShadows {
  constructor(renderer, shared, { size = 1536, radius = 30 } = {}) {
    this.renderer = renderer;
    this.shared = shared;
    this.size = size;
    this.radius = radius;
    const float = renderer.extensions.has('EXT_color_buffer_float');
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: float ? THREE.FloatType : THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 1, 200);
    this.cam.layers.set(1); // only shadow casters
    this.dummy = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.dummy.needsUpdate = true;
    shared.uShadowSize.value = size;
    shared.tShadow.value = this.dummy;
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
  }

  render(scene, focus) {
    const sh = this.shared;
    const dir = sh.uMoonDir.value;
    if (dir.y < 0.12) { sh.uShadowOn.value = 0; return; }

    const cam = this.cam;
    cam.position.copy(focus).addScaledVector(dir, 100);
    cam.up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.99) cam.up.set(0, 0, 1);
    cam.lookAt(focus);
    cam.updateMatrixWorld();

    // snap to the texel grid
    const texel = (2 * this.radius) / this.size;
    const r = this._r.setFromMatrixColumn(cam.matrixWorld, 0);
    const u = this._u.setFromMatrixColumn(cam.matrixWorld, 1);
    const pr = cam.position.dot(r), pu = cam.position.dot(u);
    cam.position.addScaledVector(r, Math.round(pr / texel) * texel - pr);
    cam.position.addScaledVector(u, Math.round(pu / texel) * texel - pu);
    cam.updateMatrixWorld();

    sh.uShadowPass.value = 1;
    sh.uShadowOn.value = 0;
    sh.tShadow.value = this.dummy; // never sample the map we are drawing into
    const rend = this.renderer;
    rend.setRenderTarget(this.rt);
    rend.setClearColor(0xffffff, 1);
    rend.clear(true, true, false);
    rend.render(scene, cam);
    rend.setRenderTarget(null);
    sh.uShadowPass.value = 0;
    sh.tShadow.value = this.rt.texture;
    sh.uShadowOn.value = 1;
    sh.uShadowMat.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }
}
