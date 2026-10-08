import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weekInfo, totals, formatDuration, roundHours, merge, dedupeOpen, timeOnDay, formatDay,
} from '../logic.js';

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const label = (ms) => {
  const w = weekInfo(ms);
  return `${w.month}月${w.index}週${w.fifth ? '(5)' : ''}`;
};

test('週のラベル', () => {
  assert.equal(label(at(2026, 10, 8)), '10月2週');
  assert.equal(weekInfo(at(2026, 10, 8)).start, at(2026, 10, 5));
  assert.equal(label(at(2026, 9, 1)), '9月1週');
  assert.equal(label(at(2026, 9, 27)), '9月4週');
  assert.equal(label(at(2026, 9, 28)), '10月1週');
  assert.equal(label(at(2026, 11, 30)), '12月1週');
  assert.equal(label(at(2026, 12, 30)), '12月4週(5)');
  assert.equal(label(at(2027, 1, 4)), '1月1週');
  assert.equal(label(at(2027, 2, 14)), '2月2週');
});

test('日曜は前の月曜からの週に入る', () => {
  assert.equal(weekInfo(at(2026, 10, 11, 23, 59)).start, at(2026, 10, 5));
  assert.equal(formatDay(at(2026, 10, 11)), '10/11(日)');
});

test('集計は区分ごと、日またぎは日付で分ける', () => {
  const sessions = [
    { id: 'a', start: at(2026, 10, 7, 22), end: at(2026, 10, 8, 1), cat: 'research' },
    { id: 'b', start: at(2026, 10, 8, 10), end: at(2026, 10, 8, 11), cat: 'discussion' },
    { id: 'c', start: at(2026, 10, 8, 12), end: at(2026, 10, 8, 13), cat: 'research', deleted: true },
    { id: 'd', start: at(2026, 10, 8, 14), end: null, cat: 'research' },
  ];
  const now = at(2026, 10, 8, 14, 30);
  const day = totals(sessions, at(2026, 10, 8), at(2026, 10, 9), now);
  assert.equal(day.research, 90 * 60000);
  assert.equal(day.discussion, 60 * 60000);
  assert.equal(day.all, 150 * 60000);
  assert.equal(totals(sessions, at(2026, 10, 7), at(2026, 10, 8), now).all, 120 * 60000);
});

test('時間の表示と丸め', () => {
  assert.equal(formatDuration(0), '0分');
  assert.equal(formatDuration(59 * 60000 + 59000), '59分');
  assert.equal(formatDuration(185 * 60000), '3時間05分');
  assert.equal(roundHours(11 * 3600000 + 29 * 60000), 11);
  assert.equal(roundHours(11 * 3600000 + 30 * 60000), 12);
  assert.equal(timeOnDay(at(2026, 10, 8, 15), '09:05'), at(2026, 10, 8, 9, 5));
});

test('マージ: 同期先が正、未送信の変更は残す', () => {
  const local = [
    { id: 'same', start: 1, end: 2, cat: 'research', updated: 10, dirty: false },
    { id: 'gone', start: 3, end: 4, cat: 'research', updated: 10, dirty: false },
    { id: 'mine', start: 5, end: 6, cat: 'research', updated: 30, dirty: true },
    { id: 'new', start: 7, end: 8, cat: 'research', updated: 30, dirty: true },
  ];
  const remote = [
    { id: 'same', start: 1, end: 9, cat: 'discussion', updated: 10 },
    { id: 'mine', start: 5, end: 99, cat: 'research', updated: 20 },
    { id: 'theirs', start: 0, end: 1, cat: 'research', updated: 5 },
  ];
  const merged = merge(local, remote);
  assert.deepEqual(merged.map((s) => s.id), ['theirs', 'same', 'mine', 'new']);
  assert.equal(merged[1].end, 9); // シートを手で直したぶんが届く
  assert.equal(merged[2].end, 6); // 手元の未送信が勝つ
  assert.equal(merged[2].dirty, true);
});

test('記録中が2つあれば早いほうだけ残す', () => {
  const out = dedupeOpen([
    { id: 'late', start: 20, end: null, cat: 'research', updated: 1 },
    { id: 'early', start: 10, end: null, cat: 'research', updated: 1 },
    { id: 'done', start: 1, end: 2, cat: 'research', updated: 1 },
  ], 100);
  assert.equal(out.find((s) => s.id === 'late').deleted, true);
  assert.equal(out.find((s) => s.id === 'early').deleted, undefined);
  assert.equal(out.find((s) => s.id === 'done').deleted, undefined);
});
