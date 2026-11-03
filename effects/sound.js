// 音は書き出し済みの mp3（sounds/）を Web Audio で鳴らす。読み込めないときのために合成音も持つ。
// AudioContext はボタンを押した操作の中で作らないと、iPhone では鳴らない。

const C5 = 523.25;
const note = (semitones) => C5 * 2 ** (semitones / 12);

// 書き出し済みの音（sounds/*.mp3）。声は VOICEVOX:青山龍星
export const SAMPLES = [
  'sfx-riser', 'sfx-push', 'sfx-impact', 'sfx-stop', 'sfx-tick', 'sfx-cutin', 'sfx-upgrade', 'sfx-heartbeat', 'sfx-respin', 'sfx-start', 'sfx-drumroll',
  'sfx-fanfare-0', 'sfx-fanfare-1', 'sfx-fanfare-2', 'sfx-fanfare-3', 'sfx-fanfare-4',
  'voice-push', 'voice-reach', 'voice-start', 'voice-chance', 'voice-weekly',
  'voice-rush', 'voice-zenkaiten', 'voice-kakutei', 'voice-kita', 'voice-stepup', 'voice-round',
  'bgm-reach', 'bgm-win', 'bgm-rush', 'bgm-weekly',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `voice-m${i}`), 'voice-0', 'voice-1', 'voice-2', 'voice-3', 'voice-4',
];

export function createSound() {
  let ac = null;
  let master = null;
  const buffers = new Map();
  // BGM の低音の大きさを測り、電飾を拍に合わせる
  let analyser = null;
  let bins = null;
  const bgms = new Set(); // 鳴っている BGM
  const loading = new Map();

  function load(name) {
    if (!loading.has(name)) {
      loading.set(name, fetch(`sounds/${name}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((data) => context().decodeAudioData(data))
        .then((buffer) => { buffers.set(name, buffer); return buffer; })
        .catch(() => { loading.delete(name); return null; }));
    }
    return loading.get(name);
  }

  function context() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === 'suspended') ac.resume();
    if (!master) {
      master = ac.createGain();
      master.gain.value = 0.8;
      master.connect(ac.destination);
    }
    if (!analyser) {
      analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      bins = new Uint8Array(analyser.frequencyBinCount);
      // どこかに出力をつながないと測れない端末があるので、音量0でつなぐ
      const mute = ac.createGain();
      mute.gain.value = 0;
      analyser.connect(mute).connect(ac.destination);
    }
    return ac;
  }

  function tone(freq, duration, { type = 'square', gain = 0.06, at = 0, to = null } = {}) {
    const a = context();
    if (!a) return;
    const t = a.currentTime + at;
    const osc = a.createOscillator();
    const env = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  function noise(duration, { gain = 0.3, at = 0, freq = 800, type = 'lowpass' } = {}) {
    const a = context();
    if (!a) return;
    const t = a.currentTime + at;
    const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * duration), a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    const filter = a.createBiquadFilter();
    const env = a.createGain();
    src.buffer = buffer;
    filter.type = type;
    filter.frequency.value = freq;
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(env).connect(master);
    src.start(t);
  }

  return {
    unlock: context,

    preload() {
      if (!context()) return Promise.resolve();
      return Promise.all(SAMPLES.map(load));
    },

    // 読み込み済みの音を鳴らす。まだなら読み込みだけ始めて今回は鳴らさない。rate で速さと高さが変わる
    sample(name, { gain = 1, at = 0, rate = 1 } = {}) {
      const buffer = buffers.get(name);
      const a = context();
      if (!buffer || !a) { load(name); return null; }
      const src = a.createBufferSource();
      const g = a.createGain();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      g.gain.value = gain;
      src.connect(g).connect(master);
      src.start(a.currentTime + at);
      return {
        stop(fade = 0.05) {
          g.gain.setTargetAtTime(0, a.currentTime, fade);
          src.stop(a.currentTime + fade * 6);
        },
      };
    },

    // BGM を繰り返し鳴らす。読み込み前なら鳴らさない
    bgm(name, { gain = 0.55, fade = 0.15 } = {}) {
      const buffer = buffers.get(name);
      const a = context();
      if (!buffer || !a) { load(name); return null; }
      const src = a.createBufferSource();
      const g = a.createGain();
      src.buffer = buffer;
      src.loop = true;
      g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(gain, a.currentTime + fade);
      src.connect(g).connect(master);
      g.connect(analyser);
      src.start();
      const handle = {
        stop(out = 0.3) {
          if (!bgms.delete(handle)) return;
          g.gain.setTargetAtTime(0, a.currentTime, out / 3);
          src.stop(a.currentTime + out * 2);
        },
      };
      bgms.add(handle);
      return handle;
    },

    // BGM の低音の大きさ（0〜1）。BGM が鳴っていなければ null
    level() {
      if (!analyser || !bgms.size) return null;
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 1; i <= 6; i += 1) sum += bins[i]; // 約40〜260Hz（バスドラム）
      return sum / (6 * 255);
    },

    // 鳴っている音をすぐ止める（演出を飛ばしたとき）
    cut() {
      for (const handle of [...bgms]) handle.stop(0.02);
      if (!master) return;
      master.gain.setTargetAtTime(0, ac.currentTime, 0.02);
      const old = master;
      setTimeout(() => old.disconnect(), 200);
      master = null;
    },

    // 研究スタート：上昇する「キュイーン」
    start() {
      tone(220, 0.5, { type: 'sawtooth', gain: 0.05, to: 2600 });
      tone(440, 0.5, { type: 'square', gain: 0.03, to: 5200 });
      [12, 16, 19, 24].forEach((s, i) => tone(note(s), 0.14, { type: 'triangle', gain: 0.07, at: 0.48 + i * 0.06 }));
    },

    // 心音。暗転中の溜め
    heartbeat() {
      for (const at of [0, 0.28, 0.9, 1.18]) {
        tone(70, 0.18, { type: 'sine', gain: 0.7, to: 40, at });
        noise(0.1, { gain: 0.15, freq: 180, at });
      }
    },

    // 「押せ！」の間ずっと上がり続ける音
    riser(seconds) {
      const a = context();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      const env = a.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(1760, t + seconds);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.05, t + seconds);
      osc.connect(env).connect(master);
      osc.start(t);
      osc.stop(t + seconds);
      for (let i = 0; i < seconds * 6; i += 1) tone(880 + i * 40, 0.05, { type: 'square', gain: 0.03, at: i / 6 });
    },

    // ボタンを押した「ガコン」
    push() {
      tone(160, 0.3, { type: 'square', gain: 0.25, to: 45 });
      noise(0.25, { gain: 0.4, freq: 1200 });
    },

    // リーチの「ドン」
    hit() {
      tone(140, 0.5, { type: 'sine', gain: 0.6, to: 38 });
      noise(0.35, { gain: 0.35, freq: 500 });
    },

    tick() {
      tone(1900, 0.04, { type: 'square', gain: 0.05 });
      noise(0.03, { gain: 0.1, freq: 4000, type: 'highpass' });
    },

    // 色が上がるたびに少しずつ高くなる
    up(level) {
      [0, 4, 7, 12].forEach((s, i) => tone(note(s + level * 3), 0.1, { gain: 0.05, at: i * 0.05 }));
    },

    // 結果のファンファーレ。色が上ほど長く厚い
    win(tier) {
      const scale = [0, 4, 7, 12, 16, 19, 24, 28];
      const n = 3 + tier;
      for (let i = 0; i < n; i += 1) tone(note(scale[i]), 0.16, { gain: 0.05, at: i * 0.08 });
      const end = n * 0.08;
      const hold = 0.7 + tier * 0.35;
      [0, 4, 7, 12].forEach((s) => tone(note(s + 12), hold, { type: 'sawtooth', gain: 0.025, at: end }));
      if (tier >= 2) tone(note(-12), hold, { type: 'square', gain: 0.04, at: end });
      if (tier >= 3) noise(hold, { gain: 0.08, freq: 6000, type: 'highpass', at: end });
      if (tier >= 4) [24, 28, 31, 36].forEach((s, i) => tone(note(s), 0.12, { type: 'triangle', gain: 0.05, at: end + 0.15 + i * 0.07 }));
    },
  };
}
