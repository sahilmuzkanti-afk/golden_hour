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
  path.s.length = path.x.length = path.z.length = path.y.length = 0;
  path.h.length = path.k.length = path.b.length = 0;
  path.coarse.length = 0;
  let s = -RD.behind - 60,
    hh = 0;


  let x = 0,
    z = 0;
  s = -RD.behind - 60;
  hh = 0;
  x = 0;
  z = 0;

  const n0 = Math.round((0 - s) / RD.step);
  for (let i = 0; i <= n0; i++) {
    const ss = s + i * RD.step;
    pushSample(ss, x, z, hh);
    const k = curvatureAt(ss);
    hh += k * RD.step;
    x += Math.sin(hh) * RD.step;
    z += Math.cos(hh) * RD.step;
  }
  path.headS = path.s[path.s.length - 1];
  path.headX = x;
  path.headZ = z;
  path.headH = hh;
}

function pushSample(ss, x, z, hh) {
  const k = curvatureAt(ss);
  path.s.push(ss);
  path.x.push(x);
  path.z.push(z);
  path.y.push(elevAt(ss));
  path.h.push(hh);
  path.k.push(k);
  path.b.push(bankAt(k));
  if (path.coarse.length === 0 || ss - path.coarse[path.coarse.length - 1].s >= 60) {
    path.coarse.push({
      s: ss,
      x: x,
      z: z
    });
  }
}

function pathExtendTo(sTarget) {
  while (path.headS < sTarget) {
    const k = curvatureAt(path.headS);
    path.headH += k * RD.step;
    path.headX += Math.sin(path.headH) * RD.step;
    path.headZ += Math.cos(path.headH) * RD.step;
    path.headS += RD.step;
    pushSample(path.headS, path.headX, path.headZ, path.headH);
  }
}

function pathTrimTo(sMin) {
  let n = 0;
  while (path.s.length - n > 8 && path.s[n] < sMin) n++;
  if (n > 0) {
    path.s.splice(0, n);
    path.x.splice(0, n);
    path.z.splice(0, n);
    path.y.splice(0, n);
    path.h.splice(0, n);
    path.k.splice(0, n);
    path.b.splice(0, n);
    path.i0 += n;
  }
}

const _fr = {
  x: 0,
  y: 0,
  z: 0,
  h: 0,
  k: 0,
  b: 0
};

function frameAt(s) {
  const n = path.s.length;
  let i = Math.floor((s - path.s[0]) / RD.step);
  i = clamp(i, 0, n - 2);
  const t = clamp((s - path.s[i]) / RD.step, 0, 1);

  _fr.x = lerp(path.x[i], path.x[i + 1], t);
  _fr.z = lerp(path.z[i], path.z[i + 1], t);
  _fr.y = elevAt(s);
  _fr.h = lerp(path.h[i], path.h[i + 1], t);
  _fr.k = curvatureAt(s);
  _fr.b = bankAt(_fr.k);
  return _fr;
}

function roadToWorld(s, n, out) {
  const f = frameAt(s);
  const cs = Math.cos(f.h),
    sn = Math.sin(f.h);
  out.x = f.x + cs * n;
  out.z = f.z - sn * n;
  out.y = roadSurfaceY(f, n);
  return out;
}

function roadSurfaceY(f, n) {
  const an = Math.abs(n);
  let y = f.y + n * f.b;
  y -= Math.pow(Math.min(an, RD.half) / RD.half, 2) * 0.075;
  if (an > RD.half) y -= Math.min(an - RD.half, 1.9) * 0.16;
  return y;
}




const CELL = 24;
const roadGrid = new Map();
const gkey = (cx, cz) => cx * 73856093 ^ cz * 19349663;
let gridBuiltTo = -1e9,
  gridBuiltFrom = 1e9;

function gridInsert(i) {
  const cx = Math.floor(path.x[i] / CELL),
    cz = Math.floor(path.z[i] / CELL);
  const k = gkey(cx, cz);
  let a = roadGrid.get(k);
  if (!a) {
    a = [];
    roadGrid.set(k, a);
  }
  a.push(i + path.i0);
}

function gridRebuild() {
  roadGrid.clear();
  for (let i = 0; i < path.s.length; i++) gridInsert(i);
  gridBuiltFrom = path.s[0];
  gridBuiltTo = path.s[path.s.length - 1];
}

const _q = {
  d: Infinity,
  y: 0,
  s: 0
};

function nearestRoad(x, z, maxD) {
  const R = Math.ceil(maxD / CELL);
  const cx = Math.floor(x / CELL),
    cz = Math.floor(z / CELL);
  let bd = maxD * maxD,
    bi = -1;
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++) {
      const a = roadGrid.get(gkey(cx + dx, cz + dz));
      if (!a) continue;
      for (let n = 0; n < a.length; n++) {
        const i = a[n] - path.i0;
        if (i < 0 || i >= path.s.length) continue;
        const ddx = path.x[i] - x,
          ddz = path.z[i] - z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < bd) {
          bd = d2;
          bi = i;
        }
      }
    }
  if (bi < 0) {
    _q.d = Infinity;
    return _q;
  }
  _q.d = Math.sqrt(bd);
  _q.y = path.y[bi];
  _q.s = path.s[bi];
  return _q;
}

function corridorDist(x, z) {
  const c = path.coarse;
  if (!c.length) return 9999;
  let best = 1e18;
  for (let i = 0; i < c.length; i++) {
    const dx = c[i].x - x,
      dz = c[i].z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}




const CARVE_IN = 7.0,
  CARVE_OUT = RD.apron;

function naturalHeight(x, z, corr) {

  const detail = fbm(x * 0.0052, z * 0.0052, 4) * 8.2 +
    fbm(x * 0.0161, z * 0.0161, 3) * 2.3 +
    fbm(x * 0.0480, z * 0.0480, 2) * 0.62;



  const openness = fbm(x * 0.00105, z * 0.00105, 3) * 0.5 + 0.5;
  const wallAmp = 16 + 62 * (1 - openness) * (1 - openness);
  const wall = smooth(21, 175 + openness * 260, corr) * wallAmp;
  const wallRock = smooth(30, 150, corr) * ridged(x * 0.0072, z * 0.0072, 3) * 13 * (1 - openness);


  const mask = smooth(190, 1050, corr);
  const mtn = (ridged(x * 0.00040, z * 0.00040, 5) - 0.28) * 1150 * mask * mask;
  const big = fbm(x * 0.00092, z * 0.00092, 3) * 175 * mask;

  return detail * (0.85 + 1.05 * mask) + wall + wallRock + mtn + big;
}

function terrainHeight(x, z, corr) {
  const c = (corr === undefined) ? corridorDist(x, z) : corr;
  let h = naturalHeight(x, z, c);
  if (c < CARVE_OUT + 40) {
    const q = nearestRoad(x, z, CARVE_OUT + 30);
    if (q.d < CARVE_OUT) {
      const w = 1 - smooth(CARVE_IN, CARVE_OUT, q.d);




      const ditch = -0.42 * Math.exp(-Math.pow((q.d - 12.0) / 4.2, 2));
      h = lerp(h, q.y + ditch - 0.30, w);
    }
  }
  return h;
}





const roadMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.86,
  metalness: 0.0,
  map: asphaltFallback,
  envMapIntensity: 0.34,
});
roadMat.map.repeat.set((RD.half * 2) / 3.2, MARK_TILE / 3.2);
roadMat.onBeforeCompile = fogPatch(sh => {
  sh.uniforms.uMark = {
    value: markingsTex
  };
  sh.uniforms.uWet = {
    value: 0.0
  };
  roadMat.userData.sh = sh;
  sh.vertexShader = 'varying vec2 vRUv;\n' + sh.vertexShader.replace(
    '#include <uv_vertex>', '#include <uv_vertex>\n vRUv = uv;');
  sh.fragmentShader = 'uniform sampler2D uMark;\nuniform float uWet;\nvarying vec2 vRUv;\nfloat _mk;\n' +
    sh.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>
      vec4 mk = texture2D(uMark, vRUv);
      _mk = mk.a;
      
      diffuseColor.rgb *= mix(1.0, 0.62, mk.a * (1.0 - dot(mk.rgb, vec3(0.4))));
      diffuseColor.rgb = mix(diffuseColor.rgb, mk.rgb * 0.92, mk.a * smoothstep(0.35,0.7,dot(mk.rgb,vec3(0.34))));
    `)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.52, _mk*0.7);
      roughnessFactor = mix(roughnessFactor, 0.12, uWet);
    `);
});
roadMat.customProgramCacheKey = () => 'road-mark';
streamMap('asphalt_02', 'diff', THREE.SRGBColorSpace, t => {
  t.repeat.copy(roadMat.map.repeat);
  roadMat.map = t;
  roadMat.needsUpdate = true;
});
streamMap('asphalt_02', 'nor_gl', null, t => {
  t.repeat.copy(roadMat.map.repeat);
  roadMat.normalMap = t;
  roadMat.normalScale.set(0.85, 0.85);
  roadMat.needsUpdate = true;
});
streamMap('asphalt_02', 'rough', null, t => {
  t.repeat.copy(roadMat.map.repeat);
  roadMat.roughnessMap = t;
  roadMat.needsUpdate = true;
});


const vergeMat = new THREE.MeshStandardMaterial({
  color: 0xa89880,
  roughness: 0.98,
  metalness: 0,
  map: rockFallback,
  envMapIntensity: 0.4
});
vergeMat.map.repeat.set(3, 3);
streamMap('coast_sand_rocks_02', 'diff', THREE.SRGBColorSpace, t => {
  t.repeat.set(1.6, 1.6);
  vergeMat.map = t;
  vergeMat.color.setHex(0xffffff);
  vergeMat.needsUpdate = true;
});
streamMap('coast_sand_rocks_02', 'nor_gl', null, t => {
  t.repeat.set(1.6, 1.6);
  vergeMat.normalMap = t;
  vergeMat.needsUpdate = true;
});


function makeTerrainMat() {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0.0,
    map: grassFallback,
    envMapIntensity: 0.30,
    dithering: true
  });
  m.map.repeat.set(1, 1);
  m.onBeforeCompile = fogPatch(sh => {
    sh.uniforms.tRock = {
      value: TER.rockMap
    };
    sh.uniforms.uSnow = {
      value: new THREE.Color(0xd9e2ee)
    };
    sh.uniforms.uGrass = {
      value: new THREE.Color(0xffffff)
    };
    m.userData.sh = sh;
    sh.vertexShader = 'attribute float aRock;\nattribute float aSnow;\nvarying float vRock;\nvarying float vSnow;\nvarying vec2 vWXZ;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vRock = aRock; vSnow = aSnow;
        vWXZ = (modelMatrix * vec4(transformed,1.0)).xz;`);
    sh.fragmentShader = 'uniform sampler2D tRock;\nuniform vec3 uSnow;\nuniform vec3 uGrass;\nvarying float vRock;\nvarying float vSnow;\nvarying vec2 vWXZ;\n' +
      sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec3 cg = texture2D(map, vWXZ * 0.052).rgb * uGrass;
        vec3 cg2= texture2D(map, vWXZ * 0.0121).rgb;
        cg = cg * (0.55 + 0.9*cg2);                       
        vec3 cr = texture2D(tRock, vWXZ * 0.021).rgb;
        vec3 base = mix(cg, cr*1.05, vRock);
        
        
        float bio = texture2D(map, vWXZ * 0.00042).r;
        float bio2= texture2D(map, vWXZ * 0.00131).g;
        vec3 lush = base * vec3(0.70, 1.00, 0.60);
        
        
        vec3 dry  = base * vec3(1.08, 1.00, 0.78);
        vec3 ash  = base * vec3(0.86, 0.83, 0.84);
        base = mix(base, lush, smoothstep(0.26, 0.66, bio)*0.92);
        base = mix(base, dry , smoothstep(0.58, 0.20, bio)*0.52);
        base = mix(base, ash , smoothstep(0.58, 0.86, bio2)*0.45);
        base = mix(base, uSnow, vSnow);
        diffuseColor.rgb *= base;`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = mix(0.98, 0.86, vRock);
        roughnessFactor = mix(roughnessFactor, 0.72, vSnow);`)





      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_FOG
          float bAtt = 1.0 - smoothstep(60.0, 340.0, vFogDepth);
        #else
          float bAtt = 1.0;
        #endif
        if(bAtt > 0.004){
          const vec3 LW = vec3(0.299, 0.587, 0.114);
          vec2 uvB = vWXZ * 0.052;
          float e  = 0.055;
          float h0 = dot(texture2D(map, uvB).rgb, LW);
          float hx = dot(texture2D(map, uvB + vec2(e, 0.0)).rgb, LW);
          float hz = dot(texture2D(map, uvB + vec2(0.0, e)).rgb, LW);
          vec3 dW  = vec3(h0 - hx, 0.0, h0 - hz) * (mix(3.4, 1.5, vRock) * bAtt);
          normal   = normalize(normal + (viewMatrix * vec4(dW, 0.0)).xyz);
        }`);
  });
  m.customProgramCacheKey = () => 'terr-blend';
  return m;
}
const TER = {
  rockMap: rockFallback
};
const terrainMat = makeTerrainMat();
streamMap('aerial_grass_rock', 'diff', THREE.SRGBColorSpace, t => {
  terrainMat.map = t;
  terrainMat.needsUpdate = true;
  if (terrainMat.userData.sh) terrainMat.userData.sh.uniforms.map = {
    value: t
  };
});
streamMap('aerial_grass_rock', 'nor_gl', null, t => {
  t.repeat.set(26, 26);
  terrainMat.normalMap = t;
  terrainMat.normalScale.set(0.7, 0.7);
  terrainMat.needsUpdate = true;
});
streamMap('rock_face_03', 'diff', THREE.SRGBColorSpace, t => {
  TER.rockMap = t;
  if (terrainMat.userData.sh) terrainMat.userData.sh.uniforms.tRock.value = t;
});


const farTerrainMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.99,
  metalness: 0,
  envMapIntensity: 0.26,
  dithering: true
});




const CHUNK_SAMPLES = 24;
const CHUNK_LEN = CHUNK_SAMPLES * RD.step;
const roadGroup = new THREE.Group();
scene.add(roadGroup);


const PROF_ROAD = [];
for (let i = 0; i <= 10; i++) PROF_ROAD.push(-RD.half + (RD.half * 2) * i / 10);
const PROF_VERGE = [RD.half, RD.half + 0.9, RD.verge];
const PROF_APRON = [RD.verge, 8.4, 10.8, 14, 17, RD.apron];

const guardMat = new THREE.MeshStandardMaterial({
  color: 0x9aa1a8,
  roughness: 0.58,
  metalness: 0.82,
  envMapIntensity: 0.52
});
const postMat = new THREE.MeshStandardMaterial({
  color: 0x6d7278,
  roughness: 0.6,
  metalness: 0.85,
  envMapIntensity: 0.8
});

function buildRibbon(sStart, offs, uvMode) {
  const rows = CHUNK_SAMPLES + 1,
    cols = offs.length;
  const pos = new Float32Array(rows * cols * 3);
  const nor = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const idx = [];
  const P = {
    x: 0,
    y: 0,
    z: 0
  };
  for (let r = 0; r < rows; r++) {
    const s = sStart + r * RD.step;
    const f = frameAt(s);
    const cs = Math.cos(f.h),
      sn = Math.sin(f.h);
    for (let c = 0; c < cols; c++) {
      const n = offs[c];
      const i3 = (r * cols + c) * 3,
        i2 = (r * cols + c) * 2;
      let y;
      if (uvMode === 2) {
        const w = 1 - smooth(CARVE_IN, CARVE_OUT, Math.abs(n));
        const wx = f.x + cs * n,
          wz = f.z - sn * n;
        const nat = naturalHeight(wx, wz, corridorDist(wx, wz));
        const ditch = -0.9 * Math.exp(-Math.pow((Math.abs(n) - 8.2) / 3.4, 2));
        y = lerp(nat, f.y + n * f.b + ditch - 0.30, w) - 0.02;
      } else {
        y = roadSurfaceY(f, n);
      }
      pos[i3] = f.x + cs * n;
      pos[i3 + 1] = y;
      pos[i3 + 2] = f.z - sn * n;
      if (uvMode === 0) {
        uv[i2] = (n + RD.half) / (RD.half * 2);
        uv[i2 + 1] = s / MARK_TILE;
      } else {
        uv[i2] = n / 4.0;
        uv[i2 + 1] = s / 4.0;
      }
    }
  }
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c,
        b = a + 1,
        d = a + cols,
        e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildGuard(sStart, sideSign) {

  const prof = [
    [0.44, 0.0],
    [0.53, 0.055],
    [0.63, 0.018],
    [0.73, 0.055],
    [0.82, 0.0]
  ];
  const rows = CHUNK_SAMPLES + 1,
    cols = prof.length;
  const pos = new Float32Array(rows * cols * 3),
    idx = [];
  const nOff = sideSign * (RD.verge - 0.35);
  for (let r = 0; r < rows; r++) {
    const s = sStart + r * RD.step;
    const f = frameAt(s);
    const cs = Math.cos(f.h),
      sn = Math.sin(f.h);
    const baseY = roadSurfaceY(f, nOff);
    for (let c = 0; c < cols; c++) {
      const [hgt, out] = prof[c];
      const n = nOff + sideSign * out;
      const i3 = (r * cols + c) * 3;
      pos[i3] = f.x + cs * n;
      pos[i3 + 1] = baseY + hgt;
      pos[i3 + 2] = f.z - sn * n;
    }
  }
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c,
        b = a + 1,
        d = a + cols,
        e = d + 1;
      if (sideSign > 0) idx.push(a, d, b, b, d, e);
      else idx.push(a, b, d, b, e, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const postGeo = new THREE.BoxGeometry(0.11, 1.0, 0.16);

const roadChunks = new Map();

function chunkIndexOf(s) {
  return Math.floor(s / CHUNK_LEN);
}

function makeRoadChunk(ci) {
  const s0 = ci * CHUNK_LEN;
  const grp = new THREE.Group();

  const mRoad = new THREE.Mesh(buildRibbon(s0, PROF_ROAD, 0), roadMat);
  mRoad.receiveShadow = true;
  mRoad.name = 'road';
  grp.add(mRoad);

  for (const sgn of [-1, 1]) {
    const offs = PROF_VERGE.map(v => v * sgn);
    if (sgn < 0) offs.reverse();
    const mv = new THREE.Mesh(buildRibbon(s0, offs, 1), vergeMat);
    mv.receiveShadow = true;
    mv.name = 'verge';
    grp.add(mv);
    const offsA = PROF_APRON.map(v => v * sgn);
    if (sgn < 0) offsA.reverse();
    const ma = new THREE.Mesh(buildRibbon(s0, offsA, 2), terrainMat);
    ma.receiveShadow = true;
    ma.name = 'apron';
    grp.add(ma);
  }


  let kMax = 0,
    kSign = 0;
  for (let r = 0; r <= CHUNK_SAMPLES; r++) {
    const k = curvatureAt(s0 + r * RD.step);
    if (Math.abs(k) > Math.abs(kMax)) {
      kMax = k;
    }
  }
  if (Math.abs(kMax) > 0.0088) {
    kSign = kMax > 0 ? -1 : 1;
    const rail = new THREE.Mesh(buildGuard(s0, kSign), guardMat);
    rail.castShadow = true;
    rail.receiveShadow = true;
    rail.name = 'rail';
    grp.add(rail);
    const nPosts = Math.floor(CHUNK_LEN / 4);
    const posts = new THREE.InstancedMesh(postGeo, postMat, nPosts);
    posts.castShadow = true;
    const M = new THREE.Matrix4(),
      Q = new THREE.Quaternion(),
      E = new THREE.Euler();
    const V = new THREE.Vector3(),
      Sc = new THREE.Vector3(1, 1, 1);
    for (let p = 0; p < nPosts; p++) {
      const s = s0 + p * 4 + 2;
      const f = frameAt(s);
      const n = kSign * (RD.verge - 0.35);
      const cs = Math.cos(f.h),
        sn = Math.sin(f.h);
      V.set(f.x + cs * n, roadSurfaceY(f, n) + 0.42, f.z - sn * n);
      E.set(0, f.h, 0);
      Q.setFromEuler(E);
      M.compose(V, Q, Sc);
      posts.setMatrixAt(p, M);
    }
    posts.instanceMatrix.needsUpdate = true;
    posts.name = 'posts';
    grp.add(posts);
  }
  roadGroup.add(grp);
  return {
    grp
  };
}

function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
  });
  g.removeFromParent();
}




const RINGS = [{
    size: 110,
    seg: 30,
    seg0: 30,
    rad: 3,
    far: false,
    skirt: 6
  },
  {
    size: 380,
    seg: 20,
    seg0: 20,
    rad: 3,
    far: false,
    skirt: 40
  },
  {
    size: 1250,
    seg: 14,
    seg0: 14,
    rad: 3,
    far: true,
    skirt: 220
  },
];
const terrainGroup = new THREE.Group();
scene.add(terrainGroup);
const tiles = new Map();
const buildQueue = [];

function tileKey(r, tx, tz) {
  return r + ':' + tx + ':' + tz;
}

function buildTile(ring, tx, tz) {
  const R = RINGS[ring];
  const seg = R.seg,
    size = R.size;
  const ox = tx * size,
    oz = tz * size;
  const n = seg + 1;
  const total = n * n;
  const pos = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const aRock = new Float32Array(total);
  const aSnow = new Float32Array(total);
  const col = R.far ? new Float32Array(total * 3) : null;
  const idx = [];
  const hs = new Float32Array(total);

  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = ox + (i / seg) * size,
        z = oz + (j / seg) * size;
      const corr = corridorDist(x, z);
      const h = R.far ? naturalHeight(x, z, corr) : terrainHeight(x, z, corr);
      hs[k] = h;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      uv[k * 2] = x / 12;
      uv[k * 2 + 1] = z / 12;
    }

  const cellW = size / seg;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const hL = hs[j * n + Math.max(0, i - 1)],
        hR = hs[j * n + Math.min(n - 1, i + 1)];
      const hD = hs[Math.max(0, j - 1) * n + i],
        hU = hs[Math.min(n - 1, j + 1) * n + i];
      const gx = (hR - hL) / (2 * cellW),
        gz = (hU - hD) / (2 * cellW);
      const slope = Math.sqrt(gx * gx + gz * gz);
      const h = hs[k];
      const rk = smooth(0.38, 0.92, slope) * 0.94 + smooth(120, 300, h) * 0.5;
      const sn = smooth(255, 430, h) * (1 - smooth(0.95, 1.7, slope) * 0.75);
      aRock[k] = clamp(rk, 0, 1);
      aSnow[k] = clamp(sn, 0, 1);
      if (col) {
        const g = new THREE.Color();
        g.setRGB(0.085, 0.115, 0.055);
        const rock = new THREE.Color(0.135, 0.125, 0.115);
        const snow = new THREE.Color(0.80, 0.84, 0.90);
        g.lerp(rock, clamp(rk, 0, 1));
        g.lerp(snow, clamp(sn, 0, 1));
        col[k * 3] = g.r;
        col[k * 3 + 1] = g.g;
        col[k * 3 + 2] = g.b;
      }
    }
  for (let j = 0; j < seg; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * n + i,
        b = a + 1,
        c = a + n,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  else {
    g.setAttribute('aRock', new THREE.BufferAttribute(aRock, 1));
    g.setAttribute('aSnow', new THREE.BufferAttribute(aSnow, 1));
  }
  g.setIndex(idx);
  g.computeVertexNormals();

  const mesh = new THREE.Mesh(g, R.far ? farTerrainMat : terrainMat);
  mesh.receiveShadow = !R.far;
  mesh.userData.ring = ring;
  mesh.userData.seg = seg;
  mesh.userData.tx = tx;
  mesh.userData.tz = tz;
  mesh.userData.heights = hs;
  mesh.name = 'terrain' + ring;
  terrainGroup.add(mesh);
  return mesh;
}

function updateTiles(cx, cz) {
  const want = new Set();
  for (let r = 0; r < RINGS.length; r++) {
    const R = RINGS[r];
    const ctx = Math.floor(cx / R.size),
      ctz = Math.floor(cz / R.size);
    for (let dz = -R.rad; dz <= R.rad; dz++)
      for (let dx = -R.rad; dx <= R.rad; dx++) {
        const tx = ctx + dx,
          tz = ctz + dz;

        if (r > 0) {
          const F = RINGS[r - 1];
          const fx0 = Math.floor(cx / F.size) - F.rad,
            fx1 = Math.floor(cx / F.size) + F.rad;
          const fz0 = Math.floor(cz / F.size) - F.rad,
            fz1 = Math.floor(cz / F.size) + F.rad;
          const covX0 = fx0 * F.size,
            covX1 = (fx1 + 1) * F.size;
          const covZ0 = fz0 * F.size,
            covZ1 = (fz1 + 1) * F.size;
          if (tx * R.size >= covX0 && (tx + 1) * R.size <= covX1 &&
            tz * R.size >= covZ0 && (tz + 1) * R.size <= covZ1) continue;
        }
        const key = tileKey(r, tx, tz);
        want.add(key);
        if (!tiles.has(key)) {
          tiles.set(key, 'pending');
          buildQueue.push({
            r,
            tx,
            tz,
            key,
            d: Math.hypot((tx + 0.5) * R.size - cx, (tz + 0.5) * R.size - cz)
          });
        }
      }
  }
  for (const [key, m] of tiles) {
    if (!want.has(key)) {
      if (m !== 'pending') {
        m.geometry.dispose();
        m.removeFromParent();
        scatterDrop(key);
      }
      tiles.delete(key);
    }
  }
  buildQueue.sort((a, b) => a.d - b.d);
}




const scatterQueue = [];

function drainQueue(budget, scatterBudget) {
  let n = 0;
  while (buildQueue.length && n < budget) {
    const t = buildQueue.shift();
    const cur = tiles.get(t.key);


    if (t.replace ? (cur === undefined || cur === 'pending') : cur !== 'pending') continue;
    const mesh = buildTile(t.r, t.tx, t.tz);
    if (t.replace) {
      cur.geometry.dispose();
      cur.removeFromParent();
    }
    tiles.set(t.key, mesh);


    if (t.r === 0 && !t.replace) scatterQueue.push(t);
    n++;
  }
  const sb = scatterBudget === undefined ? budget : scatterBudget;
  let m = 0;
  while (scatterQueue.length && m < sb) {
    const t = scatterQueue.shift();
    if (!tiles.has(t.key)) continue;
    scatterTile(t.key, tiles.get(t.key), t.tx, t.tz, RINGS[0].size);
    m++;
  }
}





function mergeGeos(list) {
  let vc = 0,
    ic = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    vc += n;
    ic += g.index ? g.index.count : n;
  }
  const pos = new Float32Array(vc * 3),
    nor = new Float32Array(vc * 3),
    uv = new Float32Array(vc * 2);
  const idx = new Uint32Array(ic);
  let vo = 0,
    io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = i + vo;
      io += n;
    }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const trunkMat = new THREE.MeshStandardMaterial({
  color: 0x6a5342,
  roughness: 0.95,
  metalness: 0,
  map: barkFallback,
  envMapIntensity: 0.40
});
trunkMat.map.repeat.set(1, 2);
streamMap('bark_willow', 'diff', THREE.SRGBColorSpace, t => {
  t.repeat.set(1, 2);
  trunkMat.map = t;
  trunkMat.color.setHex(0xc8b49c);
  trunkMat.needsUpdate = true;
});









const LEAF_NEEDLE = 0,
  LEAF_BROAD = 1;
const leafAtlas = canvasTex(512, 256, (g, W, H) => {
  g.clearRect(0, 0, W, H);
  const w = W / 2,
    h = H;
  for (let s = 0; s < 26; s++) {
    const bx = 22 + hashI(s, 3) * (w - 44),
      by = h - 6 - hashI(s, 5) * 20;
    const len = h * (0.52 + hashI(s, 7) * 0.44),
      spread = 0.44 + hashI(s, 11) * 0.32;
    const tilt = (hashI(s, 13) - 0.5) * 0.66;
    for (let n = 0; n < 30; n++) {
      const t = n / 29,
        side = n % 2 ? 1 : -1;
      const ny = by - len * t;
      const nl = 15 * (1 - t * 0.70) * (0.68 + hashI(s * 31 + n, 17) * 0.64);
      g.strokeStyle = `hsla(${116+hashI(s*7+n,19)*28},${32+hashI(n,23)*22}%,${10+t*24}%,1)`;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(bx + tilt * len * t, ny);
      g.lineTo(bx + tilt * len * t + side * nl * spread, ny + nl * 0.5);
      g.stroke();
    }
  }




  for (let s = 0; s < 150; s++) {
    const ang = hashI(s, 41) * Math.PI * 2;
    const rad = Math.pow(hashI(s, 43), 0.62) * 0.46;
    const cx = w * 1.5 + Math.cos(ang) * rad * w,
      cy = h * 0.5 + Math.sin(ang) * rad * h;
    const rx = 7 + hashI(s, 7) * 13,
      ry = rx * (0.44 + hashI(s, 11) * 0.34);
    const lum = 17 + hashI(s, 17) * 32;
    g.save();
    g.translate(cx, cy);
    g.rotate(hashI(s, 13) * Math.PI * 2);
    const grd = g.createLinearGradient(-rx, 0, rx, 0);
    grd.addColorStop(0, `hsla(${94+hashI(s,19)*30},${26+hashI(s,23)*26}%,${lum}%,1)`);
    grd.addColorStop(1, `hsla(${86+hashI(s,29)*30},${30+hashI(s,31)*24}%,${lum+13}%,1)`);
    g.fillStyle = grd;

    g.beginPath();
    g.moveTo(-rx, 0);
    g.quadraticCurveTo(0, -ry, rx, 0);
    g.quadraticCurveTo(0, ry, -rx, 0);
    g.fill();
    g.restore();
  }
}, {
  repeat: false
});















const AA_ALPHA = `
  #ifdef USE_ALPHATEST
    float aaCov = (diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) + 0.5;
    if(aaCov < 0.03) discard;
    





    diffuseColor.a = diffuseColor.a > alphaTest + 0.25 ? 1.0 : min(aaCov, 1.0);
  #endif`;

function softCutout(mat, extraPatch) {




  mat.transparent = true;
  mat.depthWrite = true;
  mat.onBeforeCompile = fogPatch(sh => {
    if (extraPatch) extraPatch(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', AA_ALPHA);
  });
  mat.needsUpdate = true;
}


function leafUV(g, half) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + half * 0.5);
  uv.needsUpdate = true;
  return g;
}

const leafMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: leafAtlas,
  roughness: 0.93,
  metalness: 0,
  envMapIntensity: 0.46,
  alphaTest: 0.42,
  side: THREE.DoubleSide
});
const leafPatch = sh => {
  sh.uniforms.uTime = {
    value: 0
  };
  sh.uniforms.uSunDir = {
    value: new THREE.Vector3(0, 1, 0)
  };
  sh.uniforms.uSunCol = {
    value: new THREE.Color(0, 0, 0)
  };
  leafMat.userData.sh = sh;
  sh.vertexShader = 'uniform float uTime;\nvarying float vCanY;\nvarying vec3 vObj;\nvarying vec3 vWPos;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x*0.6 + instanceMatrix[3].z*0.4;
      #else
        float ph = 0.0;
      #endif
      float hgt = max(position.y, 0.0);
      vCanY = clamp(hgt/7.0, 0.0, 1.0);
      vObj  = position;
      transformed.x += sin(uTime*1.05 + ph)*0.035*hgt;
      transformed.z += cos(uTime*0.83 + ph*1.3)*0.028*hgt;`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      #ifdef USE_INSTANCING
        vWPos = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
      #else
        vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;
      #endif`);

  sh.fragmentShader = 'varying float vCanY;\nvarying vec3 vObj;\nvarying vec3 vWPos;\n' +
    'uniform vec3 uSunDir;\nuniform vec3 uSunCol;\n' +
    'float lh3(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }\n' +
    `float vn3(vec3 p){
       vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
       float a=mix(lh3(i),             lh3(i+vec3(1,0,0)), f.x);
       float b=mix(lh3(i+vec3(0,1,0)), lh3(i+vec3(1,1,0)), f.x);
       float c=mix(lh3(i+vec3(0,0,1)), lh3(i+vec3(1,0,1)), f.x);
       float d=mix(lh3(i+vec3(0,1,1)), lh3(i+vec3(1,1,1)), f.x);
       return mix(mix(a,b,f.y), mix(c,d,f.y), f.z);
     }\n` +
    sh.fragmentShader.replace(
      '#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(0.42, 1.12, pow(vCanY, 0.85));
      





      
      
      float rad   = length(vObj.xz) * 0.40 + abs(vObj.y - 4.2) * 0.14;
      float clump = vn3(vObj * 1.7) * 0.62 + vn3(vObj * 5.1) * 0.38;
      if(clump < smoothstep(1.00, 1.55, rad) * 0.42) discard;`)
    .replace('#include <opaque_fragment>', `
      


      vec3 vDir = normalize(vWPos - cameraPosition);
      float back = pow(max(dot(vDir, -uSunDir), 0.0), 3.4);
      outgoingLight += diffuseColor.rgb * uSunCol * back * 2.6 * (0.35 + 0.65*vCanY);
      #include <opaque_fragment>`);
};
softCutout(leafMat, leafPatch);
leafMat.customProgramCacheKey = () => 'leaf-sway';





function roughen(g, amp, freq, seed) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const r = Math.hypot(x, z);
    const n = vnoise(x * freq + seed, z * freq - seed) + 0.5 * vnoise(y * freq * 1.7 - seed, x * freq * 1.7 + seed);
    const k = 1 + n * amp;
    p.setXYZ(i, x * k, y * (1 + n * amp * 0.35), z * k);
    if (r < 1e-4) p.setXYZ(i, x, y * (1 + n * amp * 0.5), z);
  }
  g.computeVertexNormals();
  return g;
}



function canopyNormals(g, cy, upBias) {
  const p = g.attributes.position,
    n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i),
      y = p.getY(i) - cy,
      z = p.getZ(i);
    const L = Math.hypot(x, y, z) || 1;
    x /= L;
    y /= L;
    z /= L;
    y += upBias;
    const M = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / M, y / M, z / M);
  }
  n.needsUpdate = true;
  return g;
}


const G_trunk_pine = (() => {
  const g = new THREE.CylinderGeometry(0.09, 0.27, 2.6, 6, 1, true);
  g.translate(0, 1.3, 0);
  return g;
})();
const G_leaf_pine = (() => {
  const l = [];


  const spec = [
    [1.85, 2.05],
    [2.85, 1.86],
    [3.80, 1.55],
    [4.65, 1.20],
    [5.35, 0.84],
    [5.95, 0.48]
  ];
  let k = 0;
  for (const [y, r] of spec) {


    const cnt = Math.max(5, Math.round(r * 5.2));
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * TAU + k * 0.83 + hash1(k * 31 + i * 7) * 0.55;
      const s = r * (1.54 + hash1(k * 17 + i * 3) * 0.46);
      const q = leafUV(new THREE.PlaneGeometry(s, s * 0.80), LEAF_NEEDLE);
      q.rotateX(0.62 + hash1(k * 11 + i) * 0.30);
      q.rotateY(a);
      q.translate(Math.sin(a) * r * 0.52, y + (hash1(k * 23 + i) - 0.5) * 0.24, Math.cos(a) * r * 0.52);
      l.push(q);
    }
    k++;
  }
  return canopyNormals(mergeGeos(l), 3.6, 0.55);
})();
const G_trunk_oak = (() => {
  const l = [];
  const t = new THREE.CylinderGeometry(0.15, 0.36, 2.9, 6, 1, true);
  t.translate(0, 1.45, 0);
  l.push(t);
  for (const [a, ln] of [
      [0.7, 1.5],
      [2.5, 1.3],
      [4.6, 1.4]
    ]) {
    const b = new THREE.CylinderGeometry(0.07, 0.13, ln, 4, 1, true);
    b.translate(0, ln * 0.5, 0);
    b.rotateX(0.55);
    b.rotateY(a);
    b.translate(0, 2.5, 0);
    l.push(b);
  }
  return mergeGeos(l);
})();
const G_leaf_oak = (() => {
  const l = [];
  const CY = 4.25,
    RX = 2.95,
    RY = 1.95,
    RZ = 2.85;


  for (let i = 0; i < 58; i++) {
    const u = hash1(i * 7.1 + 3),
      v = hash1(i * 13.3 + 5),
      w = hash1(i * 19.7 + 11);
    const th = u * TAU,
      ph = Math.acos(2 * v - 1),
      rr = 0.46 + 0.54 * Math.sqrt(w);
    const x = Math.sin(ph) * Math.cos(th) * RX * rr;
    const y = Math.cos(ph) * RY * rr;
    const z = Math.sin(ph) * Math.sin(th) * RZ * rr;
    const s = 1.04 + hash1(i * 29.1 + 7) * 1.06;
    const q = leafUV(new THREE.PlaneGeometry(s, s * 0.86), LEAF_BROAD);
    q.rotateZ(hash1(i * 31.3 + 2) * TAU);
    q.rotateX((hash1(i * 37.7 + 4) - 0.5) * 2.4);
    q.rotateY(hash1(i * 41.9 + 6) * TAU);
    q.translate(x, CY + y, z);
    l.push(q);
  }
  return canopyNormals(mergeGeos(l), CY, 0.42);
})();
const G_rock = (() => {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const d = 0.68 + 0.5 * Math.abs(vnoise(x * 1.7 + 9, z * 1.7 + 3)) + 0.28 * Math.abs(vnoise(y * 2.3, x * 2.3));
    p.setXYZ(i, x * d, y * d * 0.68, z * d);
  }
  g.computeVertexNormals();
  return g;
})();
const rockMat = new THREE.MeshStandardMaterial({
  color: 0x8d8880,
  roughness: 0.94,
  metalness: 0,
  envMapIntensity: 0.30,
  map: rockFallback
});
rockMat.map.repeat.set(0.6, 0.6);
streamMap('rock_face_03', 'diff', THREE.SRGBColorSpace, t => {
  t.repeat.set(0.55, 0.55);
  rockMat.map = t;
  rockMat.color.setHex(0xffffff);
  rockMat.needsUpdate = true;
});
streamMap('rock_face_03', 'nor_gl', null, t => {
  t.repeat.set(0.55, 0.55);
  rockMat.normalMap = t;
  rockMat.needsUpdate = true;
});


const grassCardTex = canvasTex(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);


  for (let b = 0; b < 46; b++) {
    const x0 = 6 + hashI(b, 3) * (w - 12);
    const bw = 1.6 + hashI(b, 9) * 3.4;
    const bh = h * (0.36 + hashI(b, 17) * 0.60);
    const bend = (hashI(b, 23) - 0.5) * 44;
    const grd = g.createLinearGradient(0, h, 0, h - bh);
    const hue = 72 + hashI(b, 31) * 30;
    grd.addColorStop(0, `hsla(${hue},38%,20%,1)`);
    grd.addColorStop(0.55, `hsla(${hue+8},48%,40%,1)`);

    grd.addColorStop(1, `hsla(${hue+22},56%,63%,1)`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x0, h);
    g.quadraticCurveTo(x0 + bend * 0.5, h - bh * 0.6, x0 + bend + bw * 0.4, h - bh);
    g.quadraticCurveTo(x0 + bend * 0.5 + bw, h - bh * 0.6, x0 + bw, h);
    g.closePath();
    g.fill();
  }
}, {
  repeat: false
});
const grassMat = new THREE.MeshStandardMaterial({
  map: grassCardTex,
  color: 0xa9b477,
  alphaTest: 0.34,
  side: THREE.DoubleSide,
  alphaToCoverage: true,
  roughness: 0.92,
  metalness: 0,
  envMapIntensity: 0.30,
  depthWrite: true
});
grassMat.onBeforeCompile = fogPatch(sh => {
  sh.uniforms.uTime = {
    value: 0
  };
  grassMat.userData.sh = sh;
  sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x*0.9 + instanceMatrix[3].z*0.7;
      #else
        float ph = 0.0;
      #endif
      float hh = max(position.y,0.0);
      transformed.x += sin(uTime*2.1+ph)*0.16*hh;
      transformed.z += cos(uTime*1.7+ph*1.4)*0.11*hh;`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      



      objectNormal = normalize(mix(objectNormal, vec3(0.0,1.0,0.0), 0.78));`);
});
grassMat.customProgramCacheKey = () => 'grass-sway';
const G_grass = (() => {
  const a = new THREE.PlaneGeometry(0.78, 0.62);
  a.translate(0, 0.31, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2.6);
  const c = a.clone();
  c.rotateY(-Math.PI / 2.6);
  return mergeGeos([a, b, c]);
})();








const treeImpostor = canvasTex(512, 512, (g, W, H) => {
  g.clearRect(0, 0, W, H);
  const half = W / 2;

  (() => {
    const cx = half * 0.5,
      base = H * 0.985,
      top = H * 0.045,
      hgt = base - top;
    g.strokeStyle = '#3a2d20';
    g.lineWidth = half * 0.045;
    g.beginPath();
    g.moveTo(cx, base);
    g.lineTo(cx, top + hgt * 0.10);
    g.stroke();
    for (let tier = 0; tier < 13; tier++) {
      const t = tier / 12;
      const y = top + hgt * (0.06 + t * 0.92);
      const rad = half * 0.40 * Math.pow(t, 0.72) + half * 0.03;
      const dep = hgt * 0.11;


      for (let s = -1; s <= 1; s += 2) {
        g.beginPath();
        g.moveTo(cx, y - dep * 0.55);
        for (let i = 0; i <= 9; i++) {
          const u = i / 9;
          const jag = (hashI(tier * 17 + i, 5 + s) - 0.5) * rad * 0.22;
          g.lineTo(cx + s * (rad * u + jag), y + dep * u * (0.6 + hashI(tier + i, 9) * 0.7));
        }
        g.lineTo(cx, y + dep * 0.30);
        g.closePath();
        const l = 15 + t * 13 + hashI(tier, 3) * 7;
        g.fillStyle = `hsl(${112+hashI(tier,11)*22}, ${30+hashI(tier,13)*16}%, ${l}%)`;
        g.fill();
      }
    }
  })();

  (() => {
    const cx = half * 1.5,
      base = H * 0.985,
      hgt = H * 0.94;
    g.strokeStyle = '#41321f';
    g.lineCap = 'round';
    g.lineWidth = half * 0.055;
    g.beginPath();
    g.moveTo(cx, base);
    g.lineTo(cx, base - hgt * 0.40);
    g.stroke();
    for (const [a, ln] of [
        [-0.6, 0.30],
        [0.55, 0.34],
        [-0.25, 0.22],
        [0.22, 0.26]
      ]) {
      g.lineWidth = half * 0.028;
      g.beginPath();
      g.moveTo(cx, base - hgt * 0.38);
      g.lineTo(cx + Math.sin(a) * half * 0.34, base - hgt * (0.38 + ln));
      g.stroke();
    }
    const ccy = base - hgt * 0.66,
      rx = half * 0.44,
      ry = hgt * 0.30;
    for (let i = 0; i < 70; i++) {
      const ang = hashI(i, 29) * Math.PI * 2,
        rr = Math.pow(hashI(i, 31), 0.5);
      const x = cx + Math.cos(ang) * rr * rx,
        y = ccy + Math.sin(ang) * rr * ry;
      const r = half * (0.10 + hashI(i, 37) * 0.085) * (1.05 - rr * 0.35);

      const l = 13 + (1 - (y - (ccy - ry)) / (2 * ry)) * 15 + hashI(i, 41) * 9;
      g.fillStyle = `hsl(${96+hashI(i,43)*26}, ${28+hashI(i,47)*20}%, ${l}%)`;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.86, hashI(i, 53) * 3.14, 0, 6.2832);
      g.fill();
    }
  })();
});
treeImpostor.wrapS = treeImpostor.wrapT = THREE.ClampToEdgeWrapping;


function impostor(w, h, half, n) {
  const l = [];
  for (let i = 0; i < n; i++) {
    const q = leafUV(new THREE.PlaneGeometry(w, h), half);
    q.rotateY(i * Math.PI / n);
    q.translate(0, h * 0.5, 0);
    l.push(q);
  }
  const g = mergeGeos(l);



  const nor = g.attributes.normal,
    v = new THREE.Vector3();
  for (let i = 0; i < nor.count; i++) {
    v.set(nor.getX(i), nor.getY(i) + 1.15, nor.getZ(i)).normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}


const G_far_pine = impostor(4.2, 6.6, LEAF_NEEDLE, 2);
const G_far_oak = impostor(6.0, 6.6, LEAF_BROAD, 2);



const farTreeMat = new THREE.MeshStandardMaterial({
  map: treeImpostor,
  roughness: 0.95,
  metalness: 0,
  envMapIntensity: 0.42,
  alphaTest: 0.45,
  side: THREE.DoubleSide
});
softCutout(farTreeMat);
farTreeMat.customProgramCacheKey = () => 'far-tree-aa';

const CAP = {
  pineT: 1500,
  pineL: 1500,
  oakT: 800,
  oakL: 800,
  pineF: 5200,
  oakF: 2800,
  rock: 700,
  grass: 5200
};
const IM = {
  pineT: new THREE.InstancedMesh(G_trunk_pine, trunkMat, CAP.pineT),
  pineL: new THREE.InstancedMesh(G_leaf_pine, leafMat, CAP.pineL),
  oakT: new THREE.InstancedMesh(G_trunk_oak, trunkMat, CAP.oakT),
  oakL: new THREE.InstancedMesh(G_leaf_oak, leafMat, CAP.oakL),
  pineF: new THREE.InstancedMesh(G_far_pine, farTreeMat, CAP.pineF),
  oakF: new THREE.InstancedMesh(G_far_oak, farTreeMat, CAP.oakF),
  rock: new THREE.InstancedMesh(G_rock, rockMat, CAP.rock),
  grass: new THREE.InstancedMesh(G_grass, grassMat, CAP.grass),
};
for (const k in IM) {


  IM[k].castShadow = (k !== 'grass' && k !== 'pineF' && k !== 'oakF');
  IM[k].receiveShadow = (k !== 'pineF' && k !== 'oakF');
  IM[k].frustumCulled = false;
  IM[k].count = 0;
  IM[k].name = k;
  scene.add(IM[k]);
}


const _LC = new THREE.Color();

function leafTint(seed) {
  const r = hash1(seed * 53);


  const h = r < 0.14 ? 0.095 + hash1(seed * 13) * 0.055 :
    0.238 + (hash1(seed * 13) - 0.5) * 0.070;
  const s = 0.22 + hash1(seed * 29) * 0.22;
  const l = 0.165 + hash1(seed * 41) * 0.145;
  return _LC.setHSL(h, s, l);
}
const _RC = new THREE.Color();
for (const [k, n] of [
    ['pineL', CAP.pineL],
    ['oakL', CAP.oakL],
    ['pineF', CAP.pineF],
    ['oakF', CAP.oakF],
    ['rock', CAP.rock]
  ])
  IM[k].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
const scatterStore = new Map();






function canopyAt(s) {
  const a = Math.sin(s * 0.00430 + 0.7) * 0.55 +
    Math.sin(s * 0.00190 + 2.3) * 0.34 +
    Math.sin(s * 0.01040 + 4.1) * 0.12;
  return smooth(-0.30, 0.34, a);
}

function scatterTile(key, mesh, tx, tz, size) {
  const out = {
    pine: [],
    oak: [],
    rock: [],
    grass: []
  };


  const step = 4.6;
  const nS = Math.floor(size / step);
  for (let j = 0; j < nS; j++)
    for (let i = 0; i < nS; i++) {
      const seed = (tx * 7919 + tz * 104729 + i * 131 + j * 7);
      const jx = hash1(seed * 3 + 1),
        jz = hash1(seed * 3 + 2),
        pick = hash1(seed * 3 + 5);
      const x = tx * size + (i + jx) * step,
        z = tz * size + (j + jz) * step;
      const corr = corridorDist(x, z);
      if (corr > 340) continue;
      const q = nearestRoad(x, z, 70);
      const d = q.d;
      if (d < 8.6) continue;

      const can = canopyAt(q.s);
      const stand = fbm(x * 0.00135, z * 0.00135, 3) * 0.5 + 0.5;
      const clump = fbm(x * 0.0094, z * 0.0094, 2) * 0.5 + 0.5;


      const base = smooth(0.40, 0.58, stand) * smooth(0.20, 0.52, clump);


      const forest = base * lerp(0.42, 6.4, can);


      const nearOK = lerp(17.0, 8.2, can);