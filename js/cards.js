'use strict';
// Shared constants, deck, hand evaluation
const HEADLESS = typeof document === 'undefined';
const SB = 10, BB = 20, START = 2000;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const CATN = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
let unitBB = false;    // show amounts in big blinds
const fmt = n => unitBB ? (Math.round(n / BB * 10) / 10).toLocaleString('en-US') + 'BB' : n.toLocaleString('en-US');
const cardText = c => RANKS[c >> 2] + SUITS[c & 3];
let AUTO = false;      // tests only: a bot plays the human seat
let speed = 1;
let hintOn = false;

/* ---------- Cards / hand ranks ---------- */
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
// Best 5-card hand out of 2-7 cards, packed into one number (higher is stronger)
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
  if (cat === 8 && k === 12) return 'Royal flush';
  const r = RANKS[k];
  if (cat === 0) return r + ' high';
  if (cat === 1) return 'Pair of ' + r + 's';
  if (cat === 3) return 'Three ' + r + 's';
  if (cat === 7) return 'Four ' + r + 's';
  if (cat === 4 || cat === 8) return r + '-high ' + CATN[cat].toLowerCase();
  return CATN[cat];
}
