import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { FH, BASE, EYE, PALETTE, seg, smooth, lerp, worldMaterial, textureMean } from './util.js';
import { createTower } from './tower.js';
import { createCity, loadCityAssets } from './city.js';
import { createDistricts } from './districts.js';
import { createInterior, loadStudioAssets, MODEL_Z, TABLE_X, TABLE_TOP, SHEET } from './interior.js';
import { createSky, SUNSET_DIR } from './sky.js';
import { createPost } from './post.js';
import { createSkin, loadSkinAssets } from './skin.js';

export { PHASES, TOWER, towerStats } from './tower.js';

// The whole page is one camera journey. t runs 0..6, one unit per chapter:
// 0 build, 1 enter, 2 models, 3 drawing, 4 city, 5 exit.
export const CHAPTERS = 6;

const asset = (p) => `${import.meta.env.BASE_URL}assets/${p}`;

// Lit office glimpsed through glass: bright ceiling fading to a warm floor
function roomLightTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#fff6dc');
  grad.addColorStop(0.18, '#ffd99a');
  grad.addColorStop(0.75, '#c98a45');
  grad.addColorStop(1, '#7a5530');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Poly Haven CC0 assets: skies were tone-mapped in Blender (blender/hdri_to_web.py)
async function loadAssets(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (path, color = true) =>
    loader.loadAsync(asset(path)).then((t) => {
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      return t;
    });
  const [day, sunset, wall, floor, floorNormal, hdr] = await Promise.all([
    tex('sky/day.jpg'),
    tex('sky/sunset.jpg'),
    tex('tex/concrete_clean_diff_1k.jpg'),
    tex('tex/concrete_floor_02_diff_1k.jpg'),
    tex('tex/concrete_floor_02_nor_gl_1k.jpg', false),
    new HDRLoader().loadAsync(asset('sky/overcast_soil_puresky_1k.hdr')),
  ]);
  for (const s of [day, sunset]) s.wrapT = THREE.ClampToEdgeWrapping;
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  return { day, sunset, wall, floor, floorNormal, hdr };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export async function createWorld(canvas, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // the composer's multisampled target handles edges
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true, // the camera goes from 0.3 m off a model to 400 m above the city
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 900 ? 1.5 : 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;

  const [assets, cityAssets, studioAssets, skinAssets] = await Promise.all([
    loadAssets(renderer),
    loadCityAssets(),
    loadStudioAssets(),
    loadSkinAssets(),
  ]);
  const wallTex = { map: assets.wall, mean: textureMean(assets.wall), scale: 5, strength: 0.4 };

  // Light and haze for the three moods of the journey
  const FOG = { day: new THREE.Color('#d9d7d2'), sunset: new THREE.Color('#d2c9c4'), night: new THREE.Color('#202327') };
  // paving between the blocks; darker than the facades so the buildings read
  const GROUND = { day: new THREE.Color('#9d9991'), night: new THREE.Color('#25282b') };
  const SUN_DAY = new THREE.Vector3(70, 150, 55);
  const SUN_SET = SUNSET_DIR.clone().multiplyScalar(220);
  const SUN_COLOR = { day: new THREE.Color('#fff3df'), sunset: new THREE.Color('#ffae6b'), night: new THREE.Color('#9fb2d6') };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG.day.clone(), 200, 800);
  const pmrem = new THREE.PMREMGenerator(renderer);
  // reflections follow the mood: overcast HDR by day, the sunset photograph from handover on
  const envDay = pmrem.fromEquirectangular(assets.hdr).texture;
  const envSunset = pmrem.fromEquirectangular(assets.sunset).texture;
  scene.environment = envDay;
  scene.environmentIntensity = 0.7;
  assets.hdr.dispose();
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 4000);
  const sky = createSky(scene, assets);

  const hemi = new THREE.HemisphereLight(0xf4f2ec, 0x8d8a82, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3df, 2.4);
  sun.position.copy(SUN_DAY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 10, far: 480 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  const mat = {
    ground: worldMaterial(
      new THREE.MeshStandardMaterial({ color: GROUND.day.clone(), roughness: 1, normalMap: assets.floorNormal, normalScale: new THREE.Vector2(0.6, 0.6) }),
      { tex: { map: assets.floor, mean: textureMean(assets.floor), scale: 16, strength: 0.32 } }
    ),
    concrete: worldMaterial(new THREE.MeshStandardMaterial({ color: 0xc4c0b7, roughness: 0.9 }), { tex: wallTex }),
    core: worldMaterial(new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.94 }), { tex: wallTex }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3b4045, roughness: 0.5, metalness: 0.45 }),
    mullion: new THREE.MeshStandardMaterial({ color: 0x2c3135, roughness: 0.4, metalness: 0.6 }),
    // dielectric glass: lamp highlights stay small, the sky reflection carries the facade
    glass: new THREE.MeshStandardMaterial({ color: 0x51626b, roughness: 0.05, metalness: 0, envMapIntensity: 3.2, transparent: true, opacity: 0.8 }),
    // above 1.0 in linear light so the bloom pass picks the windows up
    window: new THREE.MeshBasicMaterial({ map: roomLightTexture(), color: new THREE.Color(1.35, 1.35, 1.35), transparent: true, opacity: 0, toneMapped: false }),
    yellow: new THREE.MeshStandardMaterial({ color: PALETTE.vinc, roughness: 0.5, metalness: 0.2 }),
    helmet: new THREE.MeshStandardMaterial({ color: PALETTE.vinc, roughness: 0.4 }),
    worker: new THREE.MeshStandardMaterial({ color: 0x4a5056, roughness: 0.8 }),
    ghost: new THREE.LineBasicMaterial({ color: 0x2a2e32, transparent: true, opacity: 0.22, depthWrite: false }),
    cable: new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.6 }),
    beacon: new THREE.MeshBasicMaterial({ color: 0xff3b2f, toneMapped: false }),
  };
  assets.floorNormal.repeat.set(6000 / 9, 6000 / 9);

  // rotated in the geometry, not the mesh, so the world-space texture reads a +y normal
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), mat.ground);
  ground.receiveShadow = true;
  scene.add(ground);

  // the construction plot: compacted earth inside the hoarding
  const plot = new THREE.Mesh(
    new THREE.PlaneGeometry(76, 60).rotateX(-Math.PI / 2).translate(2, 0.012, 0),
    worldMaterial(new THREE.MeshStandardMaterial({ color: 0x8d7f6b, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), {
      tex: { map: assets.floor, mean: textureMean(assets.floor), scale: 6, strength: 0.6 },
    })
  );
  plot.receiveShadow = true;
  scene.add(plot);

  const grid = new THREE.GridHelper(260, 52, 0x2a2e32, 0x2a2e32);
  grid.material.transparent = true;
  grid.material.opacity = 0.07;
  grid.position.y = 0.02;
  scene.add(grid);

  const night = { value: 0 };
  const tower = createTower(scene, mat);
  const city = createCity(scene, night, cityAssets, wallTex);
  const districts = createDistricts(scene, mat, city);
  const interior = createInterior(scene, studioAssets, renderer);
  const skin = createSkin(scene, skinAssets, wallTex, renderer);
  const post = createPost(renderer, scene, camera);

  // ---------- Camera ----------
  let width = 1;
  let height = 1;
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener(
    'pointermove',
    (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true }
  );

  // Chapter 0: orbit that frames whatever stands on site
  function orbit(p, floorsF, time) {
    const aspect = width / height;
    const fit = aspect < 1 ? 1 + (1 - aspect) * 2 : 1;
    const final = smooth(seg(p, 0.84, 1));
    const standing = BASE + floorsF * FH + lerp(24, 6, final);
    const lookY = Math.max(4, standing * 0.45);
    const radius = Math.max(70, standing * 1.75) * fit;
    const ang = -0.75 + p * 1.25 + (reducedMotion ? 0 : Math.sin(time * 0.09) * 0.03);
    let camY = lookY + lerp(36, 10, smooth(seg(p, 0.1, 0.6)));
    camY = lerp(camY, 14, final);
    return { p: V(Math.cos(ang) * radius, camY, Math.sin(ang) * radius), l: V(0, lookY, 0), fov: 34, radius };
  }

  // Keyframes from the end of the build onward. stop: the camera settles on this key.
  const keys = [
    { t: 1.0, p: V(), l: V(), fov: 34, stop: true }, // filled from orbit(1) every frame
    { t: 1.3, p: V(76, 58, -40), l: V(12.8, EYE - 1, -6), fov: 36 },
    { t: 1.56, p: V(24, EYE, -6.8), l: V(12, EYE - 0.3, -6.4), fov: 42 },
    { t: 1.7, p: V(12.3, EYE, -6.4), l: V(6, EYE - 0.5, -6.6), fov: 48 },
    { t: 1.97, p: V(11.4, EYE + 0.1, -11.4), l: V(TABLE_X, TABLE_TOP + 0.3, -8.5), fov: 46, stop: true },
  ];
  MODEL_Z.forEach((z, k) => {
    const pose = { p: V(11.3, TABLE_TOP + 1.3, z - 2.1), l: V(TABLE_X, TABLE_TOP + 0.42, z), fov: 40, stop: true };
    keys.push({ t: 2 + (k + 0.25) / 6, ...pose }, { t: 2 + (k + 0.75) / 6, ...pose });
  });
  const sheetPose = { p: V(6.85, SHEET.y, 0), l: V(3, SHEET.y, 0), fov: 44, stop: true };
  keys.push({ t: 3.22, ...sheetPose }, { t: 3.86, ...sheetPose });
  // round the core to the west windows, where the finance district stands
  keys.push(
    { t: 3.93, p: V(6.4, EYE, 7.7), l: V(-2, EYE - 0.3, 9), fov: 46 },
    { t: 3.99, p: V(-5.6, EYE, 7.8), l: V(-16, EYE - 0.8, 3), fov: 46 },
    { t: 4.05, p: V(-10.2, EYE, -1.6), l: V(-60, EYE - 3, -2), fov: 44 }
  );
  districts.items.forEach((d, i) => {
    // mid-bay, so the facade fins frame the view instead of cutting it
    const p = V(-11.7, EYE, -2.13 + lerp(0.35, -0.35, i / 3));
    // distant buildings get a longer lens, like looking through binoculars
    const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan((d.size * 0.85) / p.distanceTo(d.look))), 9, 40);
    const pose = { p, l: d.look, fov, stop: true };
    keys.push({ t: 4 + (i + 0.22) / 4, ...pose }, { t: 4 + (i + 0.78) / 4, ...pose });
  });
  // out through the glass and up around the tower, the skyline behind it
  keys.push(
    { t: 5.2, p: V(-14.8, EYE, -2.13), l: V(-90, EYE - 6, -6), fov: 42 },
    { t: 5.48, p: V(-62, 96, 58), l: V(0, 62, 0), fov: 40 },
    { t: 5.75, p: V(60, 130, 160), l: V(0, 55, 0), fov: 38 },
    { t: 6.0, p: V(190, 125, 165), l: V(-6, 38, 0), fov: 36, stop: true }
  );
  const tmpA = V();
  const tmpB = V();
  function catmull(out, p0, p1, p2, p3, s) {
    const s2 = s * s;
    const s3 = s2 * s;
    out.set(0, 0, 0)
      .addScaledVector(p0, -0.5 * s3 + s2 - 0.5 * s)
      .addScaledVector(p1, 1.5 * s3 - 2.5 * s2 + 1)
      .addScaledVector(p2, -1.5 * s3 + 2 * s2 + 0.5 * s)
      .addScaledVector(p3, 0.5 * s3 - 0.5 * s2);
    return out;
  }

  function sampleKeys(t) {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[i + 1];
    let s = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    if (a.stop && b.stop) s = smooth(s);
    else if (a.stop) s = s * s;
    else if (b.stop) s = 1 - (1 - s) * (1 - s);
    const k0 = keys[i - 1] ?? a;
    const k3 = keys[i + 2] ?? b;
    return {
      p: catmull(tmpA, k0.p, a.p, b.p, k3.p, s),
      l: catmull(tmpB, k0.l, a.l, b.l, k3.l, s),
      fov: lerp(a.fov, b.fov, s),
    };
  }

  // ---------- Frame ----------
  let target = 0;
  let current = -1;
  let time = 0;
  let last = performance.now();

  function frame(t, dt) {
    const p = Math.min(1, t);
    const { floorsF, dusk } = tower.update(p, time, reducedMotion, mouse.sx);
    const nightValue = t < 1 ? dusk : 1;
    // overcast day, then the sun drops behind the tower during handover, then night
    const sunsetK = t < 1 ? smooth(seg(p, 0.74, 0.86)) : 1;
    night.value = nightValue;

    scene.fog.color.lerpColors(FOG.day, FOG.sunset, sunsetK).lerp(FOG.night, nightValue);
    mat.ground.color.lerpColors(GROUND.day, GROUND.night, nightValue);
    hemi.intensity = lerp(lerp(1.25, 0.75, sunsetK), 0.16, nightValue);
    sun.position.lerpVectors(SUN_DAY, SUN_SET, sunsetK);
    sun.color.lerpColors(SUN_COLOR.day, SUN_COLOR.sunset, sunsetK).lerp(SUN_COLOR.night, nightValue);
    sun.intensity = lerp(lerp(2.4, 2.8, sunsetK), 0.18, nightValue);
    scene.environment = sunsetK > 0.5 ? envSunset : envDay;
    scene.environmentIntensity = lerp(lerp(0.7, 0.8, sunsetK), 0.16, nightValue);
    grid.material.opacity = lerp(0.07, 0.02, nightValue);
    renderer.shadowMap.autoUpdate = nightValue < 0.98;

    city.update(time, nightValue, reducedMotion);
    // the studio's lights come on with the rest of the tower at handover
    interior.update(t >= 1 || p > 0.88, t > 3.86);
    skin.update(p, nightValue);
    const activeDistrict = t >= 4 && t < 5 ? Math.min(3, Math.floor((t - 4) * 4)) : -1;
    districts.update(time, nightValue, [0, 1, 2, 3].map((i) => (i === activeDistrict ? 1 : 0)), reducedMotion);

    const o = orbit(p, floorsF, time);
    let shot;
    if (t <= 1) {
      shot = o;
    } else {
      keys[0].p.copy(o.p);
      keys[0].l.copy(o.l);
      shot = sampleKeys(t);
    }
    camera.position.copy(shot.p);
    camera.lookAt(shot.l);
    // pointer parallax, gentler indoors
    const sway = t < 1.4 ? 1 : 0.4;
    camera.rotateY(-mouse.sx * 0.035 * sway);
    camera.rotateX(-mouse.sy * 0.022 * sway);
    if (camera.fov !== shot.fov) {
      camera.fov = shot.fov;
      camera.updateProjectionMatrix();
    }
    const near = t > 1.45 && t < 5.35 ? 0.05 : 0.5;
    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }

    const k = smooth(seg(t, 1, 1.3));
    // daytime haze keeps the city a quiet backdrop; after dark it opens up
    scene.fog.near = lerp(o.radius * lerp(1.1, 1.5, nightValue), 320, k);
    scene.fog.far = lerp(o.radius * lerp(4, 5, nightValue), 1700, k);

    sky.update(camera, sunsetK, nightValue, scene.fog.color);
    post.render(nightValue, time, reducedMotion);
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    const k = 1 - Math.pow(0.0025, dt); // frame-rate independent easing toward the scroll position
    current = current < 0 ? target : current + (target - current) * k;
    if (Math.abs(target - current) < 1e-5) current = target;
    mouse.sx += (mouse.x - mouse.sx) * k * 0.5;
    mouse.sy += (mouse.y - mouse.sy) * k * 0.5;
    frame(current, dt);
  }

  function resize() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    post.setSize(width, height, renderer.getPixelRatio());
    camera.aspect = width / height;
    // keep the subject right of centre on wide screens so the copy owns the left column
    if (width / height > 1.15) camera.setViewOffset(width, height, -width * 0.12, 0, width, height);
    else camera.setViewOffset(width, height, 0, height * 0.03, width, height);
    camera.updateProjectionMatrix();
    frame(Math.max(0, current), 0);
  }

  resize();
  window.addEventListener('resize', resize);
  renderer.compile(scene, camera);

  return {
    interior,
    // dev inspection: render the world at journey time t from an arbitrary viewpoint
    debug: {
      scene,
      camera,
      peek(t, pos, look) {
        renderer.setAnimationLoop(null);
        frame(t, 0);
        camera.position.set(...pos);
        camera.lookAt(...look);
        post.render(t < 1 ? 0 : 1, time, true);
      },
    },
    setT(t) {
      target = Math.max(0, Math.min(CHAPTERS, t));
    },
    // render a journey position immediately, skipping the easing (dev inspection)
    jump(t) {
      target = current = t;
      frame(t, 0);
    },
    start() {
      last = performance.now();
      renderer.setAnimationLoop(loop);
    },
  };
}
