import 'lenis/dist/lenis.css';
import './style.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { createWorld, towerStats, TOWER, PHASES } from './world/index.js';
import { drawingSVG } from './drawing.js';
import { projects, disciplines, img } from './data.js';

gsap.registerPlugin(SplitText);

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (t, a, b) => clamp01((t - a) / (b - a));

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

// ---------- Content ----------

$('.projects__cards').innerHTML = projects
  .map(
    (p, i) => `
  <article class="project" aria-hidden="${i !== 0}">
    <div class="project__media"><img src="${img(p.photo, 1000)}" alt="${p.alt}" ${i > 1 ? 'loading="lazy"' : ''} decoding="async"></div>
    <div class="project__body">
      <h3 class="display">${p.name}</h3>
      ${p.status ? `<p class="project__status">${p.status}</p>` : '<p hidden></p>'}
      <dl>
        <dt>Yer</dt><dd>${p.place}</dd>
        <dt>Yıl</dt><dd>${p.year}</dd>
        <dt>Ölçek</dt><dd>${p.size}</dd>
        <dt>Alan</dt><dd>${p.area}</dd>
      </dl>
    </div>
  </article>`
  )
  .join('');

$('.disc-list').innerHTML = disciplines
  .map(
    (d, i) => `
  <li class="disc">
    <button type="button" data-i="${i}">
      <h3 class="display">${d.name}</h3>
      <span class="disc__count">${d.count} proje</span>
      <p>${d.text}</p>
    </button>
  </li>`
  )
  .join('');

$('.drawing__svg-wrap').innerHTML = drawingSVG();

// ---------- World ----------

let world = null;
// textures and skies load before the first frame; the loader waits for this
const worldReady = createWorld($('.world'), { reducedMotion: reduced })
  .then((w) => {
    world = w;
    w.interior.setDrawingSource(drawingSVG({ standalone: true }));
    if (import.meta.env.DEV) window.__kaide.world = w;
  })
  .catch((err) => {
    console.warn('WebGL unavailable, using a still image', err);
    document.documentElement.classList.add('no-webgl');
  });

// ---------- Journey position from scroll ----------
// Each chapter contributes 0..1, so t runs 0..6 with no dead zones between chapters.

const chapters = $$('.chapter');
let metrics = [];

function measure() {
  chapters.forEach((el) => (el.style.height = `${el.dataset.len}vh`));
  const vh = window.innerHeight;
  metrics = chapters.map((el, i) => {
    const top = el.offsetTop;
    const h = el.offsetHeight;
    return { el, top, h, len: i === chapters.length - 1 ? h - vh : h };
  });
}

function journeyAt(y) {
  return metrics.reduce((t, m) => t + clamp01((y - m.top) / m.len), 0);
}

function scrollForT(t) {
  const i = Math.min(chapters.length - 1, Math.floor(t));
  const m = metrics[i];
  return m.top + (t - i) * m.len;
}

const lenis = new Lenis({ lerp: reduced ? 1 : 0.075, smoothWheel: !reduced });
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();

$$('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    e.preventDefault();
    const target = id === '#top' ? 0 : scrollForT(chapters.indexOf($(id)) + +($(id).dataset.anchor ?? 0));
    lenis.scrollTo(target, { duration: reduced ? 0 : 2.8, easing: (x) => 1 - Math.pow(1 - x, 4) });
  })
);

// ---------- Overlays ----------

const fade = (t, a, b, f) => Math.min(clamp01((t - a) / f), clamp01((b - t) / f));

function show(el, v, lift = 18) {
  el.style.opacity = v;
  el.style.visibility = v > 0.001 ? 'visible' : 'hidden';
  el.style.transform = v < 1 ? `translateY(${(1 - v) * lift}px)` : '';
  el.classList.toggle('is-on', v > 0.5);
}

const overlays = {
  build: $('.overlay--build'),
  manifesto: $('.overlay--manifesto'),
  projects: $('.overlay--projects'),
  drawing: $('.overlay--drawing'),
  disciplines: $('.overlay--disciplines'),
  contact: $('.overlay--contact'),
};

// Build chapter UI
const intro = $('.hero__intro');
const phaseEls = $$('.phase');
const phaseItems = $$('.phases li');
const phaseBars = $$('.phases__bar i');
const heightEl = $('[data-height]');
const floorEl = $('[data-floor]');
let activePhase = -2;

function updateBuild(p) {
  const s = towerStats(p);
  heightEl.textContent = `+${s.height.toFixed(1).replace('.', ',')}`;
  floorEl.textContent = String(s.floors).padStart(2, '0');
  let idx = PHASES.findIndex((b, i) => i < PHASES.length - 1 && p >= b && p < PHASES[i + 1]);
  if (p >= 1) idx = PHASES.length - 2;
  phaseBars.forEach((bar, i) => {
    bar.style.transform = `scaleX(${clamp01((p - PHASES[i]) / (PHASES[i + 1] - PHASES[i]))})`;
  });
  const shown = p < 0.025 ? -1 : idx;
  if (shown !== activePhase) {
    activePhase = shown;
    intro.classList.toggle('is-hidden', shown >= 0);
    phaseEls.forEach((el, i) => {
      el.classList.toggle('is-active', i === shown);
      el.classList.toggle('is-past', shown >= 0 && i < shown);
    });
    phaseItems.forEach((el, i) => {
      el.classList.toggle('is-active', i === idx);
      el.classList.toggle('is-done', i < idx);
    });
  }
  overlays.build.classList.toggle('is-dusk', p > 0.885);
}

// Manifesto: words resolve while the camera flies toward the lit floor
const manifesto = new SplitText('.manifesto__text', { type: 'words', wordsClass: 'w' });
function updateManifesto(t) {
  const k = seg(t, 1.06, 1.5) * manifesto.words.length;
  manifesto.words.forEach((w, i) => (w.style.opacity = 0.16 + 0.84 * clamp01(k - i)));
}

// Projects: one card per model on the table
const cards = $$('.project');
const projectIndex = $('[data-project-index]');
let activeCard = -1;
function updateProjects(t) {
  const i = Math.min(5, Math.max(0, Math.floor((t - 2) * 6)));
  if (i === activeCard) return;
  activeCard = i;
  cards.forEach((c, k) => {
    c.classList.toggle('is-active', k === i);
    c.setAttribute('aria-hidden', String(k !== i));
  });
  projectIndex.textContent = String(i + 1).padStart(2, '0');
}

// Drawing: strokes follow the order a site is built in
const steps = new Map();
$$('#kesit [data-s]').forEach((el) => {
  const s = +el.dataset.s;
  if (!steps.has(s)) steps.set(s, { lines: [], labels: [] });
  steps.get(s)[el.classList.contains('d-label') ? 'labels' : 'lines'].push(el);
});
const drawTl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
const timing = { 0: [0, 1], 1: [0.6, 0.8], 2: [1.2, 1], 3: [2, 0.8], 4: [2.6, 1.6], 5: [3, 3], 6: [4.6, 1.6], 7: [6, 0.6], 8: [6.6, 1], 9: [7.4, 1.4] };
steps.forEach(({ lines, labels }, s) => {
  const [at, dur] = timing[s];
  if (lines.length) drawTl.to(lines, { strokeDashoffset: 0, duration: dur, stagger: lines.length > 1 ? (dur * 0.7) / lines.length : 0 }, at);
  if (labels.length) drawTl.to(labels, { opacity: 1, duration: 0.4, stagger: 0.1 }, at + dur * 0.6);
});

// Disciplines: one district lit at a time
const discRows = $$('.disc');
let activeDisc = -1;
function updateDisciplines(t) {
  const i = Math.min(3, Math.max(0, Math.floor((t - 4) * 4)));
  if (i === activeDisc) return;
  activeDisc = i;
  discRows.forEach((r, k) => r.classList.toggle('is-active', k === i));
}
discRows.forEach((row, i) =>
  $('button', row).addEventListener('click', () =>
    lenis.scrollTo(scrollForT(4 + (i + 0.5) / 4), { duration: reduced ? 0 : 1.4 })
  )
);

// Contact: letters widen as the camera rises over the skyline
const contactSplit = new SplitText('.contact__title .line', { type: 'chars', charsClass: 'ch' });
function updateContact(t) {
  const k = seg(t, 5.45, 5.95);
  const n = contactSplit.chars.length;
  contactSplit.chars.forEach((c, i) => c.style.setProperty('--w', 50 + 68 * clamp01(k * 1.6 - (i / n) * 0.6)));
}

// Nav: mark the chapter in view
const navLinks = $$('.nav__links a:not(.nav__cta)');
function updateNav(t) {
  const chapter = Math.floor(t);
  navLinks.forEach((a) => a.classList.toggle('is-current', chapters.indexOf($(a.getAttribute('href'))) === chapter));
}

function render(t) {
  updateBuild(Math.min(1, t));
  show(overlays.build, 1 - seg(t, 0.97, 1.02), 0);
  show(overlays.manifesto, fade(t, 1.03, 1.66, 0.07));
  updateManifesto(t);
  show(overlays.projects, fade(t, 1.97, 3.03, 0.04));
  if (t > 1.9 && t < 3.1) updateProjects(t);
  show(overlays.drawing, fade(t, 3.15, 3.95, 0.07), 0);
  drawTl.progress(reduced ? 1 : seg(t, 3.24, 3.8));
  show(overlays.disciplines, fade(t, 3.99, 5.05, 0.04));
  if (t > 3.9 && t < 5.1) updateDisciplines(t);
  show(overlays.contact, fade(t, 5.42, 7, 0.12));
  updateContact(t);
  updateNav(t);
}

function onScroll() {
  const t = journeyAt(window.scrollY);
  world?.setT(t);
  render(t);
}

lenis.on('scroll', onScroll);
window.addEventListener('resize', () => {
  measure();
  onScroll();
});
measure();
render(0);

// ---------- Loader and opening ----------

const heroSplit = new SplitText('.hero__title .line', { type: 'chars', charsClass: 'ch' });
const loaderNum = $('.loader__num');
const shaft = $('.loader__shaft span');
const counter = { v: 0 };
const paint = () => {
  loaderNum.textContent = String(Math.round(counter.v * TOWER.floors)).padStart(2, '0');
  shaft.style.transform = `scaleY(${counter.v})`;
};

const preload = (src) =>
  new Promise((res) => {
    const i = new Image();
    i.onload = i.onerror = res;
    i.src = src;
  });

const ready = Promise.race([
  Promise.all([
    worldReady,
    document.fonts.ready,
    ...projects.slice(0, 2).map((p) => preload(img(p.photo, 1000))),
    new Promise((r) => setTimeout(r, reduced ? 0 : 1300)),
  ]),
  new Promise((r) => setTimeout(r, 6000)),
]);

gsap.set('.nav', { opacity: 0 });
gsap.set(heroSplit.chars, { yPercent: 110, '--w': 50 });
gsap.set(['.hero__lede', '.hero__hint', '.meter'], { opacity: 0, y: 24 });

const fill = gsap.to(counter, { v: 0.82, duration: reduced ? 0 : 1.3, ease: 'power2.inOut', onUpdate: paint });

ready.then(() => {
  fill.kill();
  measure();
  // on a slow connection the loader may give up waiting; start the scene whenever it arrives
  worldReady.then(() => {
    world?.start();
    onScroll();
  });
  gsap
    .timeline({ onComplete: () => lenis.start() })
    .to(counter, { v: 1, duration: reduced ? 0 : 0.45, ease: 'power2.out', onUpdate: paint })
    .to('.loader__inner', { opacity: 0, y: -30, duration: 0.45, ease: 'power2.in' }, '+=0.15')
    .to('.loader', { yPercent: -100, duration: reduced ? 0 : 1.1, ease: 'expo.inOut' }, '<0.2')
    .set('.loader', { display: 'none' })
    .to(heroSplit.chars, { yPercent: 0, '--w': 112, duration: 1.3, ease: 'expo.out', stagger: 0.035 }, '-=0.55')
    .to(['.hero__lede', '.hero__hint', '.meter'], { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.1 }, '-=0.95')
    .to('.nav', { opacity: 1, duration: 0.8 }, '<');
});

window.addEventListener('load', measure);

if (import.meta.env.DEV) {
  window.__kaide = {
    world,
    lenis,
    ready: worldReady,
    // jump the page and the camera straight to a journey position
    go(t) {
      lenis.start();
      document.documentElement.classList.remove('lenis-stopped');
      window.scrollTo(0, scrollForT(t));
      lenis.scrollTo(scrollForT(t), { immediate: true, force: true });
      world?.jump(t);
      render(t);
    },
  };
}
