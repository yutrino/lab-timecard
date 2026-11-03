// 止める演出の最後（押せ！ → 無音の暗転 → 結果）を WebGL（PixiJS）で描く。
// 発光（ブルーム）、衝撃波のゆがみ、ズームブラー、カメラの寄り引き、当たる瞬間の一瞬の静止（ヒットストップ）を使う。

let modules = null;

export function loadFinale() {
  modules ??= Promise.all([import('../vendor/pixi.min.mjs'), import('../vendor/pixi-filters.mjs')])
    .then(([PIXI, FILTERS]) => ({ PIXI, FILTERS }));
  return modules;
}

const FONT = '"Dela Gothic One", "Hiragino Sans", sans-serif';
const TIER_COLOR = [0x3b82f6, 0x22c55e, 0xff2d3f, 0xffc400, 0xff4fd8];
const TIER_DARK = [0x0b2a7a, 0x064d22, 0x5a0010, 0x5a3a00, 0x3a0a6a];
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

// opts: { root, tier, shown, withPush, sub, sfx, wait, waitTap, vibrate, onUpgrade }
export async function createFinale(root) {
  const { PIXI, FILTERS } = await loadFinale();
  await document.fonts.load(`100px ${FONT}`, '押せ！おつかれさまナイス研究激アツ大当たり超');

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
      } else if (p.kind === 'glint') {
        const g = Math.sin(Math.PI * Math.min(1, p.life / p.max));
        p.sprite.scale.set(g * p.size);
      }
    }
  });
  const spawn = (kind, texture, props, layer = fxLayer) => {
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.blendMode = kind === 'coin' || kind === 'confetti' ? 'normal' : 'add';
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

  async function run({ tier, shown, withPush, sub, sfx, wait, waitTap, vibrate, onUpgrade }) {
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
    // 降ってくるコインと紙吹雪、まわりのきらめき
    const until = performance.now() + 1800 + tier * 400;
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
    await wait(2200 + tier * 450);
    await tween(world, { alpha: 0 }, 300);
  }

  return {
    run,
    destroy() {
      destroyed = true;
      timers.forEach(clearTimeout);
      app.destroy({ removeView: true }, { children: true, texture: true });
      for (const t of Object.values(tx)) t.destroy(true);
    },
  };
}
