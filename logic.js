// 時間の計算と同期のマージ。画面に依存しないのでそのままテストできる。

export const CATS = ['discussion', 'research', 'presentation']; // 保証表の列順
export const CAT_LABEL = {
  discussion: 'ディスカッション',
  research: '研究',
  presentation: '発表会・練習',
};

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function addDays(ms, n) {
  const d = new Date(ms);
  return new Date(
    d.getFullYear(), d.getMonth(), d.getDate() + n,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(),
  ).getTime();
}

// 週は月曜始まり
export function weekStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
}

// 保証表の「◯月◯週」。週の木曜日がある月に属し、第5週は4週に合算する。
export function weekInfo(ms) {
  const start = weekStart(ms);
  const thursday = new Date(addDays(start, 3));
  const nth = Math.ceil(thursday.getDate() / 7);
  return {
    start,
    end: addDays(start, 7),
    month: thursday.getMonth() + 1,
    index: Math.min(nth, 4),
    fifth: nth === 5,
  };
}

export function overlap(session, from, to, now) {
  const end = session.end ?? now;
  return Math.max(0, Math.min(end, to) - Math.max(session.start, from));
}

export function totals(sessions, from, to, now) {
  const t = { discussion: 0, research: 0, presentation: 0 };
  for (const s of sessions) {
    if (s.deleted) continue;
    t[s.cat in t ? s.cat : 'research'] += overlap(s, from, to, now);
  }
  t.all = t.discussion + t.research + t.presentation;
  return t;
}

export function formatDuration(ms) {
  const minutes = Math.floor(ms / MINUTE);
  const h = Math.floor(minutes / 60);
  return h ? `${h}時間${String(minutes % 60).padStart(2, '0')}分` : `${minutes}分`;
}

export function roundHours(ms) {
  return Math.round(ms / HOUR);
}

export function formatDay(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]})`;
}

export function formatTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// day の日付の "HH:MM"
export function timeOnDay(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
}

export function openSession(sessions) {
  return sessions
    .filter((s) => !s.deleted && s.end == null)
    .sort((a, b) => a.start - b.start)[0] ?? null;
}

// 同期先（スプレッドシート）を正とする。まだ送っていない手元の変更だけは残す。
export function merge(local, remote) {
  const remoteIds = new Set(remote.map((r) => r.id));
  const byId = new Map(
    local.filter((l) => l.dirty || remoteIds.has(l.id)).map((l) => [l.id, l]),
  );
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || !l.dirty || r.updated > l.updated) byId.set(r.id, { ...r, dirty: false });
  }
  return [...byId.values()].sort((a, b) => a.start - b.start);
}

// 2台で別々に始めてしまったときは、早いほうだけを残す。
export function dedupeOpen(sessions, now) {
  const keep = openSession(sessions);
  if (!keep) return sessions;
  return sessions.map((s) => (
    !s.deleted && s.end == null && s.id !== keep.id
      ? { ...s, deleted: true, updated: now, dirty: true }
      : s
  ));
}
