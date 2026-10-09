import * as THREE from 'three';

// Tower dimensions, metres. The camera enters the building on floor ENTER.
export const F = 28;
export const FH = 3.6;
export const HALF = 12;
export const S = HALF + 0.8;
export const BASE = 1.2;
export const COLS = [-12, -4, 4, 12];
export const ENTER = 18;
export const Y0 = BASE + ENTER * FH; // floor level of the studio
export const EYE = Y0 + 1.7;

export const PALETTE = {
  beton: '#c9c6be',
  kalip: '#e6e4de',
  grafit: '#2a2e32',
  vinc: '#f0b323',
};

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const seg = (p, a, b) => clamp01((p - a) / (b - a));
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const lerp = (a, b, t) => a + (b - a) * t;

export function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Average linear colour of a loaded texture, so world textures add detail without shifting the base colour
export function textureMean(texture) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.drawImage(texture.image, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  let r = 0;
  let gr = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += lin(d[i]);
    gr += lin(d[i + 1]);
    b += lin(d[i + 2]);
  }
  const n = d.length / 4;
  return new THREE.Vector3(r / n, gr / n, b / n);
}

// Patches a MeshStandardMaterial with world-space effects. Geometry may be scaled or
// instanced but not rotated (normals are read in object space).
//   tex: { map, mean, scale (metres per tile), strength } — box-projected surface detail
//   windows: { night, lit } — procedural windows that light up after dark
export function worldMaterial(material, { tex, windows } = {}) {
  const uniforms = {
    uNight: windows?.night ?? { value: 0 },
    uLit: { value: windows?.lit ?? 0.42 },
    uTex: { value: tex?.map ?? null },
    uTexMean: { value: tex?.mean ?? new THREE.Vector3(1, 1, 1) },
    uTexScale: { value: tex?.scale ?? 4 },
    uTexStrength: { value: tex?.strength ?? 0 },
  };
  const defines = [tex ? '#define WORLD_TEX' : '', windows ? '#define WORLD_WINDOWS' : ''].join('\n');
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        wp4 = modelMatrix * wp4;
        vWP = wp4.xyz;
        vWN = objectNormal;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${defines}
        uniform float uNight;
        uniform float uLit;
        uniform sampler2D uTex;
        uniform vec3 uTexMean;
        uniform float uTexScale;
        uniform float uTexStrength;
        varying vec3 vWP;
        varying vec3 vWN;
        float worldHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef WORLD_TEX
        {
          vec3 an = abs(vWN);
          vec2 tuv = an.x > 0.5 ? vWP.zy : (an.z > 0.5 ? vWP.xy : vWP.xz);
          vec3 tx = texture2D(uTex, tuv / uTexScale).rgb / max(uTexMean, vec3(0.01));
          diffuseColor.rgb *= mix(vec3(1.0), tx, uTexStrength);
        }
        #endif`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef WORLD_WINDOWS
        if (abs(vWN.y) < 0.5) {
          bool onX = abs(vWN.x) > 0.5;
          float u = onX ? vWP.z : vWP.x;
          float w = onX ? vWP.x : vWP.z;
          vec2 g = vec2(u / 3.2, (vWP.y - 1.2) / 3.5);
          vec2 cell = floor(g);
          vec2 f = fract(g);
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.24, f.y) * step(f.y, 0.78) * step(0.0, cell.y);
          float h = worldHash(cell + floor(w) * 0.137);
          float on = step(1.0 - uLit, h);
          float tone = worldHash(cell.yx + 7.3);
          vec3 c = mix(vec3(1.0, 0.72, 0.4), vec3(0.75, 0.86, 1.0), step(0.84, tone));
          totalEmissiveRadiance += c * win * on * uNight * 1.5;
          diffuseColor.rgb *= 1.0 - win * mix(0.1, 0.38, uNight);
        }
        #endif`
      );
  };
  material.customProgramCacheKey = () => `world:${!!tex}:${!!windows}`;
  material.userData.uniforms = uniforms;
  return material;
}

export function latticeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = PALETTE.vinc;
  g.lineWidth = 12;
  g.strokeRect(6, 6, 116, 116);
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(0, 128);
  g.lineTo(128, 0);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function latticeMesh(geo, tex) {
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.15 })
  );
  m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
  m.castShadow = true;
  return m;
}

// A tower crane. Returns the group plus the parts that move.
export function buildCrane(mat, { jib = 48 } = {}) {
  const crane = new THREE.Group();

  const footing = new THREE.Mesh(new THREE.BoxGeometry(7, 1.4, 7).translate(0, 0.7, 0), mat.concrete);
  footing.castShadow = footing.receiveShadow = true;
  crane.add(footing);

  const mastTex = latticeTexture();
  const mast = latticeMesh(new THREE.BoxGeometry(2.1, 1, 2.1).translate(0, 0.5, 0), mastTex);
  mast.position.y = 1.4;
  crane.add(mast);

  const head = new THREE.Group();
  crane.add(head);

  const turntable = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1, 3.2).translate(0, 0.5, 0), mat.yellow);
  turntable.castShadow = true;
  head.add(turntable);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), mat.yellow);
  cab.position.set(1.2, 2.1, 2.2);
  cab.castShadow = true;
  head.add(cab);

  const apexTex = latticeTexture();
  apexTex.repeat.set(1, 10 / 1.4);
  const apex = latticeMesh(new THREE.BoxGeometry(1.4, 1, 1.4).translate(0, 0.5, 0), apexTex);
  apex.scale.y = 10;
  apex.position.y = 1;
  head.add(apex);

  const jibTex = latticeTexture();
  jibTex.repeat.set(jib / 1.8, 1);
  const jibMesh = latticeMesh(new THREE.BoxGeometry(1, 1.8, 1.8).translate(0.5, 0.9, 0), jibTex);
  jibMesh.scale.x = jib;
  jibMesh.position.set(1.4, 1, 0);
  head.add(jibMesh);

  const cjTex = latticeTexture();
  cjTex.repeat.set(15 / 1.4, 1);
  const counterJib = latticeMesh(new THREE.BoxGeometry(1, 1.4, 1.8).translate(-0.5, 0.7, 0), cjTex);
  counterJib.scale.x = 15;
  counterJib.position.set(-1.4, 1, 0);
  head.add(counterJib);

  for (const x of [-13.8, -11.2]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.6, 2.6), mat.core);
    w.position.set(x, 0.2, 0);
    w.castShadow = true;
    head.add(w);
  }

  head.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 11, 0), new THREE.Vector3(jib * 0.7, 2.8, 0),
        new THREE.Vector3(0, 11, 0), new THREE.Vector3(-15, 2.4, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0x2a2e32 })
    )
  );

  const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.6), mat.steel);
  head.add(trolley);

  const rig = new THREE.Group();
  head.add(rig);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6).translate(0, -0.5, 0), mat.cable);
  rig.add(cable);
  const hookEnd = new THREE.Group();
  rig.add(hookEnd);
  const hookBlock = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.8).translate(0, -0.65, 0), mat.yellow);
  hookBlock.castShadow = true;
  hookEnd.add(hookBlock);
  hookEnd.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -1.3, 0), new THREE.Vector3(-3, -3.6, 0),
        new THREE.Vector3(0, -1.3, 0), new THREE.Vector3(3, -3.6, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0x22262a })
    )
  );
  const load = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.55, 0.55), mat.steel);
  load.position.y = -3.9;
  load.castShadow = true;
  hookEnd.add(load);

  function setHeight(mastH) {
    mast.scale.y = mastH;
    mastTex.repeat.set(1, mastH / 2.1);
    head.position.y = 1.4 + mastH;
  }

  // slew: jib heading in radians; t: seconds; still: freeze idle motion
  function animate(slew, t, still, sway = 0) {
    head.rotation.y = slew;
    const tx = lerp(10, jib - 6, 0.5 + 0.5 * Math.sin(still ? 1 : t * 0.21));
    trolley.position.set(tx, 0.75, 0);
    rig.position.set(tx, 0.5, 0);
    const L = lerp(5, 11, 0.5 + 0.5 * Math.sin(still ? 0 : t * 0.31 + 1));
    cable.scale.y = L;
    hookEnd.position.y = -L;
    rig.rotation.z = still ? 0 : Math.sin(t * 0.9) * 0.05 - sway * 0.03;
    rig.rotation.x = still ? 0 : Math.cos(t * 0.7) * 0.03;
    load.rotation.y = still ? 0 : Math.sin(t * 0.4) * 0.3;
  }

  return { group: crane, setHeight, animate };
}
