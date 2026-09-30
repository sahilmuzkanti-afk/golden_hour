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