// Canvas 2D の粒子。粒子が残っている間だけ描画ループを回す。

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function starPath(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (i / 10) * TAU - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
}

export function createParticles(canvas) {
  const ctx = canvas.getContext('2d');
  let list = [];
  let raf = 0;
  let last = 0;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  function draw(p) {
    ctx.globalAlpha = Math.min(1, p.life / p.fade);
    ctx.globalCompositeOperation = p.kind === 'coin' ? 'source-over' : 'lighter';
    ctx.save();
    ctx.translate(p.x, p.y);
    switch (p.kind) {
      case 'spark':
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-p.vx * 0.05, -p.vy * 0.05);
        ctx.stroke();
        break;
      case 'star':
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        starPath(ctx, p.size);
        ctx.fill();
        break;
      case 'coin':
        ctx.scale(Math.max(0.08, Math.abs(Math.cos(p.rot))), 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#8a5a00';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(-p.size * 0.3, -p.size * 0.3, p.size * 0.3, 0, TAU);
        ctx.fill();
        break;
      case 'ring': {
        const k = 1 - p.life / p.max;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.size * (1 - k));
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * (0.1 + k * 0.9), 0, TAU);
        ctx.stroke();
        break;
      }
      default:
    }
    ctx.restore();
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    list = list.filter((p) => {
      if (p.delay > 0) { p.delay -= dt; return true; }
      p.life -= dt;
      if (p.life <= 0) return false;
      p.vy += p.gravity * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      draw(p);
      return true;
    });
    ctx.globalAlpha = 1;
    raf = list.length ? requestAnimationFrame(frame) : 0;
  }

  function add(p) {
    list.push({
      vx: 0, vy: 0, gravity: 0, drag: 1, rot: rand(0, TAU), spin: rand(-8, 8), delay: 0, fade: 0.4, ...p, max: p.life,
    });
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  return {
    // 1点から全方向に飛び散る
    burst(x, y, { count, kinds, colors, speed }) {
      for (let i = 0; i < count; i += 1) {
        const a = rand(0, TAU);
        const v = rand(speed * 0.3, speed);
        const kind = pick(kinds);
        add({
          kind,
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - speed * 0.25,
          gravity: kind === 'spark' ? 300 : 700,
          drag: kind === 'spark' ? 0.96 : 0.985,
          size: kind === 'spark' ? rand(2, 4) : kind === 'coin' ? rand(9, 15) : rand(6, 12),
          color: pick(colors),
          life: rand(0.8, 1.8),
        });
      }
    },

    // 上から降ってくる
    rain({ count, kinds, colors }) {
      for (let i = 0; i < count; i += 1) {
        add({
          kind: pick(kinds),
          x: rand(0, innerWidth),
          y: -20,
          vx: rand(-40, 40),
          vy: rand(150, 350),
          gravity: 250,
          size: rand(8, 14),
          color: pick(colors),
          life: 3,
          delay: rand(0, 1.2),
        });
      }
    },

    // 広がる輪（衝撃波）
    ring(x, y, color, radius = Math.hypot(innerWidth, innerHeight) * 0.6) {
      add({ kind: 'ring', x, y, color, radius, size: 18, life: 0.6, fade: 0.6, spin: 0 });
      add({ kind: 'ring', x, y, color: '#ffffff', radius: radius * 0.7, size: 8, life: 0.5, fade: 0.5, spin: 0, delay: 0.08 });
    },

    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      list = [];
    },
  };
}
