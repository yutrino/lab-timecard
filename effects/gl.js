// 演出の舞台を WebGL（PixiJS）で描く。始める演出と、止める演出の全段階。
// 発光（ブルーム）、衝撃波のゆがみ、ズームブラー、カメラの寄り引き、当たる瞬間の一瞬の静止（ヒットストップ）を使う。

import { patternCanvas } from './patterns.js';

let modules = null;

export function loadGL() {
  modules ??= Promise.all([import('../vendor/pixi.min.mjs'), import('../vendor/pixi-filters.mjs')])
    .then(([PIXI, FILTERS]) => ({ PIXI, FILTERS }));
  return modules;
}

const FONT = '"Dela Gothic One", "Hiragino Sans", sans-serif';
// 演出で使う文字。index.html で読み込む書体の文字と合わせる
const GLYPHS = '押せ！おつかれさまナイス研究激アツ大当たり超リーチ再変動×スタート日連続0123456789分時間突破チャンス昇格結果発表合計月週STEP∞RUSHOND,全回転確定獲得発入中';
const TIER_COLOR = [0x3b82f6, 0x22c55e, 0xff2d3f, 0xffc400, 0xff4fd8];
const TIER_DARK = [0x0b2a7a, 0x064d22, 0x5a0010, 0x5a3a00, 0x3a0a6a];
const TIER_LIGHT = [0x9cc4ff, 0x8dffb8, 0xff9a9a, 0xfff1a8, 0xffffff];
const METAL = [
  ['#ffffff', '#cfe6ff', '#3d7dff', '#d8ecff', '#1746c4'],
  ['#ffffff', '#d4ffe2', '#22c55e', '#e0ffe9', '#0f7a39'],
  ['#ffffff', '#ffe066', '#ff3b3b', '#ffd6d6', '#a0001a'],
  ['#fffbe0', '#ffe066', '#d99a00', '#fff4b8', '#9a6400'],
];
const RAINBOW = ['#ff3b3b', '#ffb000', '#ffe600', '#2ee66b', '#2fa8ff', '#8b5cff', '#ff4fd8'];

const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = (k) => 1 - (1 - k) ** 3;
const easeIn = (k) => k ** 3;
const easeBack = (k) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;

// ---- 絵（canvas で作ってテクスチャにする） ----

function canvasTexture(PIXI, size, draw, h = size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  draw(c.getContext('2d'), size, h);
  return PIXI.Texture.from(c);
}

function makeTextures(PIXI) {
  return {
    dot: canvasTexture(PIXI, 64, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.25, 'rgba(255,255,255,0.8)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    }),
    ring: canvasTexture(PIXI, 256, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, s * 0.36, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,0)');
      r.addColorStop(0.5, 'rgba(255,255,255,1)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    }),
    rays: canvasTexture(PIXI, 1024, (g, s) => {
      g.translate(s / 2, s / 2);
      for (let i = 0; i < 24; i += 1) {
        g.rotate((Math.PI * 2) / 24);
        const lg = g.createLinearGradient(0, 0, s / 2, 0);
        lg.addColorStop(0, 'rgba(255,255,255,0.9)');
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = lg;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(s / 2, -s * 0.06);
        g.lineTo(s / 2, s * 0.06);
        g.closePath();
        g.fill();
      }
    }),
    shine: canvasTexture(PIXI, 512, (g, w, h) => {
      const lg = g.createLinearGradient(0, 0, w, 0);
      lg.addColorStop(0.35, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      lg.addColorStop(0.65, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.fillRect(0, 0, w, h);
    }, 128),
    glint: canvasTexture(PIXI, 128, (g, s) => {
      g.translate(s / 2, s / 2);
      for (const [w, l] of [[s * 0.05, s / 2], [s * 0.03, s * 0.3]]) {
        for (let i = 0; i < 2; i += 1) {
          g.rotate(i * Math.PI / 2 + (l < s / 2 ? Math.PI / 4 : 0));
          const lg = g.createLinearGradient(-l, 0, l, 0);
          lg.addColorStop(0, 'rgba(255,255,255,0)');
          lg.addColorStop(0.5, 'rgba(255,255,255,1)');
          lg.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = lg;
          g.fillRect(-l, -w / 2, l * 2, w);
        }
      }
      const r = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.15);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(-s / 2, -s / 2, s, s);
    }),
    coin: canvasTexture(PIXI, 96, (g, s) => {
      const c = s / 2;
      let r = g.createLinearGradient(0, 0, s, s);
      r.addColorStop(0, '#fff6c0');
      r.addColorStop(0.45, '#ffc400');
      r.addColorStop(1, '#8a5a00');
      g.fillStyle = r;
      g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
      r = g.createLinearGradient(s, s, 0, 0);
      r.addColorStop(0, '#fff6c0');
      r.addColorStop(0.5, '#e0a000');
      r.addColorStop(1, '#7a4a00');
      g.fillStyle = r;
      g.beginPath(); g.arc(c, c, c * 0.72, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath(); g.ellipse(c * 0.7, c * 0.62, c * 0.22, c * 0.12, -0.7, 0, Math.PI * 2); g.fill();
    }),
    bezel: canvasTexture(PIXI, 512, (g, s) => {
      const c = s / 2;
      const cg = g.createConicGradient(0, c, c);
      ['#ffffff', '#8a8f99', '#f5f7fa', '#5b616b', '#ffffff', '#9aa0aa', '#eef1f5', '#5b616b', '#ffffff']
        .forEach((col, i, a) => cg.addColorStop(i / (a.length - 1), col));
      g.fillStyle = cg;
      g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.arc(c, c, c * 0.8, 0, Math.PI * 2, true); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 4;
      g.beginPath(); g.arc(c, c, c * 0.8, 0, Math.PI * 2); g.stroke();
    }),
    dome: canvasTexture(PIXI, 512, (g, s) => {
      const c = s / 2;
      // 白で陰影だけを描き、色は tint で付ける
      let r = g.createRadialGradient(c * 0.8, c * 0.7, c * 0.05, c, c, c * 0.8);
      r.addColorStop(0, '#ffffff');
      r.addColorStop(0.45, '#d0d0d0');
      r.addColorStop(1, '#3a3a3a');
      g.fillStyle = r;
      g.beginPath(); g.arc(c, c, c * 0.8, 0, Math.PI * 2); g.fill();
      r = g.createLinearGradient(0, c * 0.25, 0, c);
      r.addColorStop(0, 'rgba(255,255,255,0.85)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.beginPath(); g.ellipse(c, c * 0.62, c * 0.52, c * 0.32, 0, 0, Math.PI * 2); g.fill();
    }),
    zebra: canvasTexture(PIXI, 256, (g) => g.drawImage(patternCanvas('zebra'), 0, 0)),
    kirin: canvasTexture(PIXI, 256, (g) => g.drawImage(patternCanvas('kirin'), 0, 0)),
    // 役物が当たった画面のひび。中心から割れが走り、輪の割れでつながる
    crack: canvasTexture(PIXI, 1024, (g, s) => {
      const c = s / 2;
      const arms = Array.from({ length: 18 }, (_, i) => (i / 18) * Math.PI * 2 + rand(-0.12, 0.12));
      const at = (a, r) => [c + Math.cos(a) * r, c + Math.sin(a) * r];
      const paths = arms.map((a) => {
        const pts = [[c, c]];
        for (let r = rand(10, 30); r < c * 0.98; r += rand(30, 80)) pts.push(at(a + rand(-0.08, 0.08), r));
        return pts;
      });
      for (const k of [0.1, 0.2, 0.34, 0.52, 0.74]) {
        arms.forEach((a, i) => {
          if (Math.random() < 0.35) return;
          const b = arms[(i + 1) % arms.length] + (i === arms.length - 1 ? Math.PI * 2 : 0);
          const pts = [];
          for (let j = 0; j <= 4; j += 1) pts.push(at(a + ((b - a) * j) / 4, c * k * rand(0.92, 1.08)));
          paths.push(pts);
        });
      }
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const [color, width] of [['rgba(0,0,0,0.55)', 7], ['rgba(255,255,255,0.95)', 2.6], ['rgba(200,230,255,0.9)', 1]]) {
        g.strokeStyle = color;
        g.lineWidth = width;
        for (const pts of paths) {
          g.beginPath();
          pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.stroke();
        }
      }
      const r = g.createRadialGradient(c, c, 0, c, c, c * 0.12);
      r.addColorStop(0, 'rgba(255,255,255,0.95)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    }),
    // パチンコ玉
    ball: canvasTexture(PIXI, 64, (g, s) => {
      const c = s / 2;
      const r = g.createRadialGradient(c * 0.7, c * 0.62, c * 0.05, c, c, c - 1);
      r.addColorStop(0, '#ffffff');
      r.addColorStop(0.35, '#d5d9e0');
      r.addColorStop(0.8, '#5b616b');
      r.addColorStop(1, '#2a2e35');
      g.fillStyle = r;
      g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fill();
    }),
    bg: canvasTexture(PIXI, 512, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, '#ffffff');
      r.addColorStop(0.35, '#555555');
      r.addColorStop(1, '#000000');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    }),
  };
}

// ---- 金属の文字（光彩・黒縁・色縁・金属の面・光の筋を重ねる） ----

function metalText(PIXI, FILTERS, renderer, tx, text, tier, size) {
  const box = new PIXI.Container();
  const style = { fontFamily: FONT, fontSize: size, fontStyle: 'italic', align: 'center', padding: size * 0.4 };
  const make = (extra) => {
    const t = new PIXI.Text({ text, style: { ...style, ...extra }, resolution: 2 });
    t.anchor.set(0.5);
    return t;
  };

  const glow = make({ fill: TIER_COLOR[tier], stroke: { color: TIER_COLOR[tier], width: size * 0.3, join: 'round' } });
  glow.filters = [new PIXI.BlurFilter({ strength: size * 0.16, quality: 4 })];
  glow.blendMode = 'add';
  glow.alpha = 0.9;

  const shadow = make({ fill: 0x000000, stroke: { color: 0x000000, width: size * 0.26, join: 'round' } });
  shadow.y = size * 0.07;
  const edge = make({ fill: TIER_DARK[tier], stroke: { color: TIER_DARK[tier], width: size * 0.17, join: 'round' } });
  const rim = make({ fill: 0xffffff, stroke: { color: 0xffffff, width: size * 0.07, join: 'round' } });

  const stops = tier === 4 ? RAINBOW : METAL[tier];
  const fill = new PIXI.FillGradient({
    type: 'linear',
    start: tier === 4 ? { x: 0, y: 0 } : { x: 0, y: 0 },
    end: tier === 4 ? { x: 1, y: 0 } : { x: 0, y: 1 },
    colorStops: stops.map((color, i) => ({ offset: tier === 4 ? i / (stops.length - 1) : [0, 0.34, 0.5, 0.64, 1][i], color })),
    textureSpace: 'local',
  });
  const face = make({ fill });
  const faceFilters = [new FILTERS.BevelFilter({ rotation: 225, thickness: Math.max(2, size * 0.03), lightColor: 0xffffff, lightAlpha: 0.9, shadowColor: 0x000000, shadowAlpha: 0.55 })];
  let hue = null;
  if (tier === 4) {
    hue = new PIXI.ColorMatrixFilter();
    faceFilters.push(hue);
  }
  face.filters = faceFilters;

  // 光の筋は文字の形で切り抜く
  const maskText = make({ fill: 0xffffff });
  const bounds = maskText.getLocalBounds();
  const mask = new PIXI.Sprite(renderer.generateTexture({ target: maskText, resolution: 2 }));
  mask.anchor.set(0.5);
  mask.position.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  maskText.destroy();
  const shine = new PIXI.Sprite(tx.shine);
  shine.anchor.set(0.5);
  shine.blendMode = 'add';
  shine.width = face.width * 0.9;
  shine.height = face.height * 1.4;
  shine.skew.x = -0.3;
  shine.mask = mask;

  box.addChild(glow, shadow, edge, rim, face, mask, shine);
  let t = 0;
  box.tick = (dt) => {
    t += dt;
    const k = (t % 1100) / 1100;
    shine.x = (k * 2.2 - 1.1) * face.width;
    if (hue) hue.hue((t / 4) % 360, false);
    glow.alpha = 0.7 + 0.3 * Math.sin(t / 90);
  };
  return box;
}

// ---- 本体 ----

export async function createGL(root) {
  const { PIXI, FILTERS } = await loadGL();
  await document.fonts.load(`100px ${FONT}`, GLYPHS);

  const app = new PIXI.Application();
  await app.init({
    resizeTo: window,
    background: 0x000000,
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
    preference: 'webgl',
  });
  const canvas = app.canvas;
  canvas.className = 'fx-gl';
  canvas.style.opacity = '0';
  root.append(canvas);

  const tx = makeTextures(PIXI);
  const W = () => app.screen.width;
  const H = () => app.screen.height;

  // 画面全体にかけるフィルター
  const bloom = new FILTERS.AdvancedBloomFilter({ threshold: 0.6, bloomScale: 0.9, brightness: 1, blur: 10, quality: 6 });
  const zoom = new FILTERS.ZoomBlurFilter({ strength: 0, center: { x: W() / 2, y: H() / 2 }, innerRadius: 60 });
  const shock = new FILTERS.ShockwaveFilter({ center: { x: W() / 2, y: H() / 2 }, amplitude: 40, wavelength: 200, brightness: 1.25, radius: -1, speed: 1400, time: 10 });

  const camera = new PIXI.Container();
  const world = new PIXI.Container();
  camera.addChild(world);
  camera.filters = [shock, zoom, bloom];
  camera.filterArea = app.screen;
  app.stage.addChild(camera);

  const bgLayer = new PIXI.Container();
  const fxLayer = new PIXI.Container();
  const fgLayer = new PIXI.Container();
  const topLayer = new PIXI.Container();
  world.addChild(bgLayer, fxLayer, fgLayer, topLayer);

  const flash = new PIXI.Graphics().rect(0, 0, 4000, 4000).fill(0xffffff);
  flash.alpha = 0;
  const black = new PIXI.Graphics().rect(0, 0, 4000, 4000).fill(0x000000);
  black.alpha = 0;
  app.stage.addChild(flash, black);

  // ---- 時間の進め方 ----
  const tweens = new Set();
  const updaters = new Set();
  let hitStop = 0;
  let shakeAmp = 0;
  let camZoom = 1;
  app.ticker.add((ticker) => {
    let dt = ticker.deltaMS;
    if (hitStop > 0) { hitStop -= dt; dt = 0; }
    for (const tw of [...tweens]) tw(dt);
    for (const fn of [...updaters]) fn(dt);
    shock.time += dt / 1000;
    const cx = W() / 2;
    const cy = H() / 2;
    camera.pivot.set(cx, cy);
    camera.position.set(cx + (Math.random() - 0.5) * shakeAmp, cy + (Math.random() - 0.5) * shakeAmp);
    camera.scale.set(camZoom);
    shakeAmp *= 0.9 ** (dt / 16);
  });
  const tween = (target, to, ms, ease = easeOut) => new Promise((resolve) => {
    const from = {};
    for (const k of Object.keys(to)) from[k] = target[k];
    let t = 0;
    const step = (dt) => {
      t += dt;
      const k = Math.min(1, t / ms);
      const e = ease(k);
      for (const key of Object.keys(to)) target[key] = from[key] + (to[key] - from[key]) * e;
      if (k >= 1) { tweens.delete(step); resolve(); }
    };
    tweens.add(step);
  });
  const camState = { get zoom() { return camZoom; }, set zoom(v) { camZoom = v; } };
  // 止めたときに消せるタイマー
  const timers = new Set();
  let destroyed = false;
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms);
    timers.add(id);
  };

  const doFlash = (color = 0xffffff, alpha = 0.95, ms = 260) => {
    flash.tint = color;
    flash.alpha = alpha;
    tween(flash, { alpha: 0 }, ms);
  };
  const shockAt = (x, y, amplitude = 40) => {
    shock.center = { x, y };
    shock.amplitude = amplitude;
    shock.time = 0;
  };

  // ---- 粒子 ----
  const parts = new Set();
  updaters.add((dt) => {
    const s = dt / 1000;
    for (const p of [...parts]) {
      p.life -= s;
      if (p.delay > 0) { p.delay -= s; p.sprite.visible = false; if (p.life > 0) continue; }
      p.sprite.visible = true;
      if (p.life <= 0) { p.sprite.destroy(); parts.delete(p); continue; }
      p.vy += (p.gravity ?? 0) * s;
      p.vx *= p.drag ?? 1;
      p.vy *= p.drag ?? 1;
      if (p.pull) { // 中心へ吸い込まれる
        const dx = W() / 2 - p.sprite.x;
        const dy = H() / 2 - p.sprite.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx += (dx / d) * p.pull * s;
        p.vy += (dy / d) * p.pull * s;
        if (d < 30) p.life = 0;
      }
      p.sprite.x += p.vx * s;
      p.sprite.y += p.vy * s;
      const k = Math.min(1, p.life / (p.fade ?? 0.4));
      p.sprite.alpha = k * (p.alpha ?? 1);
      if (p.kind === 'spark') {
        p.sprite.rotation = Math.atan2(p.vy, p.vx);
        p.sprite.scale.set(Math.min(3, Math.hypot(p.vx, p.vy) / 250) * p.size, 0.12 * p.size);
      } else if (p.kind === 'coin') {
        p.spin += s * p.spinSpeed;
        p.sprite.scale.set(Math.max(0.08, Math.abs(Math.cos(p.spin))) * p.size, p.size);
      } else if (p.kind === 'confetti') {
        p.spin += s * p.spinSpeed;
        p.sprite.rotation += s * 3;
        p.sprite.scale.set(p.size * 0.35, Math.abs(Math.cos(p.spin)) * p.size * 0.18);
        p.vx += Math.sin(p.spin) * 30 * s;
      } else if (p.kind === 'ball') {
        p.sprite.scale.set(p.size);
      } else if (p.kind === 'glint') {
        const g = Math.sin(Math.PI * Math.min(1, p.life / p.max));
        p.sprite.scale.set(g * p.size);
      }
    }
  });
  const spawn = (kind, texture, props, layer = fxLayer) => {
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.blendMode = kind === 'coin' || kind === 'confetti' || kind === 'ball' ? 'normal' : 'add';
    if (props.tint != null) sprite.tint = props.tint;
    sprite.position.set(props.x, props.y);
    layer.addChild(sprite);
    parts.add({ kind, sprite, spin: rand(0, 6), spinSpeed: rand(6, 14), size: 1, max: props.life, ...props });
  };
  const burst = (x, y, tier, count, speed) => {
    const colors = tier === 4 ? RAINBOW.map((c) => Number.parseInt(c.slice(1), 16)) : [0xffffff, TIER_COLOR[tier], 0xfff1a8];
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, Math.PI * 2);
      const v = rand(speed * 0.25, speed);
      spawn('spark', tx.dot, { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.965, gravity: 200, life: rand(0.6, 1.4), size: rand(0.6, 1.4), tint: colors[i % colors.length] });
    }
  };

  // ---- 背景 ----
  const bg = new PIXI.Sprite(tx.bg);
  bg.anchor.set(0.5);
  const rays = new PIXI.Sprite(tx.rays);
  rays.anchor.set(0.5);
  rays.blendMode = 'add';
  rays.alpha = 0;
  const rays2 = new PIXI.Sprite(tx.rays);
  rays2.anchor.set(0.5);
  rays2.blendMode = 'add';
  rays2.alpha = 0;
  bgLayer.addChild(bg, rays, rays2);
  const rings = [];
  for (let i = 0; i < 10; i += 1) {
    const r = new PIXI.Sprite(tx.ring);
    r.anchor.set(0.5);
    r.blendMode = 'add';
    r.phase = i / 10;
    bgLayer.addChild(r);
    rings.push(r);
  }
  let ringSpeed = 0.35;
  let ringAlpha = 0;
  updaters.add((dt) => {
    const cover = Math.hypot(W(), H());
    bg.position.set(W() / 2, H() / 2);
    bg.width = cover * 1.2;
    bg.height = cover * 1.2;
    for (const r of [rays, rays2]) {
      r.position.set(W() / 2, H() / 2);
      r.width = cover * 1.3;
      r.height = cover * 1.3;
    }
    rays.rotation += dt * 0.0004;
    rays2.rotation -= dt * 0.0007;
    for (const r of rings) {
      // 奥から手前へ流れてくる光の輪（トンネル）
      r.phase = (r.phase + (dt / 1000) * ringSpeed) % 1;
      const k = r.phase ** 2.2;
      r.position.set(W() / 2, H() / 2);
      r.width = r.height = 40 + k * cover * 1.6;
      r.alpha = ringAlpha * Math.sin(Math.PI * r.phase) * (1 - k * 0.6);
    }
  });
  const setColor = (tier) => {
    bg.tint = TIER_DARK[tier];
    rays.tint = TIER_COLOR[tier];
    rays2.tint = tier === 4 ? 0xffffff : TIER_COLOR[tier];
    for (const r of rings) r.tint = TIER_COLOR[tier];
  };

  // ---- 中心で脈打つ光（心音に合わせる） ----
  const core = new PIXI.Sprite(tx.dot);
  core.anchor.set(0.5);
  core.blendMode = 'add';
  core.alpha = 0;
  bgLayer.addChild(core);
  const coreBase = () => (Math.min(W(), H()) * 1.8) / 64;
  updaters.add(() => core.position.set(W() / 2, H() * 0.45));
  const beat = (tier, strength = 1) => {
    core.tint = TIER_COLOR[tier];
    core.alpha = 0.9 * strength;
    core.scale.set(coreBase() * (1 + 0.3 * strength));
    tween(core, { alpha: 0.12 }, 450);
    tween(core.scale, { x: coreBase(), y: coreBase() }, 450);
  };

  const strobe = (tier, n, gap = 75) => {
    for (let i = 0; i < n; i += 1) later(() => doFlash(i % 2 ? TIER_COLOR[tier] : 0xffffff, 0.85, gap * 1.3), i * gap);
  };

  const fitText = (box, maxW, maxH) => Math.min(maxW / box.width, maxH / box.height);
  const ticking = (box) => {
    const fn = (dt) => box.tick(dt);
    updaters.add(fn);
    return () => updaters.delete(fn);
  };

  // ---- 数字リール：窓の中を数字の帯が縦に流れる ----
  function makeReels(tier) {
    const set = new PIXI.Container();
    set.position.set(W() / 2, H() * 0.45);
    const w = Math.min(W() * 0.24, 120);
    const h = w * 1.3;
    const colonW = w * 0.32;
    const gap = w * 0.14;
    const left = -(w * 3 + colonW + gap) / 2;
    const xs = [left + w / 2, left + w + colonW + w / 2, left + w * 2 + colonW + gap + w / 2];
    const silver = new PIXI.FillGradient({
      type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
      colorStops: [{ offset: 0, color: '#ffffff' }, { offset: 0.45, color: '#8a8f99' }, { offset: 0.55, color: '#5b616b' }, { offset: 1, color: '#e9edf2' }],
    });
    const cylinder = new PIXI.FillGradient({
      type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
      colorStops: [{ offset: 0, color: 'rgba(0,0,0,0.6)' }, { offset: 0.24, color: 'rgba(0,0,0,0)' }, { offset: 0.76, color: 'rgba(0,0,0,0)' }, { offset: 1, color: 'rgba(0,0,0,0.6)' }],
    });
    const reels = xs.map((x) => {
      const r = new PIXI.Container();
      r.x = x;
      const glow = new PIXI.Graphics().roundRect(-w / 2 - 14, -h / 2 - 14, w + 28, h + 28, 22).fill(0xffffff);
      glow.tint = TIER_COLOR[tier];
      glow.blendMode = 'add';
      glow.alpha = 0.4;
      glow.filters = [new PIXI.BlurFilter({ strength: 14, quality: 3 })];
      const bezel = new PIXI.Graphics().roundRect(-w / 2 - 7, -h / 2 - 7, w + 14, h + 14, 14).fill(silver);
      const face = new PIXI.Graphics().roundRect(-w / 2, -h / 2, w, h, 9).fill(0xf6f6f4);
      const strip = new PIXI.Container();
      const blur = new PIXI.BlurFilter({ strengthX: 0, strengthY: 0, quality: 3 });
      strip.filters = [blur];
      const digits = [-1, 0, 1].map(() => {
        const t = new PIXI.Text({ text: '0', style: { fontFamily: FONT, fontSize: h * 0.72, fill: 0x141414 }, resolution: 2 });
        t.anchor.set(0.5);
        strip.addChild(t);
        return t;
      });
      const mask = new PIXI.Graphics().roundRect(-w / 2, -h / 2, w, h, 9).fill(0xffffff);
      strip.mask = mask;
      const shade = new PIXI.Graphics().roundRect(-w / 2, -h / 2, w, h, 9).fill(cylinder);
      const gloss = new PIXI.Graphics().roundRect(-w / 2 + 6, -h / 2 + 5, w - 12, h * 0.2, 8).fill({ color: 0xffffff, alpha: 0.3 });
      r.addChild(glow, bezel, face, strip, mask, shade, gloss);
      set.addChild(r);
      return { r, glow, blur, digits, offset: Math.floor(Math.random() * 10) * h, speed: 0, manual: true, reach: false };
    });
    const colon = new PIXI.Container();
    colon.x = left + w + colonW / 2;
    for (const y of [-h * 0.17, h * 0.17]) {
      const halo = new PIXI.Sprite(tx.dot);
      halo.anchor.set(0.5);
      halo.blendMode = 'add';
      halo.width = halo.height = colonW * 1.1;
      halo.y = y;
      halo.tint = TIER_COLOR[tier];
      colon.addChild(halo, new PIXI.Graphics().circle(0, y, colonW * 0.15).fill(0xffffff));
    }
    set.addChild(colon);
    const digit = (n) => ((n % 10) + 10) % 10;
    let clock = 0;
    const update = (dt) => {
      clock += dt;
      for (const reel of reels) {
        if (!reel.manual) reel.offset += (reel.speed * dt) / 1000;
        const k = Math.floor(reel.offset / h + 1e-6);
        const frac = reel.offset / h - k;
        reel.digits.forEach((t, i) => {
          const j = i - 1;
          const d = String(digit(k - j));
          if (t.text !== d) t.text = d;
          t.y = (frac + j) * h;
        });
        reel.blur.strengthY = Math.min(18, Math.abs(reel.speed) / 220);
        if (reel.reach) reel.glow.alpha = 0.7 + 0.5 * Math.sin(clock / 70);
      }
    };
    updaters.add(update);
    set.alpha = 0;
    set.scale.set(0.6);
    fgLayer.addChild(set);
    const smooth = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

    return {
      set,
      show() {
        tween(set, { alpha: 1 }, 160);
        return tween(set.scale, { x: 1, y: 1 }, 260, easeBack);
      },
      spinAll() {
        for (const reel of reels) { reel.manual = false; reel.speed = h * 24; }
      },
      // 目の数字まで回して止める。勢いで少し行き過ぎて戻る
      async stop(i, target, ms = 300) {
        const reel = reels[i];
        let n = Math.floor(reel.offset / h) + 3;
        while (digit(n) !== target) n += 1;
        reel.manual = true;
        const v = reel.speed;
        reel.speed = v * 0.4;
        await tween(reel, { offset: n * h }, ms, easeBack);
        reel.speed = 0;
        reel.glow.alpha = 1.3;
        tween(reel.glow, { alpha: 0.5 }, 320);
      },
      async slow(i, ms) {
        await tween(reels[i], { speed: h * 4 }, ms, easeOut);
      },
      // 1コマだけ送る
      async step(i, ms) {
        const reel = reels[i];
        reel.manual = true;
        const n = Math.floor(reel.offset / h + 1e-6) + 1;
        reel.speed = (h * 1000) / ms;
        await tween(reel, { offset: n * h }, ms, smooth);
        reel.speed = 0;
        return digit(n);
      },
      // 全回転：3つを同じ数字にそろえて、一緒に回す
      alignAll() {
        const base = Math.floor(reels[0].offset / h) * h;
        for (const reel of reels) { reel.offset = base; reel.speed = h * 24; reel.manual = false; reel.reach = true; }
      },
      async stepAll(ms) {
        const [d] = await Promise.all(reels.map((_, i) => this.step(i, ms)));
        return d;
      },
      flashAll() {
        for (const reel of reels) { reel.reach = false; reel.glow.alpha = 1.6; tween(reel.glow, { alpha: 0.6 }, 600); }
      },
      setReach(i, on) {
        reels[i].reach = on;
        if (!on) tween(reels[i].glow, { alpha: 0.5 }, 200);
      },
      color(t) {
        for (const reel of reels) reel.glow.tint = TIER_COLOR[t];
        for (const c of colon.children) if (c instanceof PIXI.Sprite) c.tint = TIER_COLOR[t];
        tween(set.scale, { x: 1.08, y: 1.08 }, 80).then(() => tween(set.scale, { x: 1, y: 1 }, 220, easeBack));
      },
      center(i) { return { x: set.x + xs[i], y: set.y }; },
      async hide() {
        await tween(set, { alpha: 0 }, 250);
        updaters.delete(update);
        set.destroy({ children: true });
      },
    };
  }

  // ---- 斜めの帯のカットイン ----
  // pattern：'zebra' か 'kirin' なら帯をその柄にする（出たらほぼ当たり）
  function cutIn(text, tier, pattern = null) {
    const c = new PIXI.Container();
    const bw = Math.hypot(W(), H()) * 1.4;
    const bh = Math.min(H() * 0.16, 160);
    const fill = tier === 4
      ? new PIXI.FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, textureSpace: 'local', colorStops: RAINBOW.map((color, i) => ({ offset: i / (RAINBOW.length - 1), color })) })
      : new PIXI.FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local', colorStops: [{ offset: 0, color: TIER_LIGHT[tier] }, { offset: 0.5, color: TIER_COLOR[tier] }, { offset: 1, color: TIER_DARK[tier] }] });
    const glowBand = new PIXI.Graphics().rect(-bw / 2, -bh / 2 - 20, bw, bh + 40).fill(TIER_COLOR[tier]);
    glowBand.blendMode = 'add';
    glowBand.alpha = 0.6;
    glowBand.filters = [new PIXI.BlurFilter({ strength: 24, quality: 3 })];
    const band = new PIXI.Graphics().rect(-bw / 2, -bh / 2, bw, bh).fill(fill);
    const edges = new PIXI.Graphics()
      .rect(-bw / 2, -bh / 2 - 7, bw, 7).fill(0xffffff)
      .rect(-bw / 2, bh / 2, bw, 7).fill(0xffffff);
    let tile = null;
    if (pattern) {
      tile = new PIXI.TilingSprite({ texture: tx[pattern], width: bw, height: bh });
      tile.position.set(-bw / 2, -bh / 2);
      tile.tileScale.set(bh / 200);
      glowBand.tint = pattern === 'kirin' ? 0xffb000 : 0xffffff;
    }
    const labelTier = pattern === 'zebra' ? 2 : pattern === 'kirin' ? 0 : tier === 3 ? 2 : 3;
    const label = metalText(PIXI, FILTERS, app.renderer, tx, text, labelTier, bh * 0.62);
    label.scale.set(Math.min(1, fitText(label, W() * 0.9, bh * 1.2)));
    const sweep = new PIXI.Sprite(tx.shine);
    sweep.anchor.set(0.5);
    sweep.blendMode = 'add';
    sweep.width = W() * 0.8;
    sweep.height = bh;
    sweep.alpha = 0.6;
    c.addChild(glowBand, band, ...(tile ? [tile] : []), sweep, edges, label);
    c.rotation = -0.12;
    c.position.set(W() * 1.9, H() * 0.45);
    fgLayer.addChild(c);
    let t = 0;
    const untick = ticking({
      tick: (dt) => {
        t += dt;
        label.tick(dt);
        sweep.x = ((t % 700) / 700) * bw - bw / 2;
        if (tile) tile.tilePosition.x -= dt * 0.4;
      },
    });
    return {
      async enter() {
        zoom.center = { x: W() / 2, y: H() * 0.45 };
        zoom.strength = 0.25;
        tween(zoom, { strength: 0 }, 450);
        await tween(c, { x: W() / 2 }, 160, easeOut);
        hitStop = 70;
        shakeAmp = 26;
        doFlash(TIER_COLOR[tier], 0.75, 260);
        shockAt(W() / 2, H() * 0.45, 30);
      },
      async leave() {
        await tween(c, { x: -W() }, 170, easeIn);
        untick();
        c.destroy({ children: true });
      },
      y: H() * 0.45,
      height: bh,
    };
  }

  // ---- 画面中央に叩きつける文字 ----
  async function slam(text, tier, y = H() * 0.45, maxH = H() * 0.16) {
    const label = metalText(PIXI, FILTERS, app.renderer, tx, text, tier, 110);
    const fit = Math.min(1.2, fitText(label, W() * 0.84, maxH));
    label.position.set(W() / 2, y);
    label.scale.set(fit * 3);
    label.alpha = 0;
    fgLayer.addChild(label);
    const untick = ticking(label);
    tween(label, { alpha: 1 }, 90);
    await tween(label.scale, { x: fit, y: fit }, 170, easeIn);
    hitStop = 60;
    shakeAmp = 20;
    shockAt(W() / 2, y, 30);
    return {
      async leave() {
        tween(label, { alpha: 0 }, 200);
        await tween(label.scale, { x: fit * 0.4, y: fit * 0.4 }, 200, easeIn);
        untick();
        label.destroy({ children: true });
      },
    };
  }

  // ---- 降ってくるコインと紙吹雪、まわりのきらめき ----
  function confettiRain(tier, ms) {
    const until = performance.now() + ms;
    const rain = () => {
      if (performance.now() > until) return;
      for (let i = 0; i < [1, 1, 1, 2, 2][tier]; i += 1) {
        spawn('glint', tx.glint, { x: rand(0, W()), y: rand(0, H()), life: rand(0.25, 0.5), size: rand(0.25, 0.6), fade: 0.01 });
        if (tier >= 3) {
          spawn('coin', tx.coin, { x: rand(0, W()), y: -30, vx: rand(-40, 40), vy: rand(250, 450), gravity: 300, life: 3, size: rand(0.16, 0.3), fade: 0.2 }, topLayer);
          spawn('confetti', PIXI.Texture.WHITE, {
            x: rand(0, W()), y: -20, vx: rand(-60, 60), vy: rand(120, 220), gravity: 60, drag: 0.99, life: 3.5, size: rand(28, 48), fade: 0.3,
            tint: tier === 4 ? Number.parseInt(RAINBOW[Math.floor(rand(0, 7))].slice(1), 16) : [0xffd23f, 0xffffff, 0xffa600][Math.floor(rand(0, 3))],
          }, topLayer);
        }
      }
      later(rain, 40);
    };
    rain();
  }

  // ---- ステップアップ予告：板が1枚ずつ叩きつけられ、色が上がっていく ----
  // n 枚目まで上がる。infinite なら最後に「STEP∞」（キリン柄）
  async function stepUp(n, infinite, sfx, wait) {
    const pw = Math.min(W() * 0.82, 440);
    const ph = pw * 0.42;
    const y = H() * 0.42;
    const total = n + (infinite ? 1 : 0);
    // 下のゲージ。5つの玉が1つずつ灯る
    const gauge = new PIXI.Container();
    gauge.position.set(W() / 2, y + ph * 0.5 + 44);
    const pips = Array.from({ length: 5 }, (_, i) => {
      const pip = new PIXI.Sprite(tx.dome);
      pip.anchor.set(0.5);
      pip.width = pip.height = 34;
      pip.x = (i - 2) * 40;
      pip.tint = 0x333333;
      gauge.addChild(pip);
      return pip;
    });
    fgLayer.addChild(gauge);
    let prev = null;
    for (let k = 0; k < total; k += 1) {
      const last = infinite && k === n;
      const t = last ? 4 : Math.min(k, 4);
      const panel = new PIXI.Container();
      panel.position.set(W() / 2, y);
      const glowG = new PIXI.Graphics().roundRect(-pw / 2 - 20, -ph / 2 - 20, pw + 40, ph + 40, 30).fill(TIER_COLOR[t]);
      glowG.blendMode = 'add';
      glowG.filters = [new PIXI.BlurFilter({ strength: 22, quality: 3 })];
      const plate = new PIXI.Graphics().roundRect(-pw / 2, -ph / 2, pw, ph, 18).fill(new PIXI.FillGradient({
        type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
        colorStops: [{ offset: 0, color: TIER_COLOR[t] }, { offset: 0.5, color: TIER_DARK[t] }, { offset: 1, color: 0x000000 }],
      }));
      const layers = [glowG, plate];
      if (last || t === 3) {
        const tile = new PIXI.TilingSprite({ texture: last ? tx.kirin : tx.zebra, width: pw, height: ph });
        tile.position.set(-pw / 2, -ph / 2);
        tile.tileScale.set(ph / 180);
        const mask = new PIXI.Graphics().roundRect(-pw / 2, -ph / 2, pw, ph, 18).fill(0xffffff);
        tile.mask = mask;
        layers.push(tile, mask);
      }
      const frame = new PIXI.Graphics().roundRect(-pw / 2, -ph / 2, pw, ph, 18).stroke({ color: 0xffffff, width: 6 });
      const label = metalText(PIXI, FILTERS, app.renderer, tx, last ? 'STEP∞' : `STEP${k + 1}`, last ? 0 : t === 3 ? 2 : t, ph * 0.5);
      label.scale.set(Math.min(1, fitText(label, pw * 0.86, ph * 0.9)));
      layers.push(frame, label);
      panel.addChild(...layers);
      panel.scale.set(2.6);
      panel.alpha = 0;
      fgLayer.addChild(panel);
      const untick = ticking(label);
      panel.untick = untick;
      if (prev) {
        const old = prev;
        tween(old, { alpha: 0 }, 140);
        tween(old.scale, { x: 1.4, y: 1.4 }, 140).then(() => { old.untick(); old.destroy({ children: true }); });
      }
      setColor(t);
      rays.alpha = 0.08 + k * 0.06;
      ringAlpha = 0.15 + k * 0.05;
      ringSpeed = 0.6 + k * 0.4;
      tween(panel, { alpha: 1 }, 80);
      await tween(panel.scale, { x: 1, y: 1 }, 150, easeIn);
      hitStop = 50 + k * 15;
      shakeAmp = 14 + k * 7;
      doFlash(TIER_COLOR[t], 0.7, 240);
      shockAt(W() / 2, y, 25 + k * 10);
      burst(W() / 2, y, t, 30 + k * 20, 600 + k * 120);
      sfx.sample?.('sfx-upgrade', { gain: 0.8, rate: 0.85 + k * 0.12 });
      if (k >= 3) sfx.sample?.('sfx-impact', { gain: 0.5 });
      if (k === 1) sfx.sample?.('voice-stepup', { gain: 1.3, at: 0.05 });
      pips.forEach((pip, i) => { if (i <= k || last) pip.tint = last ? Number.parseInt(RAINBOW[i].slice(1), 16) : TIER_COLOR[t]; });
      if (last) {
        sfx.sample?.('voice-kita', { gain: 1.4, at: 0.1 });
        strobe(4, 12);
        rays2.alpha = 0.25;
        zoom.center = { x: W() / 2, y };
        zoom.strength = 0.35;
        tween(zoom, { strength: 0 }, 700);
      }
      prev = panel;
      await wait(last ? 1300 : k === total - 1 ? 700 : 480);
    }
    tween(gauge, { alpha: 0 }, 200);
    tween(prev, { alpha: 0 }, 200);
    await tween(prev.scale, { x: 0.5, y: 0.5 }, 200, easeIn);
    prev.untick();
    prev.destroy({ children: true });
    gauge.destroy({ children: true });
    rays.alpha = 0;
    rays2.alpha = 0;
  }

  // ---- 役物：巨大なメダルが上から落ちてきて、画面にひびが入る ----
  async function gimmick(tier, sfx, wait) {
    const size = Math.min(W(), H()) * 0.8;
    const y = H() * 0.42;
    const g = new PIXI.Container();
    // 吊っている2本の棒
    const rodFill = new PIXI.FillGradient({
      type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, textureSpace: 'local',
      colorStops: [{ offset: 0, color: '#5b616b' }, { offset: 0.4, color: '#ffffff' }, { offset: 1, color: '#3a3f47' }],
    });
    for (const x of [-size * 0.28, size * 0.28]) g.addChild(new PIXI.Graphics().rect(x - size * 0.03, -H() * 1.2, size * 0.06, H() * 1.2 - size * 0.3).fill(rodFill));
    const halo = new PIXI.Sprite(tx.ring);
    halo.anchor.set(0.5);
    halo.blendMode = 'add';
    halo.width = halo.height = size * 1.5;
    halo.tint = TIER_COLOR[tier];
    const dome = new PIXI.Sprite(tx.dome);
    dome.anchor.set(0.5);
    dome.width = dome.height = size;
    dome.tint = TIER_COLOR[tier];
    const bezel = new PIXI.Sprite(tx.bezel);
    bezel.anchor.set(0.5);
    bezel.width = bezel.height = size;
    const mark = metalText(PIXI, FILTERS, app.renderer, tx, '激', tier === 4 ? 4 : 3, size * 0.42);
    g.addChild(halo, dome, bezel, mark);
    g.position.set(W() / 2, -size);
    fgLayer.addChild(g);
    let t = 0;
    const untick = ticking({ tick: (dt) => { t += dt; mark.tick(dt); halo.alpha = 0.6 + 0.4 * Math.sin(t / 60); } });

    // ガタッ、ガタッ…と予兆
    for (let i = 0; i < 2; i += 1) {
      shakeAmp = 10 + i * 8;
      doFlash(TIER_COLOR[tier], 0.3, 160);
      sfx.sample?.('sfx-stop', { gain: 0.9, rate: 0.55 });
      await wait(300);
    }
    await tween(g, { y }, 320, easeIn);

    // 落ちた：止まる → 白 → ひび → 衝撃波
    hitStop = 150;
    shakeAmp = 64;
    doFlash(0xffffff, 1, 320);
    shockAt(W() / 2, y + size * 0.3, 90);
    zoom.center = { x: W() / 2, y };
    zoom.strength = 0.4;
    tween(zoom, { strength: 0 }, 600);
    const crack = new PIXI.Sprite(tx.crack);
    crack.anchor.set(0.5);
    crack.position.set(W() / 2 + rand(-30, 30), y + size * 0.25);
    crack.width = crack.height = Math.hypot(W(), H()) * 1.1;
    crack.rotation = rand(0, Math.PI * 2);
    topLayer.addChild(crack);
    sfx.sample?.('sfx-impact', { gain: 1, rate: 0.75 });
    sfx.sample?.('sfx-stop', { gain: 1, rate: 1.8, at: 0.03 });
    sfx.sample?.('voice-kita', { gain: 1.4, at: 0.2 });
    burst(W() / 2, y + size * 0.45, tier, 140, 1300);
    strobe(tier, 6);
    // 跳ねて落ち着く
    await tween(g, { y: y - size * 0.07 }, 130, easeOut);
    await tween(g, { y }, 150, easeIn);
    shakeAmp = 22;
    await wait(1100);
    tween(crack, { alpha: 0 }, 500).then(() => crack.destroy());
    await tween(g, { y: -size }, 280, easeIn);
    untick();
    g.destroy({ children: true });
  }

  // ---- 出玉：研究時間を玉の数にしてカウントアップする。赤以上はラウンドも ----
  async function payout(tier, minutes, sfx, wait) {
    const balls = minutes * 100;
    const rounds = tier >= 2 ? Math.min(16, Math.max(1, Math.ceil(minutes / 15))) : 0;
    const pw = Math.min(W() * 0.86, 440);
    const ph = Math.min(H() * 0.1, 84);
    const gold = (size) => ({
      fontFamily: FONT,
      fontSize: size,
      fill: new PIXI.FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local', colorStops: METAL[3].map((color, i) => ({ offset: [0, 0.34, 0.5, 0.64, 1][i], color })) }),
      stroke: { color: 0x2a1a00, width: size * 0.12, join: 'round' },
      dropShadow: { color: 0x000000, blur: 4, distance: 3, alpha: 0.8, angle: Math.PI / 2 },
    });
    const plain = (size) => ({ fontFamily: FONT, fontSize: size, fill: 0xffffff, stroke: { color: 0x000000, width: size * 0.12 } });
    const plateOf = (w, h) => new PIXI.Graphics()
      .roundRect(-w / 2, -h / 2, w, h, 14)
      .fill({ color: 0x000000, alpha: 0.65 })
      .stroke({ color: TIER_COLOR[tier], width: 3 });

    const box = new PIXI.Container();
    const head = new PIXI.Text({ text: '獲得', style: plain(ph * 0.32), resolution: 2 });
    head.anchor.set(0, 0.5);
    head.x = -pw / 2 + 18;
    const value = new PIXI.Text({ text: '0', style: gold(ph * 0.66), resolution: 2 });
    value.anchor.set(1, 0.5);
    value.x = pw / 2 - ph * 0.62;
    const unit = new PIXI.Text({ text: '発', style: plain(ph * 0.36), resolution: 2 });
    unit.anchor.set(0, 0.5);
    unit.x = pw / 2 - ph * 0.55;
    box.addChild(plateOf(pw, ph), head, value, unit);
    box.position.set(W() / 2, H() + ph);
    topLayer.addChild(box);

    let round = null;
    if (rounds) {
      round = new PIXI.Container();
      const rt = new PIXI.Text({ text: 'ROUND 1', style: gold(ph * 0.6), resolution: 2 });
      rt.anchor.set(0.5);
      round.addChild(plateOf(Math.min(W() * 0.7, 320), ph * 0.95), rt);
      round.text = rt;
      round.position.set(W() / 2, -ph);
      topLayer.addChild(round);
      tween(round, { y: H() * 0.13 }, 220, easeOut);
      sfx.sample?.('voice-round', { gain: 1.3 });
    }
    await tween(box, { y: H() * 0.82 }, 220, easeOut);

    const dur = 1500 + tier * 350;
    let t = 0;
    let lastRound = 1;
    let lastTick = 0;
    await new Promise((resolve) => {
      const count = (dt) => {
        t += dt;
        const k = easeOut(Math.min(1, t / dur));
        value.text = Math.round(balls * k).toLocaleString('en-US');
        // 桁が増えても「獲得」と重ならない大きさにする
        const room = value.x - (head.x + head.width) - 14;
        value.scale.set(Math.min(1, room / (value.width / value.scale.x)));
        if (t - lastTick > 55) {
          lastTick = t;
          sfx.sample?.('sfx-tick', { gain: 0.3, rate: rand(1.6, 2.2) }); // ジャラジャラ
        }
        // 玉があふれ出てくる
        for (let i = 0; i < 1 + tier; i += 1) {
          spawn('ball', tx.ball, { x: rand(W() * 0.1, W() * 0.9), y: H() * 0.82, vx: rand(-260, 260), vy: rand(-900, -500), gravity: 1800, life: 1.4, size: rand(0.22, 0.34), fade: 0.2 }, fgLayer); // 数字の板より奥
        }
        if (round) {
          const r = Math.max(1, Math.ceil(rounds * k));
          if (r !== lastRound) {
            lastRound = r;
            round.text.text = `ROUND ${r}`;
            doFlash(TIER_COLOR[tier], 0.25, 120);
            shakeAmp = Math.max(shakeAmp, 5);
          }
        }
        if (t >= dur) { updaters.delete(count); resolve(); }
      };
      updaters.add(count);
    });
    sfx.sample?.('sfx-stop', { gain: 1 });
    sfx.sample?.('sfx-upgrade', { gain: 0.8, rate: 1.2 });
    doFlash(0xffffff, 0.6, 220);
    shakeAmp = 18;
    shockAt(W() / 2, H() * 0.82, 40);
    burst(W() / 2, H() * 0.82, tier, 60 + tier * 20, 800);
    tween(box.scale, { x: 1.12, y: 1.12 }, 80).then(() => tween(box.scale, { x: 1, y: 1 }, 220, easeBack));
    await wait(900);
  }

  // ---- 始める ----
  // opts: { origin, streak, tier, sfx, wait, vibrate }
  async function start({ origin, streak, tier, sfx, wait, vibrate }) {
    setColor(tier);
    canvas.style.opacity = '1';
    rays.alpha = 0.28;
    ringAlpha = 0.25;
    ringSpeed = 1.4;
    shockAt(origin.x, origin.y, 70);
    doFlash(TIER_COLOR[tier], 0.8, 320);
    burst(origin.x, origin.y, tier, 70, 1000);
    sfx.sample?.('sfx-start', { gain: 0.9 });
    sfx.sample?.('voice-start', { gain: 1.3, at: 0.3 });
    vibrate(40);
    await wait(150);
    const band = cutIn('研究スタート！', tier);
    sfx.sample?.('sfx-cutin', { gain: 0.7 });
    await band.enter();
    for (let i = 0; i < 24; i += 1) later(() => spawn('glint', tx.glint, { x: rand(0, W()), y: rand(0, H()), life: rand(0.25, 0.5), size: rand(0.25, 0.6), fade: 0.01 }), i * 45);
    if (streak >= 3) {
      await wait(500);
      await band.leave();
      await rush(streak, sfx, wait);
      await tween(world, { alpha: 0 }, 220);
      return;
    }
    if (streak >= 2) {
      await wait(350);
      const stamp = await slam(`${streak}日連続！`, 3, band.y + band.height * 1.1, H() * 0.08);
      sfx.sample?.('sfx-upgrade', { gain: 0.7 });
      burst(W() / 2, band.y + band.height * 1.1, 3, 40, 600);
      await wait(800);
      stamp.leave();
    } else {
      await wait(900);
    }
    await band.leave();
    await tween(world, { alpha: 0 }, 220);
  }

  // ---- 研究RUSH：3日以上続けて始めたとき ----
  async function rush(streak, sfx, wait) {
    black.alpha = 1;
    await wait(280);
    black.alpha = 0;
    setColor(4);
    rays.alpha = 0.45;
    rays2.alpha = 0.3;
    ringAlpha = 0.4;
    ringSpeed = 3.2;
    zoom.center = { x: W() / 2, y: H() * 0.4 };
    zoom.strength = 0.5;
    tween(zoom, { strength: 0 }, 700);
    doFlash(0xffffff, 1, 400);
    sfx.sample?.('sfx-impact', { gain: 1 });
    sfx.sample?.('sfx-fanfare-3', { gain: 0.9 });
    sfx.sample?.('voice-rush', { gain: 1.4, at: 0.1 });
    strobe(4, 12);
    const title = await slam('RUSH突入！', 4, H() * 0.4, H() * 0.18);
    shakeAmp = 34;
    burst(W() / 2, H() * 0.4, 4, 180, 1300);
    later(() => burst(W() * 0.22, H() * 0.35, 4, 60, 700), 300);
    later(() => burst(W() * 0.78, H() * 0.35, 4, 60, 700), 500);
    confettiRain(4, 2600);
    await wait(600);
    const count = await slam(`${streak}連チャン中！`, 3, H() * 0.6, H() * 0.09);
    sfx.sample?.('sfx-upgrade', { gain: 0.9 });
    burst(W() / 2, H() * 0.6, 3, 50, 600);
    await wait(1600);
    title.leave();
    count.leave();
    await wait(200);
  }

  // ---- 記録中の節目 ----
  // opts: { index, label, tier, raised, sfx, wait, vibrate }
  async function milestone({ index, label, tier, raised, sfx, wait, vibrate }) {
    setColor(tier);
    canvas.style.opacity = '1';
    rays.alpha = 0.3;
    ringAlpha = 0.25;
    ringSpeed = 1.6;
    doFlash(TIER_COLOR[tier], 0.8, 300);
    beat(tier);
    sfx.sample?.('sfx-cutin', { gain: 1 });
    sfx.sample?.(`voice-m${index}`, { gain: 1.35, at: 0.2 });
    vibrate(60);
    const band = cutIn(label, tier);
    await band.enter();
    burst(W() / 2, H() * 0.45, tier, 60 + tier * 20, 900);
    for (let i = 0; i < 20; i += 1) later(() => spawn('glint', tx.glint, { x: rand(0, W()), y: rand(0, H()), life: rand(0.25, 0.5), size: rand(0.25, 0.6), fade: 0.01 }), i * 50);
    if (raised) {
      await wait(350);
      const name = ['', 'チャンス', '激アツ', '大当たり', '超大当たり'][tier];
      const up = await slam(`${name}昇格！`, tier, band.y + band.height * 1.15, H() * 0.08);
      strobe(tier, 4);
      sfx.sample?.('sfx-upgrade', { gain: 0.9 });
      sfx.sample?.('voice-chance', { gain: 1.3, at: 0.1 });
      await wait(900);
      up.leave();
    } else {
      await wait(1000);
    }
    await band.leave();
    await tween(world, { alpha: 0 }, 220);
  }

  // ---- 週の結果発表 ----
  // opts: { title, cols: [{ label, value }], total, tier, sfx, wait, waitTap, vibrate }
  async function weekly({ title, cols, total, tier, sfx, wait, waitTap, vibrate }) {
    setColor(0);
    canvas.style.opacity = '1';
    ringAlpha = 0.15;
    ringSpeed = 0.6;
    rays.alpha = 0.1;
    bloom.bloomScale = 0.7;
    sfx.sample?.('voice-weekly', { gain: 1.35 });
    const head = await slam(title, 3, H() * 0.14, H() * 0.06);
    const band = cutIn('結果発表', 0);
    sfx.sample?.('sfx-cutin', { gain: 1 });
    await band.enter();
    await wait(900);
    await band.leave();

    // 3つの数字を、保証表の列の順に1つずつ
    sfx.sample?.('sfx-drumroll', { gain: 0.9 });
    const rowW = Math.min(W() * 0.86, 460);
    const rowH = Math.min(H() * 0.09, 80);
    const rows = [];
    const numberStyle = (size) => ({
      fontFamily: FONT,
      fontSize: size,
      fill: new PIXI.FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local', colorStops: METAL[3].map((color, i) => ({ offset: [0, 0.34, 0.5, 0.64, 1][i], color })) }),
      stroke: { color: 0x2a1a00, width: size * 0.12, join: 'round' },
      dropShadow: { color: 0x000000, blur: 4, distance: 3, alpha: 0.8, angle: Math.PI / 2 },
    });
    for (const [i, col] of cols.entries()) {
      const row = new PIXI.Container();
      row.position.set(W() * 1.5, H() * (0.3 + i * 0.13));
      const plate = new PIXI.Graphics()
        .roundRect(-rowW / 2, -rowH / 2, rowW, rowH, 14)
        .fill({ color: 0x000000, alpha: 0.55 })
        .stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
      // 「ディスカッション」が数字と重ならない大きさにする
      const name = new PIXI.Text({ text: col.label, style: { fontFamily: 'system-ui, "Hiragino Sans", sans-serif', fontWeight: '800', fontSize: Math.min(rowH * 0.3, rowW * 0.052), fill: 0xffffff }, resolution: 2 });
      name.anchor.set(0, 0.5);
      name.x = -rowW / 2 + 20;
      const value = new PIXI.Text({ text: '0', style: numberStyle(rowH * 0.72), resolution: 2 });
      value.anchor.set(1, 0.5);
      value.x = rowW / 2 - rowH * 1.05;
      const unit = new PIXI.Text({ text: '時間', style: { fontFamily: 'system-ui, "Hiragino Sans", sans-serif', fontWeight: '800', fontSize: rowH * 0.3, fill: 0xffffff }, resolution: 2 });
      unit.anchor.set(0, 0.5);
      unit.x = rowW / 2 - rowH * 0.95;
      row.addChild(plate, name, value, unit);
      fgLayer.addChild(row);
      rows.push(row);
      await tween(row, { x: W() / 2 }, 200, easeOut);
      // 数字が駆け上がって止まる
      const steps = Math.min(14, Math.max(6, col.value + 4));
      for (let k = 0; k < steps; k += 1) {
        value.text = String(k === steps - 1 ? col.value : Math.floor(Math.random() * Math.max(10, col.value * 2)));
        if (k % 2 === 0) sfx.sample?.('sfx-tick', { gain: 0.6 });
        await wait(45 + k * 6);
      }
      sfx.sample?.('sfx-stop', { gain: 1 });
      doFlash(0xffffff, 0.35, 160);
      shakeAmp = 10;
      burst(row.x + value.x - value.width / 2, row.y, 3, 20, 400);
      await wait(250);
    }

    // 合計を発表
    await wait(500);
    setColor(tier);
    rays.alpha = 0.4;
    rays2.alpha = tier >= 3 ? 0.22 : 0;
    ringAlpha = 0.15;
    ringSpeed = 1.2;
    bloom.bloomScale = 1;
    doFlash(0xffffff, 1, 380);
    shockAt(W() / 2, H() * 0.74, 60);
    sfx.sample?.('sfx-impact', { gain: 1 });
    sfx.sample?.(`sfx-fanfare-${tier}`, { gain: 0.95 });
    sfx.sample?.(`voice-${tier}`, { gain: 1.4, at: 0.15 });
    vibrate(tier >= 3 ? [80, 60, 80, 60, 300] : [60]);
    const sum = await slam(`合計 ${total}時間`, tier, H() * 0.74, H() * 0.12);
    shakeAmp = tier >= 2 ? 30 : 14;
    strobe(tier, [1, 2, 4, 8, 12][tier]);
    burst(W() / 2, H() * 0.74, tier, [40, 70, 110, 160, 220][tier], 900 + tier * 150);
    const until = performance.now() + 2500;
    const rain = () => {
      if (performance.now() > until) return;
      spawn('glint', tx.glint, { x: rand(0, W()), y: rand(0, H()), life: rand(0.25, 0.5), size: rand(0.25, 0.6), fade: 0.01 });
      if (tier >= 3) {
        spawn('coin', tx.coin, { x: rand(0, W()), y: -30, vx: rand(-40, 40), vy: rand(250, 450), gravity: 300, life: 3, size: rand(0.16, 0.3), fade: 0.2 }, topLayer);
      }
      later(rain, 50);
    };
    rain();

    const note = new PIXI.Text({ text: '保証表に書き写そう（タップで閉じる）', style: { fontFamily: 'system-ui, "Hiragino Sans", sans-serif', fontWeight: '700', fontSize: Math.min(18, W() * 0.045), fill: 0xffffff }, resolution: 2 });
    note.anchor.set(0.5);
    note.position.set(W() / 2, H() * 0.88);
    note.alpha = 0;
    fgLayer.addChild(note);
    tween(note, { alpha: 0.9 }, 400);
    await waitTap(7000);
    sum.leave();
    head.leave();
    await tween(world, { alpha: 0 }, 300);
  }

  // ---- 止める ----
  // opts: { tier, shown, pseudo, withPush, steps, gimmick, pattern, values, minutes, sub, sfx, wait, waitTap, vibrate }
  async function stop(opts) {
    const { tier, pseudo, withPush, values, sfx, wait, vibrate } = opts;
    let { shown } = opts;
    const rnd = () => Math.floor(Math.random() * 10);
    setColor(shown);
    canvas.style.opacity = '1';
    ringAlpha = 0.06;
    ringSpeed = 0.2;
    bloom.bloomScale = 0.5; // 白いリールの面がにじまないよう、リールの間は発光を弱める
    let chanceSaid = false;
    const upgrade = (to, at) => {
      shown = to;
      setColor(shown);
      reels.color(shown);
      strobe(shown, 3);
      shakeAmp = 16;
      beat(shown);
      shockAt(at.x, at.y, 25);
      sfx.sample?.('sfx-upgrade', { gain: 0.8 });
      if (!chanceSaid) { sfx.sample?.('voice-chance', { gain: 1.3, at: 0.1 }); chanceSaid = true; }
      vibrate(40);
    };

    // 1. 暗転して溜める（赤以上は心音）
    if (tier >= 2) {
      for (const at of [0, 900]) {
        later(() => { sfx.sample?.('sfx-heartbeat', { gain: 1 }); beat(shown, 0.6); vibrate([30, 150, 30]); }, at);
        later(() => beat(shown, 0.4), at + 280);
      }
    }
    await wait(tier >= 2 ? 1400 : 600);

    // ステップアップ予告
    await stepUp(opts.steps, tier === 4, sfx, wait);
    setColor(shown);
    ringAlpha = 0.06;
    ringSpeed = 0.2;
    await wait(250);

    // リールが現れて回り出す
    const reels = makeReels(shown);
    reels.spinAll();
    sfx.sample?.('sfx-respin', { gain: 0.6 });
    await reels.show();
    ringAlpha = 0.18;
    ringSpeed = 0.5;

    // 2. 再変動
    for (let i = 1; i <= pseudo; i += 1) {
      await wait(550);
      for (const k of [0, 2, 1]) {
        await reels.stop(k, rnd(), 200);
        sfx.sample?.('sfx-stop', { gain: 0.8 });
        await wait(80);
      }
      await wait(350);
      if (i >= 2 && shown < tier - 1) upgrade(shown + 1, { x: W() / 2, y: H() * 0.45 });
      sfx.sample?.('sfx-respin', { gain: 0.9 });
      strobe(shown, 3);
      vibrate(50);
      const call = await slam(`再変動×${i + 1}`, shown, H() * 0.24, H() * 0.1);
      ringSpeed = 0.5 + i * 0.3;
      reels.spinAll();
      await wait(650);
      call.leave();
    }

    // 役物が落ちてくる（赤以上のときだけ）
    if (opts.gimmick) {
      await wait(300);
      reels.set.visible = false;
      await gimmick(Math.max(shown, 2), sfx, wait);
      reels.set.visible = true;
    }

    // 3. リーチ
    await wait(450);
    const band = cutIn('リーチ', shown, opts.pattern);
    sfx.sample?.('sfx-cutin', { gain: 1 });
    sfx.sample?.('voice-reach', { gain: 1.35, at: 0.18 });
    await band.enter();
    vibrate(80);
    await wait(1100);
    await band.leave();

    const lastBeforePush = withPush && shown < tier ? tier - 1 : tier;
    if (tier === 4) {
      await zenkaiten(reels, lastBeforePush, upgrade, () => shown, sfx, wait);
    } else {
      await crawl(reels, lastBeforePush, upgrade, () => shown, opts, sfx, wait, vibrate);
    }
    for (const i of [0, 1, 2]) reels.setReach(i, false);
    await wait(650);
    tween(camState, { zoom: 1 }, 300);
    await reels.hide();

    // 5〜8. 押せ！ → 無音の暗転 → 結果
    await run({ ...opts, shown });
  }

  // 4. 左 → 右と止まり、真ん中は1コマずつ粘る
  async function crawl(reels, lastBeforePush, upgrade, getShown, { tier, values }, sfx, wait, vibrate) {
    await wait(250);
    const hours = Math.min(9, Number(values[0]));
    await reels.stop(0, hours);
    sfx.sample?.('sfx-stop', { gain: 1 });
    await wait(550);
    await reels.stop(2, Number(values[2]));
    sfx.sample?.('sfx-stop', { gain: 1 });
    reels.setReach(1, true);
    rays.alpha = 0.14;
    ringSpeed = 1.1;
    ringAlpha = 0.25;
    if (tier >= 2) { sfx.sample?.('sfx-heartbeat', { gain: 0.9 }); beat(getShown(), 0.5); }
    await reels.slow(1, 1100);

    const target = Number(values[1]);
    const stopAt = tier >= 2 ? (target + 9) % 10 : target; // 赤以上は1コマ手前で止めて見せる
    let ups = lastBeforePush - getShown();
    let count = 0;
    let ms = 150;
    for (;;) {
      const d = await reels.step(1, ms);
      sfx.sample?.('sfx-tick', { gain: 0.9 });
      count += 1;
      ms = Math.min(ms * 1.13, 520);
      camZoom = 1 + Math.min(0.1, count * 0.008);
      if (ups > 0 && count % 2 === 0) { upgrade(getShown() + 1, reels.center(1)); ups -= 1; }
      if (count >= 6 && ups === 0 && d === stopAt) break;
    }
    sfx.sample?.('sfx-stop', { gain: 1 });
    if (tier >= 2) {
      // 止まった…？ 無音で待ってから、すべって揃う
      reels.setReach(1, false);
      await wait(950);
      await reels.step(1, 110);
      sfx.sample?.('sfx-stop', { gain: 1 });
      sfx.sample?.('sfx-upgrade', { gain: 0.9 });
      strobe(getShown(), 4);
      hitStop = 90;
      shakeAmp = 30;
      const at = reels.center(1);
      shockAt(at.x, at.y, 40);
      vibrate(80);
    }
  }

  // 4'. 全回転（虹のとき）：3つが同じ数字のまま回り、7・7・7で止まる
  async function zenkaiten(reels, lastBeforePush, upgrade, getShown, sfx, wait) {
    reels.alignAll();
    sfx.sample?.('sfx-respin', { gain: 1, rate: 1.2 });
    const band = cutIn('全回転', 4, 'kirin');
    sfx.sample?.('sfx-cutin', { gain: 1 });
    sfx.sample?.('voice-zenkaiten', { gain: 1.4, at: 0.15 });
    await band.enter();
    strobe(4, 12);
    rays.alpha = 0.3;
    rays2.alpha = 0.2;
    ringAlpha = 0.35;
    ringSpeed = 2.4;
    if (getShown() < lastBeforePush) upgrade(lastBeforePush, { x: W() / 2, y: H() * 0.45 });
    await wait(1100);
    await band.leave();
    await wait(700);

    let ms = 90;
    let count = 0;
    for (;;) {
      const d = await reels.stepAll(ms);
      sfx.sample?.('sfx-tick', { gain: 0.9, rate: 1 + count * 0.02 });
      count += 1;
      ms = Math.min(ms * 1.12, 400);
      camZoom = 1 + Math.min(0.12, count * 0.008);
      if (count % 2 === 0) beat(getShown(), 0.5);
      if (count >= 12 && d === 7) break;
    }
    // 7・7・7
    reels.flashAll();
    hitStop = 160;
    shakeAmp = 44;
    doFlash(0xffffff, 1, 420);
    shockAt(W() / 2, H() * 0.45, 70);
    strobe(4, 14);
    for (const i of [0, 1, 2]) { const at = reels.center(i); burst(at.x, at.y, 4, 50, 900); }
    sfx.sample?.('sfx-stop', { gain: 1 });
    sfx.sample?.('sfx-impact', { gain: 1 });
    sfx.sample?.('voice-kakutei', { gain: 1.4, at: 0.12 });
    const sure = await slam('確定', 4, H() * 0.22, H() * 0.1);
    await wait(1400);
    sure.leave();
  }

  async function run({ tier, shown, withPush, sub, minutes, sfx, wait, waitTap, vibrate, onUpgrade }) {
    let current = shown;
    setColor(current);
    canvas.style.opacity = '1';

    // ---- 押せ！ ----
    if (withPush) {
      ringAlpha = 0.3;
      rays.alpha = 0.12;
      const button = new PIXI.Container();
      button.position.set(W() / 2, H() / 2);
      const size = Math.min(W(), H()) * 0.62;
      const halo = new PIXI.Sprite(tx.ring);
      halo.anchor.set(0.5);
      halo.blendMode = 'add';
      halo.width = halo.height = size * 1.55;
      halo.tint = TIER_COLOR[current];
      const dome = new PIXI.Sprite(tx.dome);
      dome.anchor.set(0.5);
      dome.width = dome.height = size;
      dome.tint = TIER_COLOR[current];
      const bezel = new PIXI.Sprite(tx.bezel);
      bezel.anchor.set(0.5);
      bezel.width = bezel.height = size;
      const label = metalText(PIXI, FILTERS, app.renderer, tx, '押せ！', current === 3 ? 0 : 3, size * 0.2);
      label.scale.set(Math.min(1, (size * 0.62) / label.width));
      label.y = size * 0.02;
      button.addChild(halo, dome, bezel, label);
      fgLayer.addChild(button);
      button.scale.set(0);
      tween(button.scale, { x: 1, y: 1 }, 380, easeBack);
      doFlash(TIER_COLOR[current], 0.6, 300);

      let t = 0;
      const charge = (dt) => {
        t += dt;
        const pulse = 1 + 0.06 * Math.sin(t / 48);
        button.scale.set(Math.min(button.scale.x, 1) > 0.99 ? pulse : button.scale.x);
        halo.alpha = 0.55 + 0.45 * Math.sin(t / 48);
        bezel.rotation = Math.sin(t / 900) * 0.05;
        label.tick(dt);
        bloom.bloomScale = 0.8 + 0.5 * (0.5 + 0.5 * Math.sin(t / 48));
        camZoom = 1 + Math.min(1, t / 6000) * 0.14;
        shakeAmp = Math.max(shakeAmp, Math.min(1, t / 6000) * 6);
        ringSpeed = 0.35 + Math.min(1, t / 6000) * 0.9;
        // 光が吸い込まれていく
        if (Math.random() < 0.6) {
          const a = rand(0, Math.PI * 2);
          const r = Math.hypot(W(), H()) * 0.55;
          spawn('spark', tx.dot, {
            x: W() / 2 + Math.cos(a) * r, y: H() / 2 + Math.sin(a) * r,
            vx: -Math.cos(a) * 200, vy: -Math.sin(a) * 200, pull: 2600, life: 1.2, size: rand(0.5, 1.1), tint: Math.random() < 0.5 ? 0xffffff : TIER_COLOR[current],
          });
        }
      };
      updaters.add(charge);
      const riser = sfx.sample?.('sfx-riser', { gain: 0.9 });
      sfx.sample?.('voice-push', { gain: 1.3 });
      await waitTap(6000);
      updaters.delete(charge);
      riser?.stop(0.03);

      // 押した：へこむ → 白 → 一瞬止まる → 衝撃波
      sfx.sample?.('sfx-push', { gain: 1 });
      vibrate(120);
      await tween(button.scale, { x: 0.82, y: 0.82 }, 70, easeIn);
      if (current < tier) {
        current = tier;
        onUpgrade?.(current);
        setColor(current);
        dome.tint = TIER_COLOR[current];
        halo.tint = TIER_COLOR[current];
      }
      doFlash(0xffffff, 1, 220);
      hitStop = 150;
      shakeAmp = 24;
      shockAt(W() / 2, H() / 2, 50);
      await wait(220);
      tween(button.scale, { x: 2.6, y: 2.6 }, 240, easeIn);
      tween(button, { alpha: 0 }, 240);
      await wait(200);
      button.destroy({ children: true });
    } else {
      ringAlpha = 0.5;
    }

    // ---- 無音の暗転 ----
    black.alpha = 1;
    ringAlpha = 0;
    rays.alpha = 0;
    for (const p of [...parts]) { p.sprite.destroy(); parts.delete(p); }
    bloom.bloomScale = 0.9;
    camZoom = 1.3;
    const seed = new PIXI.Sprite(tx.glint);
    seed.anchor.set(0.5);
    seed.blendMode = 'add';
    seed.position.set(W() / 2, H() / 2);
    seed.scale.set(0);
    app.stage.addChild(seed);
    const dark = tier >= 2 ? 650 : 300;
    await wait(dark - 220);
    tween(seed.scale, { x: 1.4, y: 1.4 }, 220, easeIn); // 最後の一瞬だけ、中心に光の種
    tween(seed, { rotation: 1.2 }, 220);
    await wait(220);
    seed.destroy();

    // ---- 結果 ----
    setColor(tier);
    black.alpha = 0;
    rays.alpha = 0.4;
    rays2.alpha = tier >= 3 ? 0.22 : 0;
    ringAlpha = 0.12;
    ringSpeed = 1.2;
    bg.tint = TIER_COLOR[tier];
    later(() => { bg.tint = TIER_DARK[tier]; }, 700);

    const text = ['おつかれさま！', 'ナイス研究！', '激アツ！', '大当たり！', '超大当たり！！'][tier];
    const logo = metalText(PIXI, FILTERS, app.renderer, tx, text, tier, 120);
    const fit = Math.min((W() * 0.86) / logo.width, (H() * 0.3) / logo.height);
    logo.position.set(W() / 2, H() * 0.45);
    logo.scale.set(fit * 3.2);
    logo.alpha = 0;
    fgLayer.addChild(logo);
    updaters.add((dt) => logo.tick(dt));

    const subText = new PIXI.Text({
      text: sub,
      style: { fontFamily: 'system-ui, "Hiragino Sans", sans-serif', fontWeight: '800', fontSize: Math.min(22, W() * 0.052), fill: 0xffffff, dropShadow: { color: 0x000000, blur: 6, distance: 0, alpha: 0.9 } },
      resolution: 2,
    });
    subText.anchor.set(0.5);
    const plate = new PIXI.Graphics()
      .roundRect(-subText.width / 2 - 18, -subText.height / 2 - 8, subText.width + 36, subText.height + 16, 12)
      .fill({ color: 0x000000, alpha: 0.55 })
      .stroke({ color: TIER_COLOR[tier], width: 2, alpha: 0.9 });
    const subBox = new PIXI.Container();
    subBox.addChild(plate, subText);
    subBox.position.set(W() / 2, H() * 0.45 + logo.height / 3.2 * 0.55 + 40);
    subBox.alpha = 0;
    fgLayer.addChild(subBox);

    // 叩きつけ：大きく速く寄ってきて、当たった瞬間に止まる
    zoom.center = { x: W() / 2, y: H() * 0.45 };
    zoom.strength = 0.45;
    tween(zoom, { strength: 0 }, 700);
    tween(camState, { zoom: 1 }, 500, easeOut);
    doFlash(0xffffff, 1, 400);
    sfx.sample?.('sfx-impact', { gain: 1 });
    tween(logo, { alpha: 1 }, 120);
    await tween(logo.scale, { x: fit * 0.94, y: fit * 0.94 }, 200, easeIn);
    hitStop = 90;
    shakeAmp = tier >= 2 ? 34 : 16;
    shockAt(W() / 2, H() * 0.45, 60);
    vibrate(tier >= 3 ? [80, 60, 80, 60, 300] : [60]);
    sfx.sample?.(`sfx-fanfare-${tier}`, { gain: 0.95 });
    sfx.sample?.(`voice-${tier}`, { gain: 1.4, at: 0.15 });
    burst(W() / 2, H() * 0.45, tier, [40, 70, 110, 160, 220][tier], 900 + tier * 150);
    tween(logo.scale, { x: fit, y: fit }, 260, easeBack);
    tween(subBox, { alpha: 1 }, 300);

    // 色の連打（金・虹）
    if (tier >= 2) {
      const n = [0, 0, 4, 10, 16][tier];
      for (let i = 0; i < n; i += 1) {
        later(() => doFlash(i % 2 ? TIER_COLOR[tier] : 0xffffff, 0.8, 70), 120 + i * 75);
      }
    }
    confettiRain(tier, 1800 + tier * 400 + 2500);
    if (tier >= 2) {
      later(() => burst(W() * 0.22, H() * 0.4, tier, 60, 700), 350);
      later(() => burst(W() * 0.78, H() * 0.4, tier, 60, 700), 550);
    }
    let t = 0;
    updaters.add((dt) => {
      t += dt;
      bloom.bloomScale = 0.95 + 0.3 * Math.sin(t / 120);
      logo.rotation = Math.sin(t / 700) * 0.015;
    });
    await wait(1300);
    await payout(tier, minutes, sfx, wait);
    await wait(500 + tier * 200);
    await tween(world, { alpha: 0 }, 300);
  }

  return {
    start,
    stop,
    milestone,
    weekly,
    destroy() {
      destroyed = true;
      timers.forEach(clearTimeout);
      app.destroy({ removeView: true }, { children: true, texture: true });
      for (const t of Object.values(tx)) t.destroy(true);
    },
  };
}
