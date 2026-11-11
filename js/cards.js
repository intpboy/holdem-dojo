'use strict';
// 공통 상수, 덱, 족보 판정
const HEADLESS = typeof document === 'undefined';
const SB = 10, BB = 20, START = 2000;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const CATN = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
let unitBB = false;    // 칩 수를 BB 단위로 표시
const fmt = n => unitBB ? (Math.round(n / BB * 10) / 10).toLocaleString('ko-KR') + 'BB' : n.toLocaleString('ko-KR');
const cardText = c => RANKS[c >> 2] + SUITS[c & 3];
let AUTO = false;      // 테스트용: 사람 자리도 봇이 플레이
let speed = 1;
let hintOn = false;

/* ---------- 카드 / 족보 ---------- */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function newDeck() { const d = []; for (let i = 0; i < 52; i++) d.push(i); return shuffle(d); }

function straightHigh(mask) {
  for (let h = 12; h >= 4; h--) if (((mask >> (h - 4)) & 31) === 31) return h;
  if ((mask & 0x100F) === 0x100F) return 3; // A-2-3-4-5
  return -1;
}
// 2~7장에서 최고 5장 족보를 하나의 숫자로 (클수록 강함)
function evalHand(cards) {
  const rc = new Array(13).fill(0), sm = [0, 0, 0, 0], sc = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) { const r = c >> 2, s = c & 3; rc[r]++; sm[s] |= 1 << r; sc[s]++; mask |= 1 << r; }
  const pack = (cat, ks) => { let v = cat; for (let i = 0; i < 5; i++) v = v * 13 + (ks[i] || 0); return v; };
  let fs = -1;
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
  if (fs >= 0) { const sh = straightHigh(sm[fs]); if (sh >= 0) return pack(8, [sh]); }
  const quads = [], trips = [], pairs = [], singles = [];
  for (let r = 12; r >= 0; r--) {
    if (rc[r] === 4) quads.push(r); else if (rc[r] === 3) trips.push(r);
    else if (rc[r] === 2) pairs.push(r); else if (rc[r] === 1) singles.push(r);
  }
  if (quads.length) {
    const q = quads[0]; let k = 0;
    for (let r = 12; r >= 0; r--) if (r !== q && rc[r] > 0) { k = r; break; }
    return pack(7, [q, k]);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const p = Math.max(trips.length > 1 ? trips[1] : -1, pairs.length ? pairs[0] : -1);
    return pack(6, [trips[0], p]);
  }
  if (fs >= 0) {
    const ks = [];
    for (let r = 12; r >= 0 && ks.length < 5; r--) if ((sm[fs] >> r) & 1) ks.push(r);
    return pack(5, ks);
  }
  const sh = straightHigh(mask);
  if (sh >= 0) return pack(4, [sh]);
  if (trips.length) return pack(3, [trips[0], singles[0], singles[1]]);
  if (pairs.length >= 2) {
    const a = pairs[0], b = pairs[1]; let k = 0;
    for (let r = 12; r >= 0; r--) if (r !== a && r !== b && rc[r] > 0) { k = r; break; }
    return pack(2, [a, b, k]);
  }
  if (pairs.length) return pack(1, [pairs[0], singles[0], singles[1], singles[2]]);
  return pack(0, singles.slice(0, 5));
}
function handName(v) {
  const cat = Math.floor(v / 371293), k = Math.floor(v / 28561) % 13;
  if (cat === 8 && k === 12) return '로열 플러시';
  const r = RANKS[k];
  if (cat === 0) return r + ' 하이';
  if (cat === 1 || cat === 3 || cat === 7) return r + ' ' + CATN[cat];
  if (cat === 4 || cat === 8) return r + ' 하이 ' + CATN[cat];
  return CATN[cat];
}
