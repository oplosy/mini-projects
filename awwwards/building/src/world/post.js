import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Lens finish applied after tone mapping: soft vignette and fine film grain.
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.13) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.85);
      c.rgb *= mix(1.0, smoothstep(0.82, 0.18, length(d)), uVignette);
      c.rgb += (rnd(vUv * 1024.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

export function createPost(renderer, scene, camera) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // high threshold: only lamps, headlights and the brightest windows bloom, so the city stays crisp
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.22, 1.35);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const lens = new ShaderPass(LensShader);
  composer.addPass(lens);

  return {
    setSize(w, h, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
      // bloom at half resolution is indistinguishable and much cheaper
      bloom.setSize((w * pixelRatio) / 2, (h * pixelRatio) / 2);
    },
    render(night, time, still) {
      bloom.strength = 0.05 + night * 0.22;
      lens.uniforms.uTime.value = still ? 0 : time;
      composer.render();
    },
  };
}
