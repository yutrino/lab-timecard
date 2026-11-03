// 演出の声を VOICEVOX で作る。VOICEVOX を起動した状態で `npm run voices`。
// ファイル名を並べると、その声だけを作る（例：`npm run voices -- voice-m1 voice-weekly`）。
// 声：VOICEVOX:青山龍星（熱血）。クレジット表記が利用条件。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENGINE = 'http://127.0.0.1:50021';
const SPEAKER = 81; // 青山龍星・熱血
const OUT = new URL('../sounds/', import.meta.url).pathname;

// [ファイル名, 読み, 話す速さ, 声の高さ, 抑揚]
const LINES = [
  ['voice-push', 'おせぇっ！', 1.05, 0.06, 1.8],
  ['voice-reach', 'リーチッ！', 1.0, 0.04, 1.8],
  ['voice-0', 'おつかれさまっ！', 1.1, 0.02, 1.4],
  ['voice-1', 'ナイスけんきゅうっ！', 1.1, 0.03, 1.6],
  ['voice-2', 'げきあつっ！', 1.0, 0.05, 1.9],
  ['voice-3', 'おおあたりーっ！', 0.95, 0.06, 2.0],
  ['voice-4', 'ちょう、おおあたりーっ！', 0.95, 0.08, 2.0],
  ['voice-start', 'けんきゅう、スタートッ！', 1.05, 0.05, 1.8],
  ['voice-chance', 'チャンスッ！', 1.05, 0.06, 1.9],
  ['voice-rush', 'けんきゅうラッシュ、とつにゅうっ！', 1.05, 0.07, 1.9],
  ['voice-zenkaiten', 'ぜんかいてーんっ！', 0.95, 0.08, 2.0],
  ['voice-kakutei', 'かくていっ！', 1.0, 0.06, 1.9],
  ['voice-kita', 'きたぁーっ！', 1.0, 0.08, 2.0],
  ['voice-stepup', 'ステップアップ！', 1.1, 0.05, 1.8],
  ['voice-round', 'ラウンド、スタートッ！', 1.05, 0.05, 1.8],
  ['voice-weekly', 'せんしゅうの、けっか、はっぴょうっ！', 1.05, 0.05, 1.8],
  ...['さんじゅっぷん', 'いちじかん', 'にじかん', 'さんじかん', 'よじかん', 'ごじかん', 'ろくじかん', 'しちじかん', 'はちじかん']
    .map((t, i) => [`voice-m${i + 1}`, `${t}、とっぱっ！`, 1.05, 0.05, 1.8]),
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voices-'));
const only = process.argv.slice(2);
for (const [name, text, speed, pitch, intonation] of LINES.filter(([n]) => !only.length || only.includes(n))) {
  const q = await (await fetch(`${ENGINE}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(text)}`, { method: 'POST' })).json();
  Object.assign(q, { speedScale: speed, pitchScale: pitch, intonationScale: intonation, volumeScale: 1.3, prePhonemeLength: 0.02, postPhonemeLength: 0.1, outputSamplingRate: 44100 });
  const wav = Buffer.from(await (await fetch(`${ENGINE}/synthesis?speaker=${SPEAKER}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q),
  })).arrayBuffer());
  const raw = path.join(tmp, `${name}.wav`);
  fs.writeFileSync(raw, wav);
  // 場内アナウンス風：低音を切り、圧縮して前に出し、短い残響を付ける
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', [
    'highpass=f=120', 'equalizer=f=3000:t=q:w=1:g=4', 'acompressor=threshold=-18dB:ratio=4:attack=5:release=80:makeup=6',
    'aexciter=amount=2:drive=6', 'aecho=0.8:0.6:45|90|160:0.35|0.22|0.12', 'apad=pad_dur=0.25', 'loudnorm=I=-12:TP=-1',
  ].join(','), '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', path.join(OUT, `${name}.mp3`)]);
  console.log(name);
}
fs.rmSync(tmp, { recursive: true });
