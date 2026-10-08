// アイコン（緑地に白い時計）を PNG で書き出す。依存なし。
import zlib from 'node:zlib';
import fs from 'node:fs';

const BG = [22, 101, 52];
const FG = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function distToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

// 座標は中心が原点、端が ±1。マスクされても欠けないよう中央 60% に収める。
function isClock(x, y) {
  const r = Math.hypot(x, y);
  if (r > 0.46 && r < 0.56) return true;
  if (distToSegment(x, y, 0, 0, 0, -0.34) < 0.05) return true;
  return distToSegment(x, y, 0, 0, 0.24, 0.12) < 0.05;
}

function png(size) {
  const SS = 4;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / SS) / size) * 2 - 1;
          if (isClock(x, y)) hit++;
        }
      }
      const a = hit / (SS * SS);
      const at = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[at + i] = Math.round(BG[i] + (FG[i] - BG[i]) * a);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = new URL('../icons/', import.meta.url);
for (const size of [180, 192, 512]) {
  fs.writeFileSync(new URL(`icon-${size}.png`, dir), png(size));
}
