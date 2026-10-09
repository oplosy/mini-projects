import * as THREE from 'three';

// Sky dome: overcast day and sunset photographs (Poly Haven, tone-mapped in Blender),
// then a generated night sky with city glow on the horizon and a few stars.
// The horizon dissolves into the fog colour so the ground plane never shows an edge.

// Where the sun sits in sunset.jpg (equirect u, elevation), rotated so it sets behind the tower
const SUNSET_U = 0.6;
const YAW = 2.57;

export const SUNSET_DIR = (() => {
  const phi = (SUNSET_U - 0.5) * Math.PI * 2 + YAW;
  const el = 0.07;
  return new THREE.Vector3(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
})();

export function createSky(scene, { day, sunset }) {
  const uniforms = {
    uDay: { value: day },
    uSunset: { value: sunset },
    uSunsetK: { value: 0 },
    uNightK: { value: 0 },
    uFog: { value: new THREE.Color() },
    uYaw: { value: YAW },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDay;
      uniform sampler2D uSunset;
      uniform float uSunsetK;
      uniform float uNightK;
      uniform vec3 uFog;
      uniform float uYaw;
      varying vec3 vDir;

      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

      void main() {
        vec3 d = normalize(vDir);
        float phi = atan(d.z, d.x) - uYaw;
        vec2 uv = vec2(fract(phi / 6.2831853 + 0.5), asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
        vec3 col = mix(texture2D(uDay, uv).rgb, texture2D(uSunset, uv).rgb, uSunsetK);

        // night: graphite zenith, warm sodium haze from the city near the horizon
        float h = clamp(d.y, 0.0, 1.0);
        vec3 night = mix(vec3(0.034, 0.038, 0.046), vec3(0.008, 0.009, 0.012), pow(h, 0.45));
        night += vec3(0.11, 0.075, 0.045) * exp(-h * 14.0);
        float star = step(0.9975, hash(floor(d * 520.0))) * smoothstep(0.08, 0.4, h);
        night += star * 0.55;
        col = mix(col, night, uNightK);

        // melt into the fog at the horizon
        col = mix(uFog, col, smoothstep(-0.01, 0.09, d.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), material);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);

  return {
    update(camera, sunsetK, nightK, fogColor) {
      dome.position.copy(camera.position);
      uniforms.uSunsetK.value = sunsetK;
      uniforms.uNightK.value = nightK;
      uniforms.uFog.value.copy(fogColor);
    },
  };
}
