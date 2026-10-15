import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltf = new GLTFLoader();
let fbx = null;   // loaded only when an .fbx (e.g. a Mixamo character) is in the list

async function loadOne(url) {
  if (/\.fbx$/i.test(url)) {
    if (!fbx) { const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js'); fbx = new FBXLoader(); }
    const obj = await fbx.loadAsync(url);
    return { scene: obj, animations: obj.animations };   // same shape as a glTF
  }
  return gltf.loadAsync(url);
}

// Load every model up front; returns { name: gltf-like { scene, animations } }.
export async function loadAssets(list, onProgress) {
  const out = {};
  let done = 0;
  await Promise.all(Object.entries(list).map(async ([name, url]) => {
    out[name] = await loadOne(url);
    onProgress?.(++done, Object.keys(list).length);
  }));
  return out;
}
