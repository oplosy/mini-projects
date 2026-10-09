import * as THREE from 'three';
import { buildCrane, PALETTE } from './util.js';

// The four disciplines, seen from the studio's west windows: three real Ataşehir buildings
// (konut, ofis: TCMB Kule, kamu: Finans Merkezi Camii) and a working site on a real
// construction plot, where we put up our own frame and crane.
export function createDistricts(scene, mat, city) {
  const edgeMaterial = () =>
    new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.vinc).multiplyScalar(2.2), transparent: true, opacity: 0, toneMapped: false });

  const items = city.districts.map((d) => {
    const edges = edgeMaterial();
    // a faint additive wash makes the building read as selected even 1 km away
    const wash = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.vinc), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
    const meshes = [];
    d.object?.traverse((o) => o.isMesh && meshes.push(o));
    for (const o of meshes) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), edges);
      e.renderOrder = 3;
      o.add(e);
      o.add(new THREE.Mesh(o.geometry, wash));
    }
    return { look: d.look, size: d.size, edges, wash, focus: 0 };
  });

  // Şantiye: an open concrete frame, half-way up, with a crane working over it
  const site = new THREE.Group();
  site.position.copy(city.constructionSpot);
  scene.add(site);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const colGeo = box(0.9, 4, 0.9);
  const levels = 11;
  const edges = edgeMaterial();
  for (let lv = 0; lv < levels; lv++) {
    for (const cx of [-12, -4, 4, 12]) {
      for (const cz of [-8, 0, 8]) {
        const c = new THREE.Mesh(colGeo, mat.steel);
        c.position.set(cx, lv * 4, cz);
        site.add(c);
      }
    }
    const slab = new THREE.Mesh(box(26, 0.4, 18), mat.concrete);
    slab.position.y = lv * 4 + 3.6;
    site.add(slab);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), edges);
    e.position.copy(slab.position);
    site.add(e);
  }
  const workLights = new THREE.Mesh(
    box(26.2, 0.25, 18.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.6, 1.2), transparent: true, opacity: 0, toneMapped: false })
  );
  workLights.position.y = levels * 4 + 0.1;
  site.add(workLights);
  const crane = buildCrane(mat, { jib: 40 });
  crane.setHeight(levels * 4 + 26);
  crane.group.position.set(20, 0, -12);
  site.add(crane.group);
  items.push({ look: new THREE.Vector3(site.position.x, 30, site.position.z), size: 75, edges, focus: 0 });

  return {
    items,
    update(t, nightValue, weights, still) {
      items.forEach((it, i) => {
        it.focus += (weights[i] - it.focus) * 0.12;
        it.edges.opacity = it.focus * (0.35 + 0.65 * nightValue);
        if (it.wash) it.wash.opacity = it.focus * 0.1;
      });
      workLights.material.opacity = nightValue * 0.9;
      crane.animate(1.2 + (still ? 0 : Math.sin(t * 0.17) * 1.1), t, still);
    },
  };
}
