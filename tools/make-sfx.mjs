// 演出の効果音を合成して sounds/ に書き出す。`npm run sfx`。
// 素材ファイルを使わず、ここで計算した音だけで作る（ライセンスの心配がない）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SR = 44100;
const OUT = new URL('../sounds/', import.meta.url).pathname;
const TAU = Math.PI * 2;

// ---- 道具 ----

const track = (seconds) => [new Float32Array(Math.ceil(SR * seconds)), new Float32Array(Math.ceil(SR * seconds))];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
let seed = 1;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 31 - 1;
};

function env(t, { a = 0.005, d = 0.1, s = 0.7, r = 0.2, hold }) {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < hold) return s;
  const k = (t - hold) / r;
  return k < 1 ? s * (1 - k) ** 2 : 0;
}

function addTo(out, start, fn, seconds, pan = 0) {
  const i0 = Math.floor(start * SR);
  const n = Math.floor(seconds * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4);
  const gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && i0 + i < out[0].length; i += 1) {
    const v = fn(i / SR);
    out[0][i0 + i] += v * gl;
    out[1][i0 + i] += v * gr;
  }
}

// 金管風：倍音を足し、明るさを時間で変える（フィルターを開くのと同じ効果）
function brass(out, start, note, len, { gain = 0.2, pan = 0, bright = 1 } = {}) {
  const hold = len;
  const total = len + 0.35;
  for (const [cents, p] of [[-7, pan - 0.3], [0, pan], [7, pan + 0.3]]) {
    const f = midi(note) * 2 ** (cents / 1200);
    let phase = Math.random() * TAU;
    addTo(out, start, (t) => {
      const e = env(t, { a: 0.03, d: 0.15, s: 0.75, r: 0.3, hold });
      const b = (2 + 16 * bright * Math.min(1, t / 0.08)) * (0.6 + 0.4 * e);
      const vib = 1 + 0.004 * Math.sin(TAU * 5.5 * t) * Math.min(1, t / 0.3);
      phase += TAU * f * vib / SR;
      let v = 0;
      for (let h = 1; h <= 24 && f * h < 16000; h += 1) v += Math.sin(phase * h) * Math.exp(-h / b) / h;
      return v * e * gain;
    }, total, p);
  }
}

function chord(out, start, notes, len, opts) {
  for (const n of notes) brass(out, start, n, len, opts);
}

// ティンパニ風の重い太鼓
function drum(out, start, { freq = 70, gain = 0.8, decay = 0.5 } = {}) {
  addTo(out, start, (t) => {
    const f = freq * (1 + 1.5 * Math.exp(-t * 30));
    return Math.sin(TAU * f * t) * Math.exp(-t / decay) * gain + noise() * Math.exp(-t * 120) * 0.12 * gain;
  }, decay * 5);
}

// 2次フィルター（RBJ）。cutoff は時間の関数でもよい
function filtered(src, type, cutoff, q = 0.7) {
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  return (t) => {
    const fc = typeof cutoff === 'function' ? cutoff(t) : cutoff;
    const w = TAU * Math.min(fc, SR * 0.45) / SR;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    let b0; let b1; let b2;
    if (type === 'low') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
    else if (type === 'high') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; }
    const a0 = 1 + alpha; const a1 = -2 * cos; const a2 = 1 - alpha;
    const x = src(t);
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// きらきら：高いベルの分散和音
function shimmer(out, start, notes, step = 0.05, gain = 0.07) {
  notes.forEach((n, i) => {
    const f = midi(n);
    addTo(out, start + i * step, (t) => {
      const e = Math.exp(-t * 3);
      return (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 2.01 * t) + 0.2 * Math.sin(TAU * f * 3.98 * t)) * e * gain;
    }, 1.6, (i % 2 ? 0.6 : -0.6) * Math.random());
  });
}

// Freeverb（くし形フィルター8本＋全域通過4本）
function reverb(input, { room = 0.84, damp = 0.25, wet = 0.3, width = 1 } = {}) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const alls = [556, 441, 341, 225];
  const out = [new Float32Array(input[0].length), new Float32Array(input[0].length)];
  for (let ch = 0; ch < 2; ch += 1) {
    const spread = ch ? 23 : 0;
    const cb = combs.map((n) => ({ buf: new Float32Array(n + spread), i: 0, store: 0 }));
    const ab = alls.map((n) => ({ buf: new Float32Array(n + spread), i: 0 }));
    const src = input[0].map((v, i) => (v + input[1][i]) * 0.015);
    for (let i = 0; i < src.length; i += 1) {
      let acc = 0;
      for (const c of cb) {
        const y = c.buf[c.i];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.i] = src[i] + c.store * room;
        c.i = (c.i + 1) % c.buf.length;
        acc += y;
      }
      for (const a of ab) {
        const y = a.buf[a.i];
        a.buf[a.i] = acc + y * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        acc = y - acc;
      }
      out[ch][i] = acc;
    }
  }
  const dry = 1 - wet * 0.5;
  return [0, 1].map((ch) => input[ch].map((v, i) => v * dry + (out[ch][i] * (1 + width) / 2 + out[1 - ch][i] * (1 - width) / 2) * wet * 3));
}

function write(name, buffers, { verb, tail = 0 } = {}) {
  let data = buffers;
  if (tail) data = data.map((ch) => { const b = new Float32Array(ch.length + tail * SR); b.set(ch); return b; });
  if (verb) data = reverb(data, verb);
  // やわらかく飽和させてから -1dB に揃える
  data = data.map((ch) => ch.map((v) => Math.tanh(v * 0.7) / 0.7));
  const peak = Math.max(...data.map((ch) => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  const k = 0.89 / (peak || 1);
  const n = data[0].length;
  const wav = Buffer.alloc(44 + n * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i += 1) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[0][i] * k)) * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[1][i] * k)) * 32767), 46 + i * 4);
  }
  const tmp = path.join(os.tmpdir(), `${name}.wav`);
  fs.writeFileSync(tmp, wav);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', '160k', path.join(OUT, `${name}.mp3`)]);
  fs.rmSync(tmp);
  console.log(name, (n / SR).toFixed(2), 's');
}

// ---- 音 ----

const filteredWhoosh = filtered(() => noise(), 'band', (t) => 400 * 15 ** Math.min(1, t / 0.24), 1.5);
const filteredCrash = filtered(() => noise(), 'high', 5000, 0.5);

// 押せ！の間ずっと上がり続ける溜め（6秒）
{
  const out = track(6.2);
  addTo(out, 0, filtered(() => noise(), 'band', (t) => 300 * 20 ** (t / 6), 2.5), 6.2);
  for (const [n, p] of [[45, -0.5], [52, 0.5], [57, 0]]) {
    let ph = 0;
    addTo(out, 0, (t) => {
      ph += TAU * midi(n) * 2 ** (t / 6) / SR;
      let v = 0;
      for (let h = 1; h < 12; h += 1) v += Math.sin(ph * h) / h;
      return v * 0.05 * (t / 6) ** 1.5;
    }, 6.2, p);
  }
  // 速くなっていく刻み
  for (let t = 0, gap = 0.3; t < 6; t += gap, gap = Math.max(0.05, gap * 0.92)) {
    addTo(out, t, (u) => Math.sin(TAU * (1200 + t * 150) * u) * Math.exp(-u * 60) * 0.25, 0.08, (Math.random() - 0.5));
  }
  const gainUp = (ch) => ch.map((v, i) => v * (0.25 + 0.75 * (i / ch.length)));
  write('sfx-riser', out.map(gainUp), { verb: { wet: 0.2 } });
}

// ボタンを押した「ガコン」
{
  const out = track(0.8);
  addTo(out, 0, (t) => [1, 2.76, 5.4, 8.93].reduce((v, m, i) => v + Math.sin(TAU * 190 * m * t) * Math.exp(-t * (14 + i * 8)), 0) * 0.35, 0.6);
  addTo(out, 0, (t) => Math.sin(TAU * (95 * (1 + 2 * Math.exp(-t * 40))) * t) * Math.exp(-t * 9) * 0.9, 0.6);
  addTo(out, 0, filtered(() => noise(), 'high', 2500), 0.03);
  write('sfx-push', out, { verb: { wet: 0.25, room: 0.7 }, tail: 0.4 });
}

// 結果の着弾：重低音＋破裂＋シンバル
{
  const out = track(3);
  const filteredNoiseHigh = filtered(() => noise(), 'high', 5000, 0.5);
  const filteredNoiseHigh2 = filtered(() => noise(), 'high', 5000, 0.5);
  addTo(out, 0, (t) => Math.sin(TAU * (32 + 60 * Math.exp(-t * 6)) * t) * Math.exp(-t * 1.6) * 1.0, 2.5);
  addTo(out, 0, filtered(() => noise(), 'low', (t) => 200 + 6000 * Math.exp(-t * 12)), 0.6);
  addTo(out, 0.005, (t) => filteredNoiseHigh(t) * Math.exp(-t * 1.8) * 0.5, 2.5, -0.4);
  addTo(out, 0.012, (t) => filteredNoiseHigh2(t) * Math.exp(-t * 1.7) * 0.5, 2.5, 0.4);
  write('sfx-impact', out, { verb: { wet: 0.35, room: 0.88 } });
}

// リールが止まる「カシャン」
{
  const out = track(0.6);
  addTo(out, 0, filtered(() => noise(), 'high', 3000), 0.025);
  addTo(out, 0, (t) => Math.sin(TAU * (150 * (1 + Math.exp(-t * 60))) * t) * Math.exp(-t * 30) * 0.8, 0.2);
  addTo(out, 0.01, (t) => (Math.sin(TAU * 2200 * t) + 0.5 * Math.sin(TAU * 3300 * t)) * Math.exp(-t * 14) * 0.18, 0.4);
  write('sfx-stop', out, { verb: { wet: 0.15, room: 0.6 } });
}

// 1コマ送りの「カチッ」
{
  const out = track(0.12);
  addTo(out, 0, filtered(() => noise(), 'band', 2500, 3), 0.02);
  addTo(out, 0, (t) => Math.sin(TAU * 900 * t) * Math.exp(-t * 80) * 0.5, 0.08);
  write('sfx-tick', out);
}

// カットイン：風を切る音から着弾
{
  const out = track(1.4);
  addTo(out, 0, (t) => filteredWhoosh(t) * Math.min(1, t / 0.22) ** 2, 0.26);
  addTo(out, 0.24, (t) => Math.sin(TAU * (40 + 90 * Math.exp(-t * 10)) * t) * Math.exp(-t * 3.5) * 1.0, 1.1);
  addTo(out, 0.24, filtered(() => noise(), 'low', (t) => 300 + 5000 * Math.exp(-t * 14)), 0.5);
  addTo(out, 0.245, (t) => filteredCrash(t) * Math.exp(-t * 3) * 0.35, 1.1);
  write('sfx-cutin', out, { verb: { wet: 0.3, room: 0.85 } });
}

// 昇格：駆け上がるベル
{
  const out = track(1.6);
  shimmer(out, 0, [72, 76, 79, 84, 88, 91, 96], 0.045, 0.11);
  [72, 76, 79, 84].forEach((n, i) => brass(out, i * 0.045, n + 12, 0.05, { gain: 0.05, bright: 1.5 }));
  write('sfx-upgrade', out, { verb: { wet: 0.3 } });
}

// 心音
{
  const out = track(1.0);
  for (const at of [0, 0.28]) {
    addTo(out, at, (t) => Math.sin(TAU * (48 + 40 * Math.exp(-t * 25)) * t) * Math.exp(-t * 9) * (at ? 0.75 : 1), 0.5);
  }
  write('sfx-heartbeat', out, { verb: { wet: 0.12, room: 0.5 } });
}

// 再変動の「キュイン」
{
  const out = track(1.2);
  let ph = 0;
  addTo(out, 0, (t) => {
    ph += TAU * (300 * 8 ** Math.min(1, t / 0.35)) / SR;
    let v = 0;
    for (let h = 1; h < 10; h += 1) v += Math.sin(ph * h) / h;
    return v * 0.25 * Math.min(1, t / 0.02) * (t < 0.35 ? 1 : Math.exp(-(t - 0.35) * 12));
  }, 0.7);
  shimmer(out, 0.33, [96, 100, 103, 108], 0.04, 0.1);
  write('sfx-respin', out, { verb: { wet: 0.25 } });
}

// 研究スタート：上昇する音から明るい和音
{
  const out = track(2.2);
  addTo(out, 0, filtered(() => noise(), 'band', (t) => 400 * 12 ** Math.min(1, t / 0.45), 3), 0.5);
  let ph = 0;
  addTo(out, 0, (t) => {
    ph += TAU * (220 * 8 ** Math.min(1, t / 0.45)) / SR;
    return Math.sin(ph) * 0.2 * Math.min(1, t / 0.45);
  }, 0.47);
  chord(out, 0.45, [60, 64, 67, 72, 76], 0.5, { gain: 0.12, bright: 1.4 });
  drum(out, 0.45, { gain: 0.8 });
  shimmer(out, 0.5, [84, 88, 91, 96, 100, 103]);
  write('sfx-start', out, { verb: { wet: 0.3, room: 0.82 } });
}

// 結果発表のドラムロール（だんだん強く、最後にシンバル）
{
  const out = track(3.6);
  const snare = filtered(() => noise(), 'band', 1800, 0.8);
  for (let t = 0; t < 2.6; t += 0.045) {
    const g = 0.15 + 0.6 * (t / 2.6) ** 1.5;
    addTo(out, t, (u) => (snare(u) * 1.4 + Math.sin(TAU * 190 * u) * 0.4) * Math.exp(-u * 35) * g, 0.12, (Math.random() - 0.5) * 0.4);
  }
  drum(out, 2.6, { gain: 1, decay: 0.6 });
  addTo(out, 2.6, (t) => filteredCrash(t) * Math.exp(-t * 1.6) * 0.5, 1.0);
  write('sfx-drumroll', out, { verb: { wet: 0.25, room: 0.8 } });
}

// 色ごとのファンファーレ（ハ長調）
const C4 = 60;
const TRIAD = (root) => [root, root + 4, root + 7];
const fanfares = [
  // 青：短く「タ・ダーン」
  (out) => {
    chord(out, 0, TRIAD(C4 + 7 - 12).map((n) => n + 12), 0.12, { gain: 0.12 });
    chord(out, 0.16, TRIAD(C4), 0.6, { gain: 0.14 });
    shimmer(out, 0.2, [84, 88, 91, 96]);
  },
  // 緑：三連の前打ちから
  (out) => {
    [0, 0.1, 0.2].forEach((t) => chord(out, t, [67, 71, 74], 0.07, { gain: 0.12 }));
    chord(out, 0.32, [60, 64, 67, 72], 0.9, { gain: 0.14 });
    drum(out, 0.32, { gain: 0.6 });
    shimmer(out, 0.35, [84, 88, 91, 96, 100]);
  },
  // 赤：駆け上がって長く伸ばす
  (out) => {
    [60, 64, 67, 72].forEach((n, i) => brass(out, i * 0.09, n, 0.08, { gain: 0.16, bright: 1.2 }));
    chord(out, 0.38, [48, 60, 64, 67, 72, 76], 1.3, { gain: 0.12, bright: 1.3 });
    drum(out, 0.38, { gain: 0.9 });
    for (let i = 0; i < 10; i += 1) drum(out, 0.6 + i * 0.07, { freq: 90, gain: 0.25, decay: 0.15 });
    drum(out, 1.35, { gain: 0.9 });
    shimmer(out, 0.4, [84, 88, 91, 96, 100, 103]);
  },
  // 金：「タタタ・ターン」から IV → V → I
  (out) => {
    [0, 0.12, 0.24].forEach((t) => chord(out, t, [67, 71, 74, 79], 0.09, { gain: 0.13, bright: 1.3 }));
    chord(out, 0.38, [60, 64, 67, 72, 76], 0.55, { gain: 0.12, bright: 1.4 });
    drum(out, 0.38, { gain: 1 });
    chord(out, 1.0, [53, 65, 69, 72, 77], 0.3, { gain: 0.11, bright: 1.3 });
    chord(out, 1.35, [55, 67, 71, 74, 79], 0.3, { gain: 0.11, bright: 1.4 });
    chord(out, 1.7, [48, 60, 64, 67, 72, 76, 79], 1.6, { gain: 0.11, bright: 1.6 });
    drum(out, 1.7, { gain: 1, decay: 0.8 });
    for (let i = 0; i < 14; i += 1) drum(out, 2.0 + i * 0.06, { freq: 85, gain: 0.2, decay: 0.12 });
    shimmer(out, 0.4, [84, 88, 91, 96, 100, 103, 108]);
    shimmer(out, 1.7, [96, 100, 103, 108, 103, 100, 96, 100, 103, 108], 0.06);
  },
  // 虹：金の流れから ♭VI → ♭VII → I の大団円
  (out) => {
    [0, 0.12, 0.24].forEach((t) => chord(out, t, [67, 71, 74, 79], 0.09, { gain: 0.13, bright: 1.4 }));
    chord(out, 0.38, [60, 64, 67, 72, 76, 79], 0.7, { gain: 0.11, bright: 1.5 });
    drum(out, 0.38, { gain: 1 });
    chord(out, 1.15, [56, 68, 72, 75, 80], 0.45, { gain: 0.11, bright: 1.5 });
    drum(out, 1.15, { gain: 0.8 });
    chord(out, 1.65, [58, 70, 74, 77, 82], 0.45, { gain: 0.11, bright: 1.6 });
    drum(out, 1.65, { gain: 0.8 });
    chord(out, 2.15, [48, 60, 64, 67, 72, 76, 79, 84], 2.2, { gain: 0.1, bright: 1.8 });
    drum(out, 2.15, { gain: 1, decay: 1 });
    for (let i = 0; i < 20; i += 1) drum(out, 2.4 + i * 0.05, { freq: 85, gain: 0.2, decay: 0.1 });
    drum(out, 3.5, { gain: 1, decay: 1 });
    shimmer(out, 0.4, [84, 88, 91, 96, 100, 103, 108]);
    shimmer(out, 2.15, [96, 100, 103, 108, 112, 108, 103, 100, 103, 108, 112, 115], 0.055, 0.08);
  },
];
fanfares.forEach((make, tier) => {
  const out = track([1.4, 1.8, 2.6, 4.0, 5.2][tier]);
  make(out);
  write(`sfx-fanfare-${tier}`, out, { verb: { wet: 0.32, room: 0.86 }, tail: 1.2 });
});
