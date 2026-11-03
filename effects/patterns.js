// 「出たらほぼ当たり」の柄。ゼブラ柄（金）とキリン柄（虹）を canvas に描く。
// 演出（WebGL のテクスチャ）とメイン画面（保留の玉の背景）の両方で使う。

// 乱数の種を固定して、毎回同じ柄にする
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function zebra(g, size) {
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 斜めの縞を、うねりで曲げる
      const u = (x + y * 0.55) / size;
      const v = y / size;
      const wave = Math.sin(u * Math.PI * 2 * 7 + Math.sin(v * 9 + u * 4) * 2.2 + Math.sin(v * 23) * 0.4);
      const c = wave > 0.05 ? 18 : 250;
      const i = (y * size + x) * 4;
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function kirin(g, size) {
  // ボロノイ図で、つなぎ目の明るい線と茶色の斑を作る。端は反対側とつながる
  const rnd = seeded(7);
  const points = [];
  const n = 5;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) points.push([(i + 0.2 + rnd() * 0.6) / n, (j + 0.2 + rnd() * 0.6) / n, rnd()]);
  }
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x / size;
      const py = y / size;
      let d1 = 9;
      let d2 = 9;
      let shade = 0;
      for (const [qx, qy, s] of points) {
        let dx = Math.abs(px - qx);
        let dy = Math.abs(py - qy);
        dx = Math.min(dx, 1 - dx);
        dy = Math.min(dy, 1 - dy);
        const d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; shade = s; } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1 < 0.022;
      const i = (y * size + x) * 4;
      if (edge) {
        img.data[i] = 252; img.data[i + 1] = 226; img.data[i + 2] = 160;
      } else {
        const k = 1 - d1 * 2.2; // 斑の中心ほど濃い
        img.data[i] = 150 * k + 60 * shade;
        img.data[i + 1] = 72 * k + 22 * shade;
        img.data[i + 2] = 14 * k;
      }
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

const cache = new Map();

// kind: 'zebra' | 'kirin'
export function patternCanvas(kind, size = 256) {
  const key = `${kind}${size}`;
  if (!cache.has(key)) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    (kind === 'zebra' ? zebra : kirin)(c.getContext('2d'), size);
    cache.set(key, c);
  }
  return cache.get(key);
}
