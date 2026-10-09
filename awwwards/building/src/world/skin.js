import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { F, FH, BASE, seg, smooth, lerp, worldMaterial } from './util.js';

// The finished facade of Atlas Rezidans (blender/build_tower.py): precast slab edges,
// aluminium fins, balconies with glass balustrades, entrance canopy and crown, with baked AO.
// It sweeps up the tower once the glazing is in, as the last trade on site.

const base = import.meta.env.BASE_URL;
const H = BASE + F * FH;

export function loadSkinAssets() {
  const draco = new DRACOLoader().setDecoderPath(`${base}draco/`);
  const gltf = new GLTFLoader().setDRACOLoader(draco);
  return Promise.all([
    gltf.loadAsync(`${base}assets/tower/tower.glb`),
    new THREE.TextureLoader().loadAsync(`${base}assets/tower/tower_ao.jpg`),
  ]).then(([glb, ao]) => {
    draco.dispose();
    return { glb, ao };
  });
}

export function createSkin(scene, { glb, ao }, tex, renderer) {
  renderer.localClippingEnabled = true;
  // keeps everything below the sweep line
  const sweep = new THREE.Plane(new THREE.Vector3(0, -1, 0), -1);
  ao.flipY = false; // glTF UV origin
  ao.colorSpace = THREE.NoColorSpace;

  const common = { clippingPlanes: [sweep], aoMap: ao, aoMapIntensity: 1 };
  const soffit = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.4, 1.9, 1.3),
    transparent: true,
    opacity: 0,
    toneMapped: false,
    clippingPlanes: [sweep],
  });
  const materials = {
    precast: worldMaterial(new THREE.MeshStandardMaterial({ color: 0xd8d4cb, roughness: 0.82, ...common }), {
      tex: { ...tex, strength: 0.35 },
    }),
    roof: worldMaterial(new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.95, ...common }), {
      tex: { ...tex, strength: 0.6 },
    }),
    fin: new THREE.MeshStandardMaterial({ color: 0x2e2924, roughness: 0.32, metalness: 0.85, ...common }),
    rail: new THREE.MeshStandardMaterial({ color: 0x8d9093, roughness: 0.25, metalness: 0.9, ...common }),
    hvac: new THREE.MeshStandardMaterial({ color: 0x9a9c9e, roughness: 0.5, metalness: 0.6, ...common }),
    balustrade: new THREE.MeshStandardMaterial({
      color: 0x9cb2b8, roughness: 0.04, metalness: 0, envMapIntensity: 2.4,
      transparent: true, opacity: 0.3, depthWrite: false, ...common,
    }),
    screen: new THREE.MeshStandardMaterial({ color: 0xdedbd4, roughness: 0.6, transparent: true, opacity: 0.78, ...common }),
    soffit_light: soffit,
  };

  const group = glb.scene;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const channels = Object.keys(o.geometry.attributes).filter((k) => /^uv\d?$/.test(k)).map((k) => +(k.slice(2) || 0));
    ao.channel = Math.max(...channels); // the AO set is the last one Blender wrote
    const pick = (m) => materials[m.name.replace(/\.\d+$/, '')] ?? materials.precast;
    o.material = Array.isArray(o.material) ? o.material.map(pick) : pick(o.material);
    o.castShadow = o.receiveShadow = true;
  });
  group.visible = false;
  scene.add(group);

  return {
    // p: build progress, nightValue: 0..1
    update(p, nightValue) {
      const k = smooth(seg(p, 0.8, 0.9));
      group.visible = k > 0;
      sweep.constant = lerp(-1, H + 8, k);
      soffit.opacity = nightValue;
    },
  };
}
