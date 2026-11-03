// 演出の映像（media/）と BGM（sounds/bgm-*.mp3）を、配布された素材から書き出す。
// `npm run media -- <素材のフォルダ>`。フォルダには loopfxnet/ と BGM/ が入っている。
// 映像：LOOP EFFECTS（anoerone）。作者の許可を得て使う。BGM：魔王魂（クレジット表記が利用条件）。
// スマホで軽く読めるよう、映像は 480p 以下・音なし・H.264・短く切って画質を落とす（光と粒子ばかりなので目立たない）。グリーンバックは緑を抜いて黒にする（加算で重ねる）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC) throw new Error('素材のフォルダを指定してください');
const ROOT = new URL('../', import.meta.url).pathname;
fs.mkdirSync(path.join(ROOT, 'media'), { recursive: true });

// [書き出す名前, 元のファイル, 使う秒数, 幅, グリーンバックか]
const VIDEOS = [
  ['bg-rainbow', 'カットイン/1674216828wpdm_bg_02.mp4', 8, 640],
  ['bg-green', 'カットイン/1676892237wpdm_bg_04.mp4', 8, 640],
  ['fx-particle', 'カットイン/red_particle.mp4', 10, 640],
  ['logo-gekiatsu', '大当たり・激アツ/gekiatsu-rainbow-flash.mp4', 4, 854],
  ['logo-kakutei', '大当たり・激アツ/kakutei-rainbow-flash.mp4', 4, 854],
  ['logo-shori', '大当たり・激アツ/shori-rainbow-flash.mp4', 4, 854],
  ['logo-777-rainbow', '放出・閃光/777-rainbow-flash.mp4', 4, 854],
  ['logo-777-red', '放出・閃光/777-red-flash-lines.mp4', 4, 854],
  ['logo-bonus', '放出・閃光/bonus777-rainbow-flash.mp4', 4, 854],
  ['fx-flash', '放出・閃光/004.mp4', 6.6, 640, true],
  ['fx-smoke', '放出・閃光/1710749654wpdm_010.mp4', 6.6, 640, true],
  ['fx-blast', '放出・閃光/fire-ball-blast-explosion-animation.mp4', 5, 640],
  ['fx-shock', '放出・閃光/shockwave_03.mp4', 5, 640],
];

// [書き出す名前, 元のファイル, 始める秒, 長さ]
const MUSIC = [
  ['bgm-reach', 'maou_bgm_neorock73.mp3', 0, 60],
  ['bgm-win', 'maou_bgm_neorock83.mp3', 0, 60],
  ['bgm-rush', 'maou_bgm_neorock71.mp3', 9, 40],
  ['bgm-weekly', 'maou_bgm_neorock68.mp3', 0, 40],
];

const only = process.argv.slice(3);
const want = (name) => !only.length || only.includes(name);
const ffmpeg = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

for (const [name, file, seconds, width, keyed] of VIDEOS.filter(([n]) => want(n))) {
  const scale = `scale=${width}:-2:flags=lanczos`;
  const filter = keyed
    ? `[0]${scale},format=yuva420p,chromakey=0x14ff09:0.28:0.06[k];color=black:s=${width}x${Math.round((width * 9) / 32) * 2}:r=30[bg];[bg][k]overlay=shortest=1,format=yuv420p`
    : `[0]${scale},format=yuv420p`;
  ffmpeg(['-i', path.join(SRC, 'loopfxnet', file), '-t', String(seconds), '-filter_complex', filter,
    '-an', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '31', '-r', '30', '-movflags', '+faststart',
    path.join(ROOT, 'media', `${name}.mp4`)]);
  console.log(name);
}

for (const [name, file, start, seconds] of MUSIC.filter(([n]) => want(n))) {
  // 声が BGM の上に乗るよう、少し小さめにそろえる。終わりは2秒で消す
  ffmpeg(['-ss', String(start), '-t', String(seconds), '-i', path.join(SRC, 'BGM', file),
    '-af', `afade=t=out:st=${seconds - 2}:d=2,loudnorm=I=-16:TP=-1.5`, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k',
    path.join(ROOT, 'sounds', `${name}.mp3`)]);
  console.log(name);
}
