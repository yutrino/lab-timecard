// 演出の再生。記録の処理とは切り離してあり、ここを外してもタイムカードは動く。
// 流れと秒数は docs/effects.md の演出表に合わせる。

import { formatDuration } from '../logic.js';
import { createParticles } from './particles.js';
import { createSound } from './sound.js';

const TIERS = ['blue', 'green', 'red', 'gold', 'rainbow'];
const RESULT_TEXT = ['おつかれさま！', 'ナイス研究！', '激アツ！', '大当たり！', '超大当たり！！'];
const RAINBOW = ['#ff3b3b', '#ffb000', '#ffe600', '#2ee66b', '#2fa8ff', '#8b5cff', '#ff4fd8'];
const COLORS = {
  blue: ['#9cc4ff', '#3b82f6', '#ffffff'],
  green: ['#8dffb8', '#22c55e', '#ffffff'],
  red: ['#ff8a8a', '#ff2d3f', '#ffd23f'],
  gold: ['#fff1a8', '#ffc400', '#ff9d00'],
  rainbow: RAINBOW,
};
const LINE_COLOR = { blue: '#7fb2ff', green: '#7dffad', red: '#ff6b6b', gold: '#ffd84d', rainbow: '#ffffff' };
const FLASH_GAP = 400; // 1秒に3回を超えて光らせない

const sound = createSound();
const silent = new Proxy({}, { get: () => () => {} });
let current = null;
let lastFlash = 0;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// settings: { on, sound }
export function playEffect(name, data, settings) {
  if (!settings.on) return;
  if (current) {
    // 前の演出を置き換える。音は先に止め、このあと鳴らす新しい音は止めない
    sound.cut();
    current.abort(new DOMException('replaced', 'AbortError'));
  }
  const controller = new AbortController();
  current = controller;
  const sfx = settings.sound ? sound : silent;
  sfx.unlock?.(); // 押した操作の中で音を使えるようにする
  const reduced = reducedMotion();
  const fx = createStage(controller, sfx, reduced);
  const scene = reduced ? CALM[name] : SCENES[name];
  scene(fx, data)
    .catch((error) => { if (error?.name !== 'AbortError') console.error(error); })
    .finally(() => {
      const { aborted, reason } = controller.signal;
      fx.close(aborted, aborted && reason?.message === 'skip');
      if (current === controller) current = null;
    });
}

function createStage(controller, sfx, reduced) {
  const { signal } = controller;
  const root = document.createElement('div');
  root.className = 'fx';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<div class="fx-shade"></div><div class="fx-lines"></div>'
    + '<canvas class="fx-canvas"></canvas><div class="fx-stage"></div><div class="fx-flash"></div>';
  document.body.append(root);
  const [shade, lines, canvas, stage, flashLayer] = root.children;
  const particles = createParticles(canvas);
  const timers = new Set();

  const skip = () => controller.abort(new DOMException('skip', 'AbortError'));
  const onKey = (event) => {
    if (['Escape', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      skip();
    }
  };
  root.addEventListener('pointerdown', skip);
  document.addEventListener('keydown', onKey, true);

  const add = (html) => {
    stage.insertAdjacentHTML('beforeend', html);
    return stage.lastElementChild;
  };
  const center = () => ({ x: innerWidth / 2, y: innerHeight * 0.45 });
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };

  return {
    sfx,
    wait: (ms) => sleep(ms, signal),
    vibrate: (pattern) => { if (!reduced) navigator.vibrate?.(pattern); },

    dim(opacity, duration = 150) {
      shade.animate([{ opacity: 0 }, { opacity }], { duration, fill: 'forwards' });
    },

    lines(tier) {
      lines.style.setProperty('--line', LINE_COLOR[TIERS[tier]]);
      lines.classList.add('on');
    },

    shake(level = 1) {
      const a = 7 * level;
      stage.animate(
        [0, -a, a, -a * 0.6, a * 0.6, -a * 0.3, 0].map((x, i) => ({ transform: `translate(${x}px, ${i % 2 ? a / 2 : -a / 2}px)` })),
        { duration: 320, easing: 'linear' },
      );
    },

    flash() {
      const now = performance.now();
      if (now - lastFlash < FLASH_GAP) return;
      lastFlash = now;
      flashLayer.animate([{ opacity: 0 }, { opacity: 0.85 }, { opacity: 0 }], { duration: 260 });
    },

    // 斜めの帯が右から飛び込む
    band(text, tier) {
      const el = add(`<div class="fx-band" data-tier="${TIERS[tier]}"><span>${text}</span></div>`);
      el.animate(
        [
          { transform: 'translateX(110%) skewY(-6deg)' },
          { transform: 'translateX(-5%) skewY(-6deg)', offset: 0.7 },
          { transform: 'translateX(0) skewY(-6deg)' },
        ],
        { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
      );
      return el;
    },

    leave(el, to = 'translateX(-110%) skewY(-6deg)') {
      el.animate([{}, { transform: to, opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' })
        .finished.then(() => el.remove()).catch(() => {});
    },

    // 数字リール。止めるまで乱数で回し続ける
    reels(values, tier) {
      const el = add(
        `<div class="fx-reels" data-tier="${TIERS[tier]}">`
        + values.map((v, i) => `${i === 1 ? '<span class="fx-colon">:</span>' : ''}<span class="fx-reel spin">${v}</span>`).join('')
        + '</div>',
      );
      el.animate([{ transform: 'scale(.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
      const cells = [...el.querySelectorAll('.fx-reel')];
      const state = cells.map(() => ({ delay: 55, slowing: false, stopped: false }));
      cells.forEach((cell, i) => {
        const step = () => {
          const s = state[i];
          if (s.stopped) return;
          cell.textContent = String(Math.floor(Math.random() * 10));
          if (s.slowing) s.delay = Math.min(s.delay * 1.15, 300);
          later(step, s.delay);
        };
        step();
      });
      return {
        el,
        stop(i) {
          state[i].stopped = true;
          const cell = cells[i];
          cell.textContent = values[i];
          cell.classList.remove('spin', 'reach');
          cell.animate([{ transform: 'translateY(-18%)' }, { transform: 'translateY(6%)' }, { transform: 'none' }], { duration: 180 });
        },
        slow(i) {
          state[i].slowing = true;
          cells[i].classList.add('reach');
        },
        color(t) {
          el.dataset.tier = TIERS[t];
          el.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'ease-out' });
        },
      };
    },

    result(tier, sub) {
      const el = add(
        `<div class="fx-result"><p class="fx-big" data-tier="${TIERS[tier]}" style="--n: ${[...RESULT_TEXT[tier]].length}">${RESULT_TEXT[tier]}</p>`
        + `<p class="fx-sub">${sub}</p></div>`,
      );
      el.firstElementChild.animate(
        [
          { transform: 'scale(3.2) rotate(-6deg)', opacity: 0 },
          { transform: 'scale(.9) rotate(0)', opacity: 1, offset: 0.6 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' },
      );
      el.lastElementChild.animate([{ opacity: 0, transform: 'translateY(.5em)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 350, fill: 'forwards' });
      return el;
    },

    stamp(text) {
      const el = add(`<p class="fx-stamp">${text}</p>`);
      el.animate(
        [{ transform: 'scale(2.4) rotate(-8deg)', opacity: 0 }, { transform: 'scale(1) rotate(-8deg)', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'forwards' },
      );
      return el;
    },

    ring(origin, tier) {
      particles.ring(origin.x, origin.y, LINE_COLOR[TIERS[tier]]);
    },

    burst(tier, origin = center(), scale = 1) {
      const id = TIERS[tier];
      const kinds = tier >= 3 ? ['coin', 'star', 'spark'] : tier >= 2 ? ['star', 'spark'] : ['spark', 'star'];
      particles.burst(origin.x, origin.y, {
        count: Math.round([28, 44, 70, 110, 170][tier] * scale),
        kinds,
        colors: COLORS[id],
        speed: 380 + tier * 130,
      });
      if (tier >= 3 && scale >= 1) {
        particles.rain({ count: tier === 4 ? 130 : 70, kinds: tier === 4 ? ['coin', 'star'] : ['coin'], colors: COLORS[id] });
      }
    },

    calmText(text, sub = '') {
      const el = add(`<div class="fx-result"><p class="fx-calm">${text}</p>${sub ? `<p class="fx-sub">${sub}</p>` : ''}</div>`);
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' });
    },

    close(aborted, skippedByUser) {
      root.removeEventListener('pointerdown', skip);
      document.removeEventListener('keydown', onKey, true);
      timers.forEach(clearTimeout);
      if (skippedByUser) sfx.cut?.();
      root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: aborted ? 120 : 300, fill: 'forwards' })
        .finished.catch(() => {}).then(() => { particles.stop(); root.remove(); });
    },
  };
}

// ---- 場面 ----

const SCENES = {
  // data: { origin: {x, y}, streak }
  async start(fx, { origin, streak }) {
    const tier = streak >= 5 ? 3 : streak >= 3 ? 2 : streak >= 2 ? 1 : 0;
    fx.dim(0.7);
    fx.ring(origin, tier);
    fx.sfx.start();
    fx.vibrate(40);
    fx.lines(tier);
    fx.band('研究スタート！', tier);
    await fx.wait(700);
    if (streak >= 2) {
      fx.stamp(`${streak}日連続！`);
      fx.sfx.up(tier);
      fx.burst(tier, undefined, 0.5);
      await fx.wait(700);
    }
    await fx.wait(500);
  },

  // data: { length, today, tier }
  async stop(fx, { length, today, tier }) {
    const minutes = Math.floor(length / 60000);
    const values = [String(Math.floor(minutes / 60)), String(Math.floor((minutes % 60) / 10)), String(minutes % 10)];
    // 結果の色は時間で決まる。見せ始める色だけをランダムに下げ、途中で昇格させる
    let shown = Math.max(0, tier - Math.floor(Math.random() * 3));

    fx.dim(0.94);
    await fx.wait(250); // 溜め
    fx.lines(shown);
    const band = fx.band('リーチ', shown);
    fx.shake(1.2);
    fx.sfx.hit();
    fx.vibrate(60);
    await fx.wait(800);

    fx.leave(band);
    const reels = fx.reels(values, shown);
    await fx.wait(450);
    reels.stop(0);
    fx.sfx.tick();
    await fx.wait(400);
    reels.stop(2);
    fx.sfx.tick();

    reels.slow(1);
    while (shown < tier) {
      await fx.wait(600);
      shown += 1;
      reels.color(shown);
      fx.lines(shown);
      fx.flash();
      fx.shake(0.6);
      fx.sfx.up(shown);
      fx.vibrate(30);
    }
    await fx.wait(700);
    reels.stop(1);
    fx.sfx.tick();
    await fx.wait(250);

    fx.leave(reels.el, 'translateY(-40%) scale(.6)');
    fx.result(tier, `今回 ${formatDuration(length)}・きょう ${formatDuration(today)}`);
    fx.flash();
    fx.shake(tier >= 2 ? 2 : 1);
    fx.burst(tier);
    fx.sfx.win(tier);
    fx.vibrate(tier >= 3 ? [80, 60, 80, 60, 200] : [60]);
    await fx.wait(1700 + tier * 300);
  },
};

// 「視差効果を減らす」がオンのとき：揺れ・光・粒子なしで文字だけ
const CALM = {
  async start(fx, { streak }) {
    fx.dim(0.7);
    fx.calmText('研究スタート', streak >= 2 ? `${streak}日連続` : '');
    await fx.wait(1200);
  },
  async stop(fx, { length, today, tier }) {
    fx.dim(0.8);
    fx.calmText(RESULT_TEXT[tier], `今回 ${formatDuration(length)}・きょう ${formatDuration(today)}`);
    await fx.wait(1600);
  },
};
