// 演出の再生。記録の処理とは切り離してあり、ここを外してもタイムカードは動く。
// 流れと秒数は docs/effects.md の演出表に合わせる。

import { formatDuration } from '../logic.js';
import { createParticles } from './particles.js';
import { createSound } from './sound.js';
import { createFinale, loadFinale } from './finale.js';

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

const sound = createSound();
const silent = new Proxy({}, { get: () => () => {} });
let current = null;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 音とWebGLの部品を前もって読み込んでおく（初回の演出で待たないように）
export function warmUp(settings) {
  if (!settings.on) return;
  if (settings.sound) sound.preload();
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500));
  idle(() => { loadFinale().catch(() => {}); });
}

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
  root.innerHTML = '<div class="fx-shade"></div><div class="fx-glow"></div><div class="fx-rays"></div><div class="fx-lines"></div>'
    + '<canvas class="fx-canvas"></canvas><div class="fx-stage"></div><div class="fx-leds"></div><div class="fx-black"></div><div class="fx-flash"></div>';
  document.body.append(root);
  const [shade, glow, rays, lines, canvas, stage, leds, black, flashLayer] = root.children;
  const particles = createParticles(canvas);
  const timers = new Set();
  let finale = null;

  // 「押せ！」の間だけ、タップは飛ばすのではなくボタンを押したことになる
  let onPush = null;
  const skip = () => controller.abort(new DOMException('skip', 'AbortError'));
  const tap = () => {
    if (onPush) onPush();
    else skip();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') skip();
    else if (event.key === 'Enter' || event.key === ' ') tap();
    else return;
    event.preventDefault();
  };
  root.addEventListener('pointerdown', tap);
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

    // タップ（または Enter・Space）か、ms が過ぎるのを待つ
    waitTap(ms) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(done, ms);
        function done() { clearTimeout(timer); onPush = null; resolve(); }
        onPush = done;
        signal.addEventListener('abort', () => { clearTimeout(timer); onPush = null; reject(signal.reason); }, { once: true });
      });
    },

    // WebGL の結果部分。使えない端末では null（CSSの結果に戻る）
    prepareFinale() {
      return createFinale(root)
        .then((f) => {
          if (signal.aborted) { f.destroy(); return null; }
          finale = f;
          return f;
        })
        .catch((error) => { console.warn('finale unavailable', error); return null; });
    },

    hideStage() {
      for (const el of [stage, lines, leds, glow, rays]) el.animate([{}, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    },
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

    // 画面全体の光
    flash(tier = null, duration = 280) {
      flashLayer.style.background = tier == null ? '#fff' : LINE_COLOR[TIERS[tier]];
      flashLayer.animate([{ opacity: 0 }, { opacity: tier == null ? 0.95 : 0.75 }, { opacity: 0 }], { duration });
    },

    // 白と色を交互に連打する
    strobe(tier, count, gap = 75) {
      for (let i = 0; i < count; i += 1) later(() => this.flash(i % 2 ? tier : null, gap * 1.4), i * gap);
    },

    // 一瞬すべてを消す（無音の溜め）
    blackout(on) {
      black.style.opacity = on ? '1' : '0';
    },

    // 「押せ！」。押すか timeout で進む
    async push(tier, timeout) {
      const el = add(`<div class="fx-push" data-tier="${TIERS[tier]}"><span>押せ！</span></div>`);
      el.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.15)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out', fill: 'forwards' });
      sfx.riser(timeout / 1000);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, timeout);
          onPush = () => { clearTimeout(timer); resolve(); };
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        });
      } finally {
        onPush = null;
      }
      sfx.cut();
      sfx.push();
      this.vibrate(120);
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.8)' }, { transform: 'scale(2.5)', opacity: 0 }], { duration: 260, fill: 'forwards' })
        .finished.then(() => el.remove()).catch(() => {});
    },

    // 画面中央に大きく出す文字（再変動など）
    callout(text, tier) {
      const el = add(`<p class="fx-big fx-callout" data-tier="${TIERS[tier]}" style="--n: ${[...text].length}">${text}</p>`);
      el.animate(
        [{ transform: 'scale(2.6)', opacity: 0 }, { transform: 'scale(.95)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 300, easing: 'ease-out', fill: 'forwards' },
      );
      return el;
    },

    // 画面のふちを走る電飾。fast でリーチ中の速さになる
    leds(tier, fast = false) {
      leds.dataset.tier = TIERS[tier];
      leds.classList.add('on');
      leds.classList.toggle('fast', fast);
    },

    // 中央から色の光が脈打つ（1秒に2回）
    glow(tier) {
      glow.dataset.tier = TIERS[tier];
      glow.classList.add('on');
    },

    // 結果の後ろで回る太い光線
    rays(tier) {
      rays.dataset.tier = TIERS[tier];
      rays.classList.add('on');
    },

    // 画面のあちこちできらめく
    twinkle(count, seconds) {
      particles.twinkle({ count, seconds });
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
          if (s.slowing) {
            // 本物のリールのように1コマずつ送る
            cell.textContent = String((Number(cell.textContent) + 1) % 10);
            s.delay = Math.min(s.delay * 1.12, 420);
          } else {
            cell.textContent = String(Math.floor(Math.random() * 10));
          }
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
          cell.animate([{ filter: 'brightness(2.6)', boxShadow: '0 0 1.2em #fff' }, {}], { duration: 320 });
        },
        // 目の数字の1コマ手前で止まったように見せる
        tease(i) {
          state[i].stopped = true;
          cells[i].textContent = String((Number(values[i]) + 9) % 10);
          cells[i].classList.remove('spin');
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
        particles.rain({ count: tier === 4 ? 160 : 90, kinds: tier === 4 ? ['coin', 'star'] : ['coin'], colors: COLORS[id] });
      }
      if (tier >= 2 && scale >= 1) {
        // 少し遅れて左右でもう一度はじける
        for (const [dx, delay] of [[-0.28, 350], [0.28, 550]]) {
          later(() => particles.burst(origin.x + innerWidth * dx, origin.y - innerHeight * 0.05, {
            count: Math.round([0, 0, 40, 60, 90][tier]), kinds, colors: COLORS[id], speed: 300 + tier * 100,
          }), delay);
        }
      }
    },

    calmText(text, sub = '') {
      const el = add(`<div class="fx-result"><p class="fx-calm">${text}</p>${sub ? `<p class="fx-sub">${sub}</p>` : ''}</div>`);
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' });
    },

    close(aborted, skippedByUser) {
      root.removeEventListener('pointerdown', tap);
      document.removeEventListener('keydown', onKey, true);
      timers.forEach(clearTimeout);
      finale?.destroy();
      finale = null;
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
    fx.dim(0.75);
    fx.ring(origin, tier);
    fx.flash(tier);
    fx.sfx.start();
    fx.vibrate(40);
    fx.lines(tier);
    fx.leds(tier);
    fx.band('研究スタート！', tier);
    fx.twinkle(30, 1.4);
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
    const chance = Math.random;
    // 結果の色は時間で決まる。見せ始める色だけをランダムに下げ、途中で昇格させる
    let shown = Math.max(0, tier - Math.floor(chance() * 3));
    // 色が上ほど長く溜める
    const pseudo = [0, chance() < 0.3 ? 1 : 0, 1, 2, 2][tier] + (tier >= 3 && chance() < 0.5 ? 1 : 0);
    const withPush = tier >= 2 || chance() < 0.25;
    const finaleReady = fx.prepareFinale();

    // 1. 暗転して溜める
    fx.dim(0.96, 400);
    if (tier >= 2) {
      fx.sfx.heartbeat();
      fx.vibrate([30, 150, 30]);
    }
    await fx.wait(tier >= 2 ? 1300 : 600);

    // 2. 再変動（いったん外れ目で止めて、もう一度回す）
    for (let i = 1; i <= pseudo; i += 1) {
      fx.lines(shown);
      fx.leds(shown);
      const fake = fx.reels(values.map(() => String(Math.floor(chance() * 10))), shown);
      await fx.wait(600);
      for (const k of [0, 2, 1]) {
        fake.stop(k);
        fx.sfx.tick();
        await fx.wait(160);
      }
      await fx.wait(350);
      fx.leave(fake.el, 'scale(1.8)');
      if (i >= 2 && shown < tier - 1) shown += 1;
      fx.strobe(shown, 3);
      fx.shake(1.2);
      fx.sfx.up(i);
      fx.vibrate(50);
      const call = fx.callout(`再変動×${i + 1}`, shown);
      await fx.wait(900);
      fx.leave(call, 'scale(.4)');
    }

    // 3. リーチ
    fx.lines(shown);
    fx.leds(shown);
    fx.strobe(shown, 2);
    const band = fx.band('リーチ', shown);
    fx.shake(1.5);
    fx.sfx.hit();
    fx.sfx.sample?.('voice-reach', { gain: 1.3, at: 0.05 });
    fx.vibrate(80);
    await fx.wait(1300);

    // 4. リール。真ん中を最後まで粘る
    fx.leave(band);
    const reels = fx.reels(values, shown);
    await fx.wait(700);
    reels.stop(0);
    fx.sfx.tick();
    await fx.wait(600);
    reels.stop(2);
    fx.sfx.tick();
    reels.slow(1);
    fx.leds(shown, true);
    fx.glow(shown);
    if (tier >= 2) fx.sfx.heartbeat();

    const lastBeforePush = withPush && shown < tier ? tier - 1 : tier;
    while (shown < lastBeforePush) {
      await fx.wait(1000);
      shown += 1;
      reels.color(shown);
      fx.lines(shown);
      fx.leds(shown, true);
      fx.glow(shown);
      fx.strobe(shown, 3);
      fx.shake(0.8);
      fx.sfx.up(shown);
      fx.vibrate(40);
    }
    await fx.wait(1500);

    if (tier >= 2) {
      // 1コマ手前で止まった…と見せてから、すべって揃う
      reels.tease(1);
      fx.sfx.tick();
      await fx.wait(900);
      reels.stop(1);
      fx.strobe(shown, 2);
      fx.shake(1.5);
      fx.sfx.up(shown + 1);
    } else {
      reels.stop(1);
      fx.sfx.tick();
    }
    await fx.wait(600);

    // 5〜7. 押せ！ → 無音の暗転 → 結果（WebGL）
    const finale = await finaleReady;
    if (finale) {
      fx.hideStage();
      await finale.run({
        tier,
        shown,
        withPush,
        sub: `今回 ${formatDuration(length)}・きょう ${formatDuration(today)}`,
        sfx: fx.sfx,
        wait: fx.wait,
        waitTap: (ms) => fx.waitTap(ms),
        vibrate: fx.vibrate,
      });
      return;
    }

    // WebGL が使えないときの CSS 版
    // 5. 押せ！ 最後の昇格はボタンで起きる
    if (withPush) {
      await fx.push(shown, 6000);
      if (shown < tier) {
        shown = tier;
        reels.color(shown);
        fx.glow(shown);
      }
    }

    // 6. 無音の暗転
    fx.blackout(true);
    await fx.wait(tier >= 2 ? 650 : 300);
    fx.blackout(false);

    // 7. 結果
    fx.leave(reels.el, 'translateY(-40%) scale(.6)');
    fx.result(tier, `今回 ${formatDuration(length)}・きょう ${formatDuration(today)}`);
    fx.rays(tier);
    fx.leds(tier, true);
    fx.twinkle(20 + tier * 25, 2.6);
    fx.strobe(tier, [1, 2, 4, 8, 14][tier]);
    fx.shake(tier >= 2 ? 2.2 : 1);
    fx.burst(tier);
    fx.sfx.win(tier);
    fx.vibrate(tier >= 3 ? [80, 60, 80, 60, 300] : [60]);
    await fx.wait(2000 + tier * 400);
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
