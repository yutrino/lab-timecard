import {
  CATS, CAT_LABEL, startOfDay, addDays, weekInfo, totals, formatDuration, roundHours,
  formatDay, formatTime, timeOnDay, openSession, merge, dedupeOpen,
} from './logic.js';

const SESSIONS_KEY = 'timecard.sessions';
const SYNC_URL_KEY = 'timecard.syncUrl';
const SYNC_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const STALE_AFTER = 12 * 60 * 60 * 1000; // これより長い記録中は終了の押し忘れとみなす
const MIN_LENGTH = 60 * 1000;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let sessions = loadSessions();
let syncUrl = readStorage(SYNC_URL_KEY) || '';
let weekOffset = 0;
let notice = '';
let lastEndedDay = null;
let dismissedStale = null;
let syncing = false;
let syncAgain = false;
let syncTimer = null;
let syncState = { failed: false, at: null };

// ---- 保存 ----

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 保存できなくても画面は動かす */ }
}

function loadSessions() {
  try {
    const list = JSON.parse(readStorage(SESSIONS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveSessions() {
  writeStorage(SESSIONS_KEY, JSON.stringify(sessions));
}

function newId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function put(session) {
  const next = { ...session, updated: Date.now(), dirty: true };
  sessions = sessions.some((s) => s.id === next.id)
    ? sessions.map((s) => (s.id === next.id ? next : s))
    : [...sessions, next];
  saveSessions();
  render();
  scheduleSync();
  return next;
}

// ---- 打刻 ----

function start(at) {
  notice = '';
  lastEndedDay = null;
  put({ id: newId(), start: at, end: null, cat: 'research' });
}

function finish(open, at) {
  if (at - open.start < MIN_LENGTH) {
    notice = '1分未満だったので記録しませんでした';
    lastEndedDay = null;
    put({ ...open, end: at, deleted: true });
  } else {
    notice = `${formatTime(open.start)}〜${formatTime(at)} を「${CAT_LABEL[open.cat]}」で記録しました`;
    lastEndedDay = startOfDay(open.start);
    put({ ...open, end: at });
  }
}

$('punch').addEventListener('click', () => {
  const open = openSession(sessions);
  if (open) finish(open, Date.now());
  else start(Date.now());
});

// ---- 画面 ----

function setText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

function render() {
  const now = Date.now();
  const open = openSession(sessions);
  const today = startOfDay(now);
  const thisWeek = weekInfo(now);

  document.body.toggleAttribute('data-running', Boolean(open));
  setText('todayTotal', formatDuration(totals(sessions, today, addDays(today, 1), now).all));
  setText('weekTotal', formatDuration(totals(sessions, thisWeek.start, thisWeek.end, now).all));
  setText('punch', open ? '研究を止める' : '研究を始める');
  setText('specify', open ? '終わった時刻を指定する' : '始めた時刻を指定する');
  $('relabel').hidden = Boolean(open) || lastEndedDay == null;

  if (open) {
    const day = startOfDay(open.start) === today ? '' : `${formatDay(open.start)} `;
    setText('status', `● ${day}${formatTime(open.start)} から記録中`);
  } else {
    setText('status', notice || '記録していません');
  }

  renderWeek(now, today);
  renderSync();
}

function renderWeek(now, today) {
  const week = weekInfo(addDays(now, weekOffset * 7));
  const sum = totals(sessions, week.start, week.end, now);

  setText('weekTitle', `${week.month}月${week.index}週`);
  setText(
    'weekRange',
    `${formatDay(week.start)}〜${formatDay(addDays(week.start, 6))}`
      + (week.fifth ? '・第5週なので4週の行に足します' : ''),
  );
  $('nextWeek').disabled = weekOffset >= 0;

  const html = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(week.start, i);
    const ms = totals(sessions, day, addDays(day, 1), now).all;
    const isToday = day === today;
    const [date, name] = formatDay(day).replace(')', '').split('(');
    return `<li><button type="button" data-day="${day}"${isToday ? ' aria-current="date"' : ''}${day > today ? ' disabled' : ''}>`
      + `<span>${name} ${date}</span>`
      + `<span class="tag">${isToday ? 'きょう' : ''}</span>`
      + `<span class="time">${day > today ? '—' : formatDuration(ms)}</span>`
      + '</button></li>';
  }).join('');
  const days = $('days');
  if (days.dataset.html !== html) {
    days.innerHTML = html;
    days.dataset.html = html;
  }

  setText('sheetCaption', weekOffset === 0 ? '保証表に書く数字（時間・今週のここまで）' : '保証表に書く数字（時間）');
  setText('sheetDiscussion', String(roundHours(sum.discussion)));
  setText('sheetResearch', String(roundHours(sum.research)));
  setText('sheetPresentation', String(roundHours(sum.presentation)));
  const exact = CATS.filter((c) => sum[c] > 0).map((c) => `${CAT_LABEL[c]} ${formatDuration(sum[c])}`);
  setText('sheetExact', exact.length ? `丸める前：${exact.join('・')}` : '');
}

function renderSync() {
  const pending = sessions.some((s) => s.dirty);
  let text;
  if (!syncUrl) text = 'この端末だけに保存しています（同期を設定する）';
  else if (syncState.failed) text = pending ? 'まだ送れていない記録があります。つながったら送ります' : '同期できませんでした。あとでもう一度試します';
  else if (syncState.at) text = `同期済み ${formatTime(syncState.at)}`;
  else text = '同期しています…';
  setText('syncButton', text);
}

$('prevWeek').addEventListener('click', () => { weekOffset -= 1; render(); });
$('nextWeek').addEventListener('click', () => { weekOffset = Math.min(0, weekOffset + 1); render(); });

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

// ---- 時刻を指定して始める／止める ----

let timeMode = 'start';

function openTimeDialog(mode) {
  const now = Date.now();
  const open = openSession(sessions);
  timeMode = mode;
  if (mode === 'end') {
    if (!open) return;
    const stale = now - open.start > STALE_AFTER;
    $('timeTitle').textContent = stale ? '終わった時刻を教えてください' : '終わった時刻を指定する';
    $('timeText').textContent = `${formatDay(open.start)} ${formatTime(open.start)} に始めた記録${stale ? 'が終わっていません' : 'です'}。何時に終わりましたか？`;
    $('timeLabel').textContent = '終わった時刻';
    $('timeInput').value = stale ? '' : formatTime(now);
  } else {
    $('timeTitle').textContent = '始めた時刻を指定する';
    $('timeText').textContent = 'きょう、何時から始めていましたか？';
    $('timeLabel').textContent = '始めた時刻';
    $('timeInput').value = '';
  }
  $('timeError').textContent = '';
  $('timeDialog').showModal();
  $('timeInput').focus();
}

$('specify').addEventListener('click', () => openTimeDialog(openSession(sessions) ? 'end' : 'start'));

$('timeForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('timeInput').value;
  const now = Date.now();
  if (!value) return;

  if (timeMode === 'end') {
    const open = openSession(sessions);
    if (!open) { $('timeDialog').close(); return; }
    let end = timeOnDay(open.start, value);
    if (end <= open.start) end = addDays(end, 1);
    if (end > now) { $('timeError').textContent = 'まだ来ていない時刻です'; return; }
    finish(open, end);
  } else {
    const at = timeOnDay(now, value);
    if (at > now) { $('timeError').textContent = 'まだ来ていない時刻です'; return; }
    start(at);
  }
  $('timeDialog').close();
});

$('timeDialog').addEventListener('close', () => {
  const open = openSession(sessions);
  if (open) dismissedStale = open.id;
});

function promptIfStale() {
  const open = openSession(sessions);
  if (!open || open.id === dismissedStale) return;
  if (Date.now() - open.start <= STALE_AFTER) return;
  if (document.querySelector('dialog[open]')) return;
  openTimeDialog('end');
}

// ---- 1日の記録を直す ----

function rowHtml(session) {
  const options = CATS.map((c) => `<option value="${c}"${session?.cat === c || (!session && c === 'research') ? ' selected' : ''}>${CAT_LABEL[c]}</option>`).join('');
  const running = session && session.end == null;
  return `<li${session ? ` data-id="${esc(session.id)}"` : ''}>`
    + `<input class="start" type="time" aria-label="開始" value="${session ? formatTime(session.start) : ''}">`
    + '<span>〜</span>'
    + (running
      ? '<span class="running">記録中</span>'
      : `<input class="end" type="time" aria-label="終了" value="${session ? formatTime(session.end) : ''}">`)
    + '<div class="meta">'
    + `<select class="cat" aria-label="区分">${options}</select>`
    + `<span class="length">${session && !running ? formatDuration(session.end - session.start) : ''}</span>`
    + '<button type="button" class="link delete">消す</button>'
    + '</div></li>';
}

function updateDayEmpty() {
  $('dayEmpty').hidden = $('dayRows').children.length > 0;
}

function openDayDialog(day) {
  const list = sessions
    .filter((s) => !s.deleted && s.start >= day && s.start < addDays(day, 1))
    .sort((a, b) => a.start - b.start);
  $('dayDialog').dataset.day = String(day);
  $('dayTitle').textContent = `${formatDay(day)} の記録`;
  $('dayRows').innerHTML = list.map(rowHtml).join('');
  updateDayEmpty();
  $('dayDialog').showModal();
}

function saveRow(li) {
  const day = Number($('dayDialog').dataset.day);
  const startValue = li.querySelector('.start').value;
  const endInput = li.querySelector('.end');
  if (!startValue || (endInput && !endInput.value)) return;

  const startAt = timeOnDay(day, startValue);
  let endAt = null;
  if (endInput) {
    endAt = timeOnDay(day, endInput.value);
    if (endAt <= startAt) endAt = addDays(endAt, 1);
  }
  const existing = sessions.find((s) => s.id === li.dataset.id);
  const saved = put({
    ...(existing ?? { id: newId() }),
    start: startAt,
    end: endAt,
    cat: li.querySelector('.cat').value,
  });
  li.dataset.id = saved.id;
  li.querySelector('.length').textContent = endAt == null
    ? ''
    : formatDuration(endAt - startAt) + (endAt > addDays(day, 1) ? '（翌日まで）' : '');
}

$('days').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-day]');
  if (button) openDayDialog(Number(button.dataset.day));
});

$('relabel').addEventListener('click', () => {
  if (lastEndedDay != null) openDayDialog(lastEndedDay);
});

$('dayRows').addEventListener('change', (event) => {
  const li = event.target.closest('li');
  if (li) saveRow(li);
});

$('dayRows').addEventListener('click', (event) => {
  if (!event.target.closest('.delete')) return;
  const li = event.target.closest('li');
  const existing = sessions.find((s) => s.id === li.dataset.id);
  if (existing) {
    if (!confirm('この記録を消しますか？')) return;
    put({ ...existing, deleted: true });
  }
  li.remove();
  updateDayEmpty();
});

$('addRow').addEventListener('click', () => {
  $('dayRows').insertAdjacentHTML('beforeend', rowHtml(null));
  updateDayEmpty();
  $('dayRows').lastElementChild.querySelector('.start').focus();
});

// ---- 同期 ----

function cleanRemote(r) {
  const startAt = Number(r?.start);
  if (!r?.id || !Number.isFinite(startAt) || startAt <= 0) return null;
  const endAt = r.end == null || r.end === '' ? null : Number(r.end);
  return {
    id: String(r.id),
    start: startAt,
    end: Number.isFinite(endAt) ? endAt : null,
    cat: CATS.includes(r.cat) ? r.cat : 'research',
    updated: Number(r.updated) || 0,
  };
}

async function sync() {
  if (!syncUrl) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  const sent = sessions.filter((s) => s.dirty).map(({ dirty, ...record }) => record);
  try {
    // Content-Type を付けない（text/plain）ことで、Apps Script が受けられない事前確認を避ける
    const response = await fetch(syncUrl, { method: 'POST', body: JSON.stringify({ records: sent }) });
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.records)) throw new Error(data.error || 'unexpected response');

    const sentAt = new Map(sent.map((r) => [r.id, r.updated]));
    const acked = sessions
      .filter((s) => !(s.deleted && sentAt.get(s.id) === s.updated))
      .map((s) => (sentAt.get(s.id) === s.updated ? { ...s, dirty: false } : s));
    sessions = dedupeOpen(merge(acked, data.records.map(cleanRemote).filter(Boolean)), Date.now());
    saveSessions();
    syncState = { failed: false, at: Date.now() };
  } catch {
    syncState = { ...syncState, failed: true };
  } finally {
    syncing = false;
  }
  render();
  promptIfStale();
  if (syncAgain || (!syncState.failed && sessions.some((s) => s.dirty))) {
    syncAgain = false;
    scheduleSync();
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 300);
}

function setSyncUrl(url) {
  syncUrl = url;
  writeStorage(SYNC_URL_KEY, url);
  // 同期先が変わったら、手元の記録をすべて送り直す
  sessions = sessions.map((s) => ({ ...s, dirty: true }));
  saveSessions();
  syncState = { failed: false, at: null };
  render();
  scheduleSync();
}

function shareLink() {
  return `${location.origin}${location.pathname}#sync=${encodeURIComponent(syncUrl)}`;
}

$('syncButton').addEventListener('click', () => {
  $('syncInput').value = syncUrl;
  $('syncError').textContent = '';
  $('copyLink').hidden = !syncUrl;
  $('copyLink').textContent = 'ほかの端末で開くリンクをコピー';
  $('syncDialog').showModal();
});

$('syncForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const url = $('syncInput').value.trim();
  if (url && !SYNC_URL_PATTERN.test(url)) {
    $('syncError').textContent = 'https://script.google.com/macros/s/…/exec の形のURLを貼ってください';
    return;
  }
  if (url !== syncUrl) setSyncUrl(url);
  $('syncDialog').close();
});

$('copyLink').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shareLink());
    $('copyLink').textContent = 'コピーしました';
  } catch {
    $('syncInput').value = shareLink();
    $('syncInput').select();
  }
});

// ほかの端末から「#sync=…」付きのリンクで開いたとき
function importSyncFromHash() {
  const match = location.hash.match(/^#sync=(.+)$/);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  let url = '';
  try { url = decodeURIComponent(match[1]); } catch { return; }
  if (!SYNC_URL_PATTERN.test(url) || url === syncUrl) return;
  if (confirm('このリンクの同期先を、この端末で使いますか？')) setSyncUrl(url);
}

// ---- 起動 ----

importSyncFromHash();
render();
promptIfStale();
sync();

setInterval(() => { render(); promptIfStale(); }, 15 * 1000);
setInterval(() => { if (!document.hidden) sync(); }, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { render(); promptIfStale(); sync(); }
});
window.addEventListener('online', sync);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
