import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { rand } from './util.js';

// Ataşehir from OpenStreetMap (© OpenStreetMap contributors, ODbL), built in Blender by
// blender/build_city.py. UVs are in metres, so windows, paint and texture keep real sizes.

const base = import.meta.env.BASE_URL;

export function loadCityAssets() {
  const draco = new DRACOLoader().setDecoderPath(`${base}draco/`);
  const gltf = new GLTFLoader().setDRACOLoader(draco);
  const json = (p) => fetch(`${base}assets/city/${p}`).then((r) => r.json());
  return Promise.all([gltf.loadAsync(`${base}assets/city/city.glb`), json('trees.json'), json('traffic.json')]).then(
    ([glb, trees, traffic]) => {
      draco.dispose();
      return { glb, trees, traffic };
    }
  );
}

// Shared GLSL: world position/normal, metre UVs, hash, texture detail
const PARS_V = `
  varying vec3 vWP;
  varying vec3 vWN;
  varying vec2 vM;`;
const MAIN_V = `
  vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
  vWP = wp4.xyz;
  vWN = normalize(mat3(modelMatrix) * objectNormal);
  // glTF stores v flipped (1 - v); undo it so v is height or distance across, in metres
  vM = vec2(uv.x, 1.0 - uv.y);`;
const PARS_F = `
  uniform float uNight;
  uniform sampler2D uTex;
  uniform vec3 uTexMean;
  varying vec3 vWP;
  varying vec3 vWN;
  varying vec2 vM;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 detail(vec2 p, float scale, float k) {
    return mix(vec3(1.0), texture2D(uTex, p / scale).rgb / max(uTexMean, vec3(0.01)), k);
  }
`;
// vColor is declared after <common>, so the seed is read inline in main()
const SEED = `#ifdef USE_COLOR_ALPHA
      float seed = vColor.a;
    #else
      float seed = 0.5;
    #endif`;

function patch(material, { night, tex, fragment, roughness = '', road = false }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.uniforms.uTex = { value: tex.map };
    shader.uniforms.uTexMean = { value: tex.mean };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${PARS_V}${road ? '\n  attribute vec2 uv1;\n  varying vec2 vRoad;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>${MAIN_V}${road ? '\n  vRoad = uv1;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${PARS_F}${road ? '\n  varying vec2 vRoad;' : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${fragment}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${roughness}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cityGlow;');
  };
  material.customProgramCacheKey = () => fragment;
  return material;
}

// Apartment blocks: tinted render, punched windows, shopfronts on the ground floor
const FACADE = /* glsl */ `
  vec3 cityGlow = vec3(0.0);
  float glassMix = 0.0;
  {
    ${SEED}
    if (abs(vWN.y) < 0.5) {
      diffuseColor.rgb *= detail(vM + seed * 37.0, 4.5, 0.55);
      vec2 g = vec2(vM.x / 3.2, vM.y / 3.05);
      vec2 cell = floor(g);
      vec2 f = fract(g);
      bool shop = cell.y < 1.0;
      float win = shop
        ? step(0.08, f.x) * step(f.x, 0.92) * step(0.08, f.y) * step(f.y, 0.78)
        : step(0.27, f.x) * step(f.x, 0.73) * step(0.3, f.y) * step(f.y, 0.84);
      // slab lines and a darker plinth give each block weight
      diffuseColor.rgb *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.06, f.y));
      diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 1.4, vM.y));
      float n = h21(cell + seed * 113.0);
      float on = step(1.0 - (shop ? 0.75 : 0.36), n);
      vec3 warm = mix(vec3(1.0, 0.66, 0.34), vec3(1.0, 0.82, 0.58), h21(cell.yx + seed));
      vec3 lit = shop ? vec3(1.0, 0.9, 0.75) * 1.25 : warm * (0.55 + 0.6 * f.y);
      cityGlow = lit * win * on * uNight * 0.8;
      // by day the glass carries the grey-blue of the sky, by night it goes dark
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.17, 0.2, 0.23), vec3(0.04, 0.045, 0.05), uNight), win);
      glassMix = win;
    } else {
      diffuseColor.rgb = vec3(0.42, 0.41, 0.4) * detail(vWP.xz, 6.0, 0.8);
    }
  }`;

// Towers: curtain wall with spandrel bands and mullions, whole office floors lit at night
const CURTAIN = /* glsl */ `
  vec3 cityGlow = vec3(0.0);
  float glassMix = 0.0;
  {
    ${SEED}
    if (abs(vWN.y) < 0.5) {
      float fy = fract(vM.y / 3.8);
      float floorId = floor(vM.y / 3.8);
      float mull = step(0.94, fract(vM.x / 1.5));
      float spandrel = step(fy, 0.2);
      float glass = (1.0 - spandrel) * (1.0 - mull);
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.55, diffuseColor.rgb * 0.16, glass);
      float bay = floor(vM.x / 7.5);
      float on = step(0.5, h21(vec2(floorId, bay) + seed * 71.0));
      vec3 office = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.92, 0.78), step(0.7, h21(vec2(floorId, seed))));
      cityGlow = office * glass * on * uNight * (0.55 + 0.5 * fy);
      glassMix = glass;
    } else {
      diffuseColor.rgb = vec3(0.36, 0.37, 0.38) * detail(vWP.xz, 6.0, 0.7);
    }
  }`;

const GLASS_ROUGH = 'roughnessFactor = mix(roughnessFactor, 0.06, glassMix);';

const ROAD = /* glsl */ `
  vec3 cityGlow = vec3(0.0);
  {
    // second UV set from Blender: x = road width, y = 1 for roads with paint (flipped by glTF)
    float w = vRoad.x;
    float marked = 1.0 - vRoad.y;
    float v = vM.y;
    float u = vM.x;
    diffuseColor.rgb *= detail(vWP.xz, 3.0, 0.5);
    float inside = step(abs(v), w * 0.5);
    float centre = step(abs(v), 0.09) * step(fract(u / 9.0), 0.55) * marked;
    float edge = step(abs(abs(v) - (w * 0.5 - 0.45)), 0.08) * marked;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.71, 0.66), max(centre, edge) * inside);
    // sodium street light pooling on the asphalt after dark
    float pool = 0.55 + 0.45 * pow(abs(sin(u * 0.105)), 4.0);
    cityGlow = vec3(0.1, 0.055, 0.02) * uNight * pool;
  }`;

const GROUND = /* glsl */ `
  vec3 cityGlow = vec3(0.0);
  diffuseColor.rgb *= detail(vWP.xz, 7.0, 0.7);`;

function lowTree() {
  const r = rand(5);
  const canopy = new THREE.IcosahedronGeometry(1, 1);
  const pos = canopy.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.82 + r() * 0.36;
    pos.setXYZ(i, pos.getX(i) * k * 2.6, pos.getY(i) * k * 2.9 + 6.2, pos.getZ(i) * k * 2.6);
  }
  canopy.computeVertexNormals();
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 4.4, 6).translate(0, 2.2, 0);
  return { canopy, trunk };
}

export function createCity(scene, night, assets, tex) {
  const { glb, trees, traffic } = assets;
  const objects = {};
  glb.scene.traverse((o) => (objects[o.name] = o));

  const facade = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), {
    night, tex, fragment: FACADE, roughness: GLASS_ROUGH,
  });
  const curtain = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, envMapIntensity: 1.8 }), {
    night, tex, fragment: CURTAIN, roughness: GLASS_ROUGH,
  });
  const road = patch(
    new THREE.MeshStandardMaterial({ color: 0x45474a, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    { night, tex, fragment: ROAD, road: true }
  );
  const grass = patch(new THREE.MeshStandardMaterial({ color: 0x5d6b40, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), {
    night, tex, fragment: GROUND,
  });
  const dirt = patch(new THREE.MeshStandardMaterial({ color: 0x8c7b62, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), {
    night, tex, fragment: GROUND,
  });
  const water = new THREE.MeshStandardMaterial({ color: 0x1f3540, roughness: 0.08, envMapIntensity: 1.6 });

  // rooftop kit: lift overruns, water tanks and solar water heaters
  const roofkit = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.85 });
  const tank = new THREE.MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.45, metalness: 0.3 });
  const solar = new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.15, metalness: 0.2, envMapIntensity: 1.6 });

  const byName = { facade, facade_glass: curtain, roof: facade, road, grass, dirt, water, roofkit, tank, solar };
  glb.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = byName[o.material.name] ?? facade;
    o.receiveShadow = true;
  });
  scene.add(glb.scene);

  // ---------- Trees in the parks ----------
  const { canopy, trunk } = lowTree();
  const leaves = new THREE.InstancedMesh(canopy, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), trees.length);
  const bark = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4b3d31, roughness: 1 }), trees.length);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const tr = rand(11);
  trees.forEach(([x, z, s, a], i) => {
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, a, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    bark.setMatrixAt(i, dummy.matrix);
    leaves.setColorAt(i, tint.setHSL(0.2 + tr() * 0.07, 0.3 + tr() * 0.15, 0.2 + tr() * 0.08));
  });
  leaves.castShadow = true;
  scene.add(leaves, bark);

  // ---------- Traffic on the real main roads ----------
  const lanes = [];
  for (const r of traffic) {
    const pts = r.pts.map(([x, z]) => new THREE.Vector2(x, z));
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = lens[lens.length - 1];
    for (const dir of [1, -1]) lanes.push({ pts, lens, total, dir, offset: dir * Math.min(3.2, r.w * 0.22) });
  }
  const cars = [];
  const cr = rand(23);
  for (const lane of lanes) {
    const n = Math.max(1, Math.round(lane.total / 45));
    for (let k = 0; k < n; k++) cars.push({ lane, s: cr() * lane.total, speed: 8 + cr() * 7 });
  }
  const bodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.8, 1.25, 4.3).translate(0, 0.78, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }),
    cars.length
  );
  const paints = [0xe8e8e6, 0x1d1f22, 0x8b9096, 0x2c3e5a, 0x7a1f1f, 0xc9c4b8, 0x3a3f44];
  cars.forEach((c, i) => bodies.setColorAt(i, tint.set(paints[Math.floor(cr() * paints.length)])));
  // head and tail lamps in one mesh, coloured per vertex, bright enough to bloom
  const lp = [];
  const lc = [];
  const lampPair = (z, r, g, b) => {
    for (const x of [-0.62, 0.62]) {
      const s = 0.2;
      for (const p of [[x - s, 0.7, z], [x + s, 0.7, z], [x + s, 0.92, z], [x - s, 0.7, z], [x + s, 0.92, z], [x - s, 0.92, z]]) {
        lp.push(...p);
        lc.push(r, g, b);
      }
    }
  };
  lampPair(2.16, 3, 2.8, 2.4);
  lampPair(-2.16, 2.6, 0.18, 0.12);
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lampGeo.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0 });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, cars.length);
  for (const m of [bodies, lamps]) m.frustumCulled = false;
  bodies.castShadow = true;
  scene.add(bodies, lamps);

  const dir = new THREE.Vector2();
  function placeCars(t) {
    cars.forEach((c, i) => {
      const { lane } = c;
      let s = (c.s + c.speed * t) % lane.total;
      if (lane.dir < 0) s = lane.total - s;
      let k = 1;
      while (k < lane.lens.length - 1 && lane.lens[k] < s) k++;
      const a = lane.pts[k - 1];
      const b = lane.pts[k];
      const segLen = lane.lens[k] - lane.lens[k - 1] || 1;
      dir.copy(b).sub(a).divideScalar(segLen);
      const f = (s - lane.lens[k - 1]) / segLen;
      dummy.position.set(a.x + (b.x - a.x) * f - dir.y * lane.offset, 0.12, a.y + (b.y - a.y) * f + dir.x * lane.offset);
      dummy.rotation.set(0, Math.atan2(dir.x, dir.y) + (lane.dir < 0 ? Math.PI : 0), 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      lamps.setMatrixAt(i, dummy.matrix);
    });
    bodies.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
  }
  placeCars(0);

  const districts = [0, 1, 2].map((i) => {
    const o = objects[`district_${i}`];
    const ex = o?.userData ?? {};
    const h = ex.height ?? 40;
    return { object: o, size: Math.max(h, 30), look: new THREE.Vector3(ex.center_x ?? 0, h * 0.6, ex.center_z ?? 0) };
  });

  return {
    districts,
    constructionSpot: (objects.construction_spot?.position ?? new THREE.Vector3(-394, 0, 144)).clone(),
    update(t, nightValue, still) {
      lampMat.opacity = Math.min(1, nightValue * 1.5);
      if (!still) placeCars(t);
    },
  };
}
