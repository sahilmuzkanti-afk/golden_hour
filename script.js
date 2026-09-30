import * as THREE from 'three';
import {
  EffectComposer
} from 'three/addons/postprocessing/EffectComposer.js';
import {
  RenderPass
} from 'three/addons/postprocessing/RenderPass.js';
import {
  ShaderPass
} from 'three/addons/postprocessing/ShaderPass.js';
import {
  UnrealBloomPass
} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  OutputPass
} from 'three/addons/postprocessing/OutputPass.js';
import {
  Pass,
  FullScreenQuad
} from 'three/addons/postprocessing/Pass.js';
import {
  Sky
} from 'three/addons/objects/Sky.js';




const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));

function hashI(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash1(i) {
  let h = Math.imul(i | 0, 2654435761);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function vnoise(x, y) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = hashI(xi, yi),
    b = hashI(xi + 1, yi),
    c = hashI(xi, yi + 1),
    d = hashI(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}

function fbm(x, y, oct = 5, lac = 2.03, gain = 0.5) {
  let s = 0,
    a = 0.5,
    f = 1,
    n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    n += a;
    a *= gain;
    f *= lac;
  }
  return s / n;
}

function ridged(x, y, oct = 5) {
  let s = 0,
    a = 0.5,
    f = 1,
    n = 0;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(vnoise(x * f, y * f));
    v *= v;
    s += a * v;
    n += a;
    a *= 0.52;
    f *= 2.07;
  }
  return s / n;
}




const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  stencil: false,
  powerPreference: 'high-performance'
});
const DPR_CAP = 1.7;





const bufferSize = pr => [Math.max(2, Math.round(innerWidth * pr)),
  Math.max(2, Math.round(innerHeight * pr))
];
renderer.setPixelRatio(1);
renderer.setSize(...bufferSize(Math.min(devicePixelRatio || 1, DPR_CAP)), false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = true;
const MAXANISO = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe8a86c, 0.0018);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.4, 16000);
camera.position.set(0, 6, -12);


