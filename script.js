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










const skyRT = new THREE.WebGLCubeRenderTarget(128, {
  type: THREE.HalfFloatType
});
skyRT.texture.minFilter = THREE.LinearMipmapLinearFilter;
skyRT.texture.generateMipmaps = true;
const skyCam = new THREE.CubeCamera(1, 40000, skyRT);



const SKYFOG_U = {
  value: skyRT.texture
};
THREE.Material.prototype.onBeforeCompile = function(shader) {
  shader.uniforms.fogSky = SKYFOG_U;
};

function fogPatch(fn) {
  return function(shader, r) {
    shader.uniforms.fogSky = SKYFOG_U;
    fn.call(this, shader, r);
  };
}
THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3  vFogView;
#endif`;
THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogView  = mvPosition.xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3  fogColor;
  uniform samplerCube fogSky;
  varying float vFogDepth;
  varying vec3  vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  
  vec3 fdir = normalize( vFogView * mat3( viewMatrix ) );
  fdir.y = max( fdir.y, -0.03 );        
  vec3 fcol = mix( fogColor, textureCube( fogSky, normalize(fdir) ).rgb, 0.86 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fcol, fogFactor );
#endif`;




const PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k';
const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');

let pendingTex = 0,
  doneTex = 0;
const loadFill = document.getElementById('loadFill');

function texProgress() {
  if (!pendingTex) return;
  loadFill.style.width = Math.round(100 * doneTex / pendingTex) + '%';
}


function streamMap(slug, kind, colorSpace, apply) {
  pendingTex++;
  texLoader.load(`${PH}/${slug}/${slug}_${kind}_1k.jpg`,
    t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = MAXANISO;
      if (colorSpace) t.colorSpace = colorSpace;
      apply(t);
      doneTex++;
      texProgress();
    },
    undefined,
    () => {
      doneTex++;
      texProgress();
    }
  );
}

function canvasTex(w, h, draw, {
  srgb = true,
  repeat = true,
  aniso = true
} = {}) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (aniso) t.anisotropy = MAXANISO;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}


const asphaltFallback = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#2b2b2e';
  g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h),
    d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = (hashI(x * 3 + 1, y * 3 + 7) + hashI(x * 7, y * 5) * 0.6) / 1.6;
      const v = 30 + n * 36;
      d[i] = v;
      d[i + 1] = v + 1;
      d[i + 2] = v + 3;
    }
  g.putImageData(img, 0, 0);
});


const ROAD_HALF = 4.6;
const MARK_TILE = 16;
const markingsTex = canvasTex(1024, 2048, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const pxPerM_x = w / (ROAD_HALF * 2);
  const pxPerM_y = h / MARK_TILE;
  const cx = w / 2;


  for (const off of [-1.75, 1.75]) {
    const x = cx + off * pxPerM_x,
      wdt = 0.95 * pxPerM_x;
    const grd = g.createLinearGradient(x - wdt, 0, x + wdt, 0);
    grd.addColorStop(0, 'rgba(10,10,12,0)');
    grd.addColorStop(.5, 'rgba(10,10,12,.30)');
    grd.addColorStop(1, 'rgba(10,10,12,0)');
    g.fillStyle = grd;
    g.fillRect(x - wdt, 0, wdt * 2, h);
  }


  function paint(x0, y0, x1, y1) {
    g.fillStyle = 'rgba(232,231,222,0.95)';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);

    const n = Math.max(2, Math.round((y1 - y0) / 9));
    for (let i = 0; i < n; i++) {
      const yy = y0 + (y1 - y0) * i / n;
      const hh = (y1 - y0) / n;
      g.fillStyle = `rgba(20,20,22,${0.06+hashI(i*13,x0|0)*0.16})`;
      if (hashI(i * 7, (x0 | 0) + 3) > 0.62) g.fillRect(x0, yy, x1 - x0, hh * 0.6);
    }
  }


  const edgeW = 0.15 * pxPerM_x;
  for (const off of [-3.95, 3.95]) {
    const x = cx + off * pxPerM_x;
    paint(x - edgeW / 2, 0, x + edgeW / 2, h);
  }


  const cW = 0.16 * pxPerM_x;
  for (let k = 0; k < 2; k++) {
    const y0 = (k * 8) * pxPerM_y,
      y1 = (k * 8 + 4) * pxPerM_y;
    paint(cx - cW / 2, y0, cx + cW / 2, y1);
  }


  g.strokeStyle = 'rgba(12,12,14,.42)';
  g.lineWidth = 1.6;
  for (let i = 0; i < 26; i++) {
    let x = hashI(i, 91) * w,
      y = hashI(i, 17) * h;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      x += (hashI(i * 31 + s, 5) - 0.5) * 46;
      y += (hashI(i * 31 + s, 9) - 0.5) * 74;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}, {
  srgb: true
});
markingsTex.wrapS = THREE.ClampToEdgeWrapping;
markingsTex.wrapT = THREE.RepeatWrapping;


function groundFallback(base, spread, seedo) {
  return canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h),
      d = img.data;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = fbm(x * 0.09 + seedo, y * 0.09 + seedo, 4) * 0.5 + 0.5;
        const m = hashI(x + seedo, y * 3 + seedo);
        d[i] = clamp(base[0] + (n - 0.5) * spread + (m - 0.5) * 16, 0, 255);
        d[i + 1] = clamp(base[1] + (n - 0.5) * spread + (m - 0.5) * 16, 0, 255);
        d[i + 2] = clamp(base[2] + (n - 0.5) * spread * 0.6 + (m - 0.5) * 12, 0, 255);
        d[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  });
}
const grassFallback = groundFallback([74, 88, 48], 46, 3.1);
const rockFallback = groundFallback([104, 99, 92], 40, 11.7);
const barkFallback = groundFallback([70, 56, 44], 34, 21.3);


const softSprite = canvasTex(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(.32, 'rgba(255,255,255,.62)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
}, {
  repeat: false
});




const RD = {
  step: 3,
  half: ROAD_HALF,
  verge: 6.5,
  apron: 20,
  behind: 420,
  ahead: 1500,
};


function curvatureAt(s) {



  let k = 0.00268 * Math.sin(s * 0.001710 + 0.00) +
    0.00162 * Math.sin(s * 0.004170 + 2.10) +
    0.00091 * Math.sin(s * 0.009540 + 4.30) +
    0.00042 * Math.sin(s * 0.023100 + 1.20);

  const per = 1750,
    idx = Math.floor(s / per);
  for (const j of [idx - 1, idx]) {
    if (j < 0) continue;
    const c = j * per + 320 + hash1(j * 7 + 3) * (per - 760);
    const hl = 52 + hash1(j * 13 + 5) * 26;
    const d = (s - c) / hl;
    if (Math.abs(d) < 1) {
      const wgt = Math.cos(d * Math.PI * 0.5);
      k += (hash1(j * 29 + 11) > 0.5 ? 1 : -1) * wgt * wgt * 0.0155;
    }
  }
  return k;
}

function elevAt(s) {
  return 24.0 * Math.sin(s * 0.001130 + 0.70) +
    12.5 * Math.sin(s * 0.002690 + 2.90) +
    5.2 * Math.sin(s * 0.006310 + 1.10) +
    1.9 * Math.sin(s * 0.015400 + 3.70);
}

function bankAt(k) {
  return -clamp(k * 8.2, -0.155, 0.155);
}


const path = {
  s: [],
  x: [],
  z: [],
  y: [],
  h: [],
  k: [],
  b: [],
  s0: 0,
  i0: 0,
  coarse: [],
};

function pathReset() {