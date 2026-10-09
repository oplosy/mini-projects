import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Y0 } from './util.js';

// The studio on floor ENTER, modelled and light-baked in Blender (blender/build_studio.py):
// a model table under gallery spots, a drawing sheet on the core wall, a lounge and a desk.
// Furniture and textures: Poly Haven (CC0). Lighting: Cycles, baked into one 4K lightmap.
export const TABLE_X = 8;
export const TABLE_TOP = Y0 + 0.9;
export const MODEL_Z = [-8.5, -5.1, -1.7, 1.7, 5.1, 8.5];
export const SHEET = { x: 3.77, y: Y0 + 1.65, w: 2.8, h: 1.85 };

const base = import.meta.env.BASE_URL;

export function loadStudioAssets() {
  const draco = new DRACOLoader().setDecoderPath(`${base}draco/`);
  const gltf = new GLTFLoader().setDRACOLoader(draco);
  return Promise.all([
    gltf.loadAsync(`${base}assets/studio/studio.glb`),
    new THREE.TextureLoader().loadAsync(`${base}assets/studio/lightmap.jpg`),
    fetch(`${base}assets/studio/studio.json`).then((r) => r.json()),
  ]).then(([glb, lightmap, meta]) => {
    draco.dispose();
    return { glb, lightmap, meta };
  });
}

function paintPaper(g, w, h) {
  g.fillStyle = '#eceae5';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(42,46,50,0.06)';
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 18) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y < h; y += 18) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(42,46,50,0.4)';
  g.lineWidth = 3;
  g.strokeRect(24, 24, w - 48, h - 48);
  g.beginPath();
  g.moveTo(24, h - 110);
  g.lineTo(w - 24, h - 110);
  g.stroke();
}

export function createInterior(scene, studio, renderer) {
  const { glb, lightmap, meta } = studio;
  // glTF UVs have their origin top-left, so the lightmap is not flipped
  lightmap.flipY = false;
  lightmap.colorSpace = THREE.SRGBColorSpace;
  lightmap.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // the lightmap stores light that reaches a white surface; three divides diffuse by PI
  const intensity = meta.lightmapScale * Math.PI;
  const byChannel = new Map();
  const lightmapFor = (channel) => {
    if (!byChannel.has(channel)) {
      const lm = channel === 1 ? lightmap : lightmap.clone();
      lm.channel = channel;
      lm.needsUpdate = true;
      byChannel.set(channel, lm);
    }
    return byChannel.get(channel);
  };

  const group = glb.scene;
  group.position.y = Y0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    // the lightmap UVs are the last set Blender exported for each mesh
    const channels = Object.keys(o.geometry.attributes)
      .filter((k) => /^uv\d?$/.test(k))
      .map((k) => +(k.slice(2) || 0));
    const channel = Math.max(...channels);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m) => {
      const c = m.clone(); // glTF shares materials between meshes whose lightmap channel may differ
      c.lightMap = lightmapFor(channel);
      c.lightMapIntensity = intensity;
      c.envMapIntensity = 0.5;
      return c;
    });
    if (!Array.isArray(mats) || mats.length === 1) o.material = o.material[0];
  });
  scene.add(group);

  // ---------- Drawing sheet (painted live, so the site can draw on it) ----------
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = Math.round((1600 * SHEET.h) / SHEET.w);
  const g2 = canvas.getContext('2d');
  paintPaper(g2, canvas.width, canvas.height);
  const sheetTex = new THREE.CanvasTexture(canvas);
  sheetTex.colorSpace = THREE.SRGBColorSpace;
  sheetTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // lit by the baked wall washer; a basic material keeps the paper exactly as painted
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(SHEET.w, SHEET.h),
    new THREE.MeshBasicMaterial({ map: sheetTex, color: new THREE.Color(0.86, 0.84, 0.8) })
  );
  sheet.position.set(SHEET.x, SHEET.y, 0);
  sheet.rotation.y = Math.PI / 2;
  scene.add(sheet);

  let drawnImage = null;
  let showingDrawn = false;
  function setDrawn(on) {
    if (on === showingDrawn) return;
    if (on && !drawnImage) return;
    showingDrawn = on;
    paintPaper(g2, canvas.width, canvas.height);
    if (on) {
      const h = canvas.height - 170;
      const w = (drawnImage.width / drawnImage.height) * h;
      g2.drawImage(drawnImage, canvas.width - w - 70, 40, w, h);
    }
    sheetTex.needsUpdate = true;
  }

  return {
    setDrawingSource(svg) {
      const img = new Image();
      img.onload = () => (drawnImage = img);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    },
    // shown: the floor exists and its lights are on
    update(shown, drawn) {
      group.visible = sheet.visible = shown;
      setDrawn(drawn);
    },
  };
}
