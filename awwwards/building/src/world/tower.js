import * as THREE from 'three';
import { F, FH, S, BASE, COLS, ENTER, clamp01, seg, smooth, easeOut, lerp, rand, buildCrane } from './util.js';

// Build progress p (0..1) is the first chapter of the journey.
export const PHASES = [0, 0.14, 0.48, 0.84, 1]; // temel, karkas, cephe, teslim
export const TOWER = { floors: F, floorHeight: FH };

export function towerStats(p) {
  const floorsF = seg(p, PHASES[1], PHASES[2]) * F;
  return { floors: Math.floor(floorsF + 1e-6), height: floorsF * FH };
}

const SIDE_PANELS = 6;
const PW = (2 * S) / SIDE_PANELS;
const hide = 1e-4;

export function createTower(scene, mat) {
  const dummy = new THREE.Object3D();

  const boundary = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      [[-36, -30], [40, -30], [40, 30], [-36, 30]].map(([x, z]) => new THREE.Vector3(x, 0.05, z))
    ),
    new THREE.LineBasicMaterial({ color: 0x2a2e32, transparent: true, opacity: 0.4 })
  );
  scene.add(boundary);

  // Blueprint ghost of the finished tower
  const gp = [];
  const square = (y, s) => {
    const c = [[-s, -s], [s, -s], [s, s], [-s, s]];
    for (let k = 0; k < 4; k++) {
      const a = c[k];
      const b = c[(k + 1) % 4];
      gp.push(a[0], y, a[1], b[0], y, b[1]);
    }
  };
  for (let i = 0; i <= F; i++) square(BASE + i * FH, S);
  for (const [x, z] of [[-S, -S], [S, -S], [S, S], [-S, S]]) gp.push(x, BASE, z, x, BASE + F * FH, z);
  const ghostGeo = new THREE.BufferGeometry();
  ghostGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  const ghost = new THREE.LineSegments(ghostGeo, mat.ghost);
  scene.add(ghost);

  // ---------- Foundation ----------
  const pileSpots = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) pileSpots.push([-11 + i * 5.5, -11 + j * 5.5]);
  const piles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 14).translate(0, 0.5, 0), mat.concrete, pileSpots.length);
  piles.castShadow = piles.receiveShadow = true;
  piles.frustumCulled = false;
  scene.add(piles);

  const raft = new THREE.Mesh(new THREE.BoxGeometry(2 * (S + 1.5), BASE, 2 * (S + 1.5)).translate(0, BASE / 2, 0), mat.concrete);
  raft.castShadow = raft.receiveShadow = true;
  scene.add(raft);

  // ---------- Frame ----------
  const columns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.85, FH, 0.85).translate(0, FH / 2, 0), mat.steel, F * 16);
  columns.castShadow = columns.receiveShadow = true;
  columns.frustumCulled = false;
  scene.add(columns);

  const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(2 * S, 0.42, 2 * S).translate(0, -0.21, 0), mat.concrete, F);
  slabs.castShadow = slabs.receiveShadow = true;
  slabs.frustumCulled = false;
  scene.add(slabs);

  const core = new THREE.Mesh(new THREE.BoxGeometry(7.5, 1, 7.5).translate(0, 0.5, 0), mat.core);
  core.position.y = BASE;
  core.castShadow = core.receiveShadow = true;
  scene.add(core);

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), mat.beacon);
  beacon.visible = false;
  scene.add(beacon);

  // ---------- Facade ----------
  const sides = [
    { n: [0, 1], rot: 0 },
    { n: [1, 0], rot: Math.PI / 2 },
    { n: [0, -1], rot: Math.PI },
    { n: [-1, 0], rot: -Math.PI / 2 },
  ];
  const r = rand(7);
  const panelData = [];
  for (let i = 0; i < F; i++) {
    for (const side of sides) {
      for (let k = 0; k < SIDE_PANELS; k++) {
        const u = -S + PW / 2 + k * PW;
        const tx = side.n[1];
        const tz = -side.n[0];
        panelData.push({
          floor: i,
          x: side.n[0] * (S + 0.08) + tx * u,
          z: side.n[1] * (S + 0.08) + tz * u,
          nx: side.n[0],
          nz: side.n[1],
          tx,
          tz,
          rot: side.rot,
          jitter: r() * 0.6,
          // the studio floor is lit from inside instead
          lit: i !== ENTER && r() < 0.46,
          threshold: r(),
        });
      }
    }
  }
  const panelGeo = new THREE.BoxGeometry(PW - 0.16, FH - 0.5, 0.12).translate(0, (FH - 0.5) / 2 + 0.04, 0);
  const panels = new THREE.InstancedMesh(panelGeo, mat.glass, panelData.length);
  panels.frustumCulled = false;
  panels.renderOrder = 2;
  scene.add(panels);

  // aluminium mullions on the left edge of every panel; they arrive with their glass
  const mullions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, FH - 0.42, 0.32).translate(0, (FH - 0.42) / 2, 0), mat.mullion, panelData.length);
  mullions.frustumCulled = false;
  mullions.castShadow = true;
  scene.add(mullions);

  const litData = panelData.filter((d) => d.lit);
  const windows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(PW - 0.9, FH - 1.2).translate(0, (FH - 0.5) / 2, 0),
    mat.window,
    litData.length
  );
  windows.frustumCulled = false;
  windows.renderOrder = 1;
  scene.add(windows);

  // ---------- Crane ----------
  const crane = buildCrane(mat);
  crane.group.position.set(-19, 0, 18);
  scene.add(crane.group);

  // ---------- Workers ----------
  const workers = [];
  const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8).translate(0, 0.74, 0);
  const helmetGeo = new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.5, 0);
  const wr = rand(42);
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, mat.worker);
    body.castShadow = true;
    g.add(body, new THREE.Mesh(helmetGeo, mat.helmet));
    const half = 16.5 + wr() * 4.5;
    workers.push({ g, half, speed: (0.9 + wr() * 0.9) * (wr() < 0.5 ? -1 : 1), s: wr() * 8 * half, phase: wr() * 6 });
    scene.add(g);
  }

  function placeWorker(w, t) {
    const per = 8 * w.half;
    const s = (((w.s + w.speed * t) % per) + per) % per;
    const side = Math.floor(s / (2 * w.half));
    const d = s - side * 2 * w.half - w.half;
    const h = w.half;
    const pts = [[d, -h, 0], [h, d, -Math.PI / 2], [-d, h, Math.PI], [-h, -d, Math.PI / 2]][side];
    w.g.position.set(pts[0], Math.abs(Math.sin(t * 6 + w.phase)) * 0.08, pts[1]);
    w.g.rotation.y = pts[2] + (w.speed < 0 ? Math.PI : 0);
  }
  workers.forEach((w) => placeWorker(w, 0));

  let lastP = -1;

  function build(p) {
    pileSpots.forEach(([x, z], k) => {
      const e = easeOut(seg(p, 0.005 + (k / pileSpots.length) * 0.06, 0.03 + (k / pileSpots.length) * 0.06));
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(e > 0 ? 1 : hide, e > 0 ? e : hide, e > 0 ? 1 : hide);
      dummy.updateMatrix();
      piles.setMatrixAt(k, dummy.matrix);
    });
    piles.instanceMatrix.needsUpdate = true;
    raft.position.y = lerp(-BASE - 0.1, 0, smooth(seg(p, 0.07, 0.13)));

    const floorsF = seg(p, PHASES[1], PHASES[2]) * F;
    let ci = 0;
    for (let i = 0; i < F; i++) {
      const ce = easeOut(clamp01(floorsF - i));
      const se = easeOut(clamp01((floorsF - i - 0.45) * 1.8));
      for (const x of COLS) {
        for (const z of COLS) {
          dummy.position.set(x, BASE + i * FH, z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(ce > 0 ? 1 : hide, ce > 0 ? ce : hide, ce > 0 ? 1 : hide);
          dummy.updateMatrix();
          columns.setMatrixAt(ci++, dummy.matrix);
        }
      }
      const ss = se > 0 ? se : hide;
      dummy.position.set(0, BASE + (i + 1) * FH, 0);
      dummy.scale.set(ss, 1, ss);
      dummy.updateMatrix();
      slabs.setMatrixAt(i, dummy.matrix);
    }
    columns.instanceMatrix.needsUpdate = true;
    slabs.instanceMatrix.needsUpdate = true;

    const coreStart = smooth(seg(p, 0.11, 0.16));
    core.scale.y = Math.max(hide, Math.min(F * FH + 4, floorsF * FH + 2 * FH * coreStart));
    beacon.position.set(0, BASE + core.scale.y + 0.6, 0);

    const facF = seg(p, 0.46, 0.82) * (F + 2);
    panelData.forEach((d, k) => {
      const e = easeOut(clamp01((facF - d.floor - d.jitter) / 1.4));
      const off = 1 - e;
      dummy.position.set(d.x + d.nx * off * 11, BASE + d.floor * FH + off * 5, d.z + d.nz * off * 11);
      dummy.rotation.set(off * 0.7, d.rot, 0, 'YXZ');
      const sc = e > 0 ? 1 : hide;
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      panels.setMatrixAt(k, dummy.matrix);
      dummy.position.x -= (d.tx * PW) / 2;
      dummy.position.z -= (d.tz * PW) / 2;
      dummy.updateMatrix();
      mullions.setMatrixAt(k, dummy.matrix);
    });
    panels.instanceMatrix.needsUpdate = true;
    mullions.instanceMatrix.needsUpdate = true;

    const dusk = smooth(seg(p, 0.86, 0.98));
    let wi = 0;
    litData.forEach((d) => {
      const on = dusk > d.threshold * 0.85 + 0.05;
      dummy.position.set(d.x - d.nx * 0.7, BASE + d.floor * FH, d.z - d.nz * 0.7);
      dummy.rotation.set(0, d.rot, 0);
      const sc = on ? 1 : hide;
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      windows.setMatrixAt(wi++, dummy.matrix);
    });
    windows.instanceMatrix.needsUpdate = true;
    mat.window.opacity = Math.min(1, dusk * 1.6);
    mat.glass.opacity = lerp(0.8, 0.22, dusk);
    beacon.visible = dusk > 0.3;
    mat.ghost.opacity = 0.22 * (1 - seg(p, 0.55, 0.84));
    boundary.material.opacity = 0.4 * (1 - dusk);

    const mastH = Math.max(30, BASE + floorsF * FH + 16);
    crane.setHeight(mastH);
    const out = smooth(seg(p, 0.84, 0.93));
    crane.group.position.y = -out * (mastH + 30);
    crane.group.visible = out < 1;

    const crew = 1 - smooth(seg(p, 0.8, 0.88));
    workers.forEach((w) => {
      w.g.scale.setScalar(crew > 0 ? crew : hide);
      w.g.visible = crew > 0;
    });
    return { floorsF, dusk };
  }

  let state = build(0);

  return {
    // p: build progress, t: seconds, still: reduced motion, sway: pointer x (-1..1)
    update(p, t, still, sway) {
      if (p !== lastP) {
        state = build(p);
        lastP = p;
      }
      if (crane.group.visible) crane.animate(0.75 + (still ? p * 2 : Math.sin(t * 0.13) * 0.9 + p * 2) + sway * 0.45, t, still, sway);
      if (!still && workers[0].g.visible) workers.forEach((w) => placeWorker(w, t));
      beacon.material.color.setRGB(1, 0.23, 0.18).multiplyScalar(Math.sin(t * 3) > 0 ? 3 : 0.3);
      return state;
    },
  };
}
