'use strict';
/* ---------- AI: range-based strategy ---------- */
// For every player we track a range: the distribution of hands they plausibly hold given their actions so far.
// Bots never look at an opponent's real cards; equity, MDF and bet sizing are computed from these ranges only.
function chen(cards) {
  const r0 = cards[0] >> 2, r1 = cards[1] >> 2, a = Math.max(r0, r1), b = Math.min(r0, r1);
  const pts = r => r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2;
  let s = pts(a);
  if (a === b) return Math.max(5, s * 2);
  if ((cards[0] & 3) === (cards[1] & 3)) s += 2;
  const gap = a - b - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && a < 10) s += 1;
  return s;
}
const NC = 1326, COMBOS = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) COMBOS.push([a, b]);
const comboIndex = (a, b) => { if (a > b) { const t = a; a = b; b = t; } return a * (103 - a) / 2 + (b - a - 1); };
// Preflop percentile of each combo (0 = best)
const CPCT = (() => {
  const sc = COMBOS.map(chen), sorted = sc.slice().sort((x, y) => y - x), out = new Float64Array(NC);
  const first = new Map(), cnt = new Map();
  sorted.forEach((v, idx) => { if (!first.has(v)) first.set(v, idx); cnt.set(v, (cnt.get(v) || 0) + 1); });
  sc.forEach((v, k) => { out[k] = (first.get(v) + cnt.get(v) / 2) / NC; });
  return out;
})();
const ss = x => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
const NEUTRAL = { tight: 0.5, aggr: 0.6, bluff: 0.1 };

// New street: precompute the made-hand rank of every combo on this board
function streetCache() {
  const rk = G.rank = new Float64Array(NC), ord = [], onB = new Set(G.board);
  for (let k = 0; k < NC; k++) {
    const c = COMBOS[k];
    if (onB.has(c[0]) || onB.has(c[1])) { rk[k] = -1; for (const r of G.rng) if (r) r[k] = 0; }
    else { rk[k] = evalHand([c[0], c[1]].concat(G.board)); ord.push(k); }
  }
  ord.sort((a, b) => rk[a] - rk[b]);
  G.order = ord;
}
// Fraction of range w that each combo beats on the current board
function hsVs(w) {
  const out = new Float64Array(NC), ord = G.order, rk = G.rank;
  let tot = 0;
  for (const k of ord) tot += w[k];
  if (tot <= 0) return out.fill(0.5);
  let cum = 0, i = 0;
  while (i < ord.length) {
    let j = i, g = 0;
    while (j < ord.length && rk[ord[j]] === rk[ord[i]]) { g += w[ord[j]]; j++; }
    const v = (cum + g / 2) / tot;
    for (let t = i; t < j; t++) out[ord[t]] = v;
    cum += g; i = j;
  }
  return out;
}
// Chance of beating every remaining opponent's range at once
function hsAll(i) {
  const out = new Float64Array(NC).fill(1);
  G.players.forEach((q, j) => {
    if (j === i || q.folded) return;
    const h = hsVs(G.rng[j]);
    for (let k = 0; k < NC; k++) out[k] *= h[k];
  });
  return out;
}
// Monte Carlo equity: sample opponent hands from their ranges and run out the board
function equityVsRanges(i, iters) {
  const P = G.players, me = P[i], cums = [];
  P.forEach((q, j) => {
    if (j === i || q.folded) return;
    const w = G.rng[j], c = new Float64Array(NC);
    let s = 0;
    for (let k = 0; k < NC; k++) { s += w[k]; c[k] = s; }
    cums.push(c);
  });
  const used = new Uint8Array(52);
  let win = 0, n = 0;
  for (let it = 0; it < iters; it++) {
    used.fill(0); used[me.cards[0]] = used[me.cards[1]] = 1;
    for (const c of G.board) used[c] = 1;
    const hands = [];
    let ok = true;
    for (const cum of cums) {
      const tot = cum[NC - 1];
      let found = false;
      for (let t = 0; t < 12 && !found && tot > 0; t++) {
        const r = Math.random() * tot;
        let lo = 0, hi = NC - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] > r) hi = m; else lo = m + 1; }
        const c = COMBOS[lo];
        if (!used[c[0]] && !used[c[1]]) { used[c[0]] = used[c[1]] = 1; hands.push(c); found = true; }
      }
      if (!found) { ok = false; break; }
    }
    if (!ok) continue;
    const b = G.board.slice();
    while (b.length < 5) { const c = Math.floor(Math.random() * 52); if (!used[c]) { used[c] = 1; b.push(c); } }
    const my = evalHand(me.cards.concat(b));
    let ties = 0, lost = false;
    for (const h of hands) {
      const v = evalHand([h[0], h[1]].concat(b));
      if (v > my) { lost = true; break; }
      if (v === my) ties++;
    }
    n++;
    if (!lost) win += 1 / (ties + 1);
  }
  return n ? win / n : 0.5;
}

// Preflop: pick range widths for the spot (rX = raise, cX = continue), then turn the hand's percentile into frequencies
// w = range width multiplier, ag = raise multiplier, limpAdd = extra calling range (bot personalities; the baseline model is 1,1,0)
function preflopModel(i, w, ag, limpAdd) {
  const P = G.players, p = P[i], nAct = P.filter(q => !q.out).length;
  const toCall = Math.min(p.chips, Math.max(0, G.currentBet - p.bet));
  const nOpp = inHand().length - 1, maxTo = p.bet + p.chips, bbs = G.currentBet / BB, isBB = G.bb === i;
  const sig = x => 1 / (1 + Math.exp(-x));
  const inR = (pct, X) => X >= 1 ? 1 : sig((X - pct) / (0.012 + X * 0.1));
  let rX, cX, size, band = false;
  if (G.currentBet <= BB) {
    const limpers = P.filter((q, j) => j !== i && j !== G.bb && !q.folded && q.bet >= BB).length;
    if (toCall === 0) { rX = nOpp === 1 ? 0.3 : 0.14; cX = 1; size = BB * (3.5 + limpers); }
    else {
      let behind = 0;
      for (let s = 1; s < P.length; s++) { const j = (i + s) % P.length; if (!P[j].folded) behind++; if (j === G.bb) break; }
      rX = nAct === 2 ? 0.8 : [0.45, 0.45, 0.45, 0.28, 0.2, 0.16][Math.min(behind, 5)];
      if (limpers > 0) rX *= 0.65;
      const isSB = p.bet === SB && nAct > 2;
      cX = rX + (limpers > 0 ? 0.15 : isSB ? 0.15 : 0);
      size = BB * (limpers > 0 ? 3.5 + limpers : isSB ? 3 : 2.5);
    }
  } else if (bbs <= 4.5) {
    rX = nOpp === 1 ? 0.12 : 0.06; cX = isBB ? (nOpp === 1 ? 0.6 : 0.35) : nOpp === 1 ? 0.4 : 0.15;
    size = G.currentBet * 3.5; band = true;
  } else if (bbs <= 13) {
    rX = nOpp === 1 ? 0.05 : 0.03; cX = p.raises > 0 ? (nOpp === 1 ? 0.3 : 0.13) : 0.05;
    size = G.currentBet * 2.3; band = true;
  } else {
    const eff = toCall / BB;
    cX = (eff <= 10 ? 0.3 : eff <= 20 ? 0.16 : eff <= 40 ? 0.08 : 0.04) * (nOpp === 1 ? 1.5 : 1);
    rX = cX * 0.5; size = maxTo;
  }
  rX = Math.min(1, rX * w * ag);
  if (cX < 1) cX = Math.min(0.98, cX * w + limpAdd);
  cX = Math.max(cX, rX);
  const probs = pct => {
    let raise = inR(pct, rX), call = Math.max(0, inR(pct, cX) - raise), fold = Math.max(0, 1 - raise - call);
    if (band) { // bluff 3-bets/4-bets mixed in from hands just below the calling range
      const b = Math.min(fold, 0.2 * ag * Math.exp(-Math.pow((pct - cX - 0.04) / 0.04, 2)));
      fold -= b; raise += b;
    }
    if (toCall === 0) { call += fold; fold = 0; }
    return { fold, call, raise };
  };
  return { probs, size };
}

// Postflop: how likely a "typical player" is to take each action with hand strength hN (share of opposing ranges beaten).
// Used to narrow a player's range after seeing their action.
function pubPost(hN, Sf, type, Sb) {
  const bl = G.board.length === 3 ? 0.35 : G.board.length === 4 ? 0.28 : 0.22;
  const weak = ss((0.35 - hN) / 0.2);
  if (Sf <= 0) {
    const big = Sb > 0.8, small = Sb > 0 && Sb < 0.4; // big bets are polarized, small bets include medium hands
    const vT = big ? 0.7 : small ? 0.55 : 0.62, mid = big ? 0.04 : small ? 0.22 : 0.1;
    const pBet = mid + (0.78 - mid) * ss((hN - vT + 0.1) / 0.2) + (bl - mid) * weak;
    return type === 'raise' ? pBet : 1 - pBet;
  }
  const pRaise = 0.03 + 0.42 * ss((hN - 0.72) / 0.2) + 0.05 * weak;
  if (type === 'raise') return pRaise;
  const pCont = 0.05 + 0.95 * ss((hN - (0.12 + 0.25 * Math.min(1, Sf))) / 0.3);
  return pCont * (1 - pRaise);
}
// Call right before an action; call the returned function afterwards to update that player's range
function rangeUpdater(i) {
  const w = G.rng[i], p = G.players[i];
  if (G.street === 'preflop') {
    const m = preflopModel(i, 1, 1, 0);
    return type => {
      if (type === 'fold') return;
      for (let k = 0; k < NC; k++) w[k] *= Math.max(0.03, m.probs(CPCT[k])[type]);
    };
  }
  const h = hsAll(i), inv = 1 / Math.max(1, inHand().length - 1);
  const toCall = Math.max(0, G.currentBet - p.bet), Sf = toCall > 0 ? toCall / Math.max(1, potTotal() - toCall) : 0;
  return (type, Sb) => {
    if (type === 'fold') return;
    let mx = 0;
    for (let k = 0; k < NC; k++) {
      if (w[k] <= 0) continue;
      w[k] *= Math.max(0.02, pubPost(Math.pow(h[k], inv), Sf, type, Sb));
      if (w[k] > mx) mx = w[k];
    }
    if (mx > 0) for (let k = 0; k < NC; k++) w[k] /= mx;
  };
}

// Postflop strategy: frequency of each action and the bet size
function postflopPolicy(i, pers) {
  const P = G.players, p = P[i], street = G.board.length;
  const toCall = Math.min(p.chips, Math.max(0, G.currentBet - p.bet)), pot = potTotal();
  const nOpp = Math.max(1, inHand().length - 1), inv = 1 / nOpp;
  const h = hsAll(i), eq = equityVsRanges(i, 300);
  const hsMe = Math.pow(h[comboIndex(p.cards[0], p.cards[1])], inv); // strength on the current board
  const sMe = Math.pow(eq, inv);                                     // strength including cards to come (heads-up equivalent)
  const draw = street < 5 && sMe - hsMe > 0.1 && hsMe < 0.5;
  // Where this hand sits (q, 0 = top) inside the range others put us on, and the share of value hands
  const w = G.rng[i];
  let tot = 0, above = 0, val = 0;
  for (let k = 0; k < NC; k++) {
    if (w[k] <= 0) continue;
    const x = Math.pow(h[k], inv);
    tot += w[k]; if (x > sMe) above += w[k]; if (x > 0.7) val += w[k];
  }
  const q = tot ? above / tot : 0.5, valueShare = tot ? val / tot : 0.25;
  let fold = 0, call = 0, raise = 0, size = 0;
  if (toCall === 0) {
    // Sizing: big with near-nuts and bluffs (polarized), medium with solid value, small with thin value
    const S = sMe > 0.88 || sMe < 0.45 ? (street === 5 ? 1 : 0.75) : sMe > 0.72 ? 0.6 : 0.33;
    let pV = ss((sMe - 0.62) / 0.12) * (0.55 + 0.4 * pers.aggr);
    if (sMe > 0.9) pV = Math.max(pV, street === 5 ? 0.97 : 0.85); // near-nuts almost always bet
    // Bluff share = value share × S/(1+S) (makes the caller indifferent), with more bluffs on earlier streets
    const mult = (street === 3 ? 1.4 : street === 4 ? 1.2 : 1) * (G.lastAggr === i ? 1.1 : 0.8) * (0.5 + pers.bluff * 5) / Math.pow(nOpp, 0.7);
    const bShare = Math.min(0.5, valueShare * (S / (1 + S)) * mult);
    let pB = 0;
    if (sMe < 0.45) { pB = ss((q - (1 - bShare)) / 0.06 + 0.5) * 0.9; if (draw) pB = Math.max(pB, 0.5); }
    raise = Math.max(pV, pB); call = 1 - raise; size = pot * S;
  } else {
    const alpha = toCall / (pot + toCall), S = toCall / Math.max(1, pot - toCall);
    // MDF: the top share of our range that must continue so a bluff of this size is not automatically profitable
    const mdf = 1 - Math.pow(S / (1 + S), inv);
    // Defend wider or tighter depending on how often the bettor usually bets
    let adapt = 1;
    const b = P[G.lastAggr];
    if (b && b !== p && b.nAgg + b.nPass >= 10) adapt = clamp(1 + (b.nAgg / (b.nAgg + b.nPass) - 0.3) * 1.5, 0.7, 1.35);
    const d = mdf * adapt * (1 + (0.5 - pers.tight) * 0.4) * 0.8;
    const cont = Math.max(ss((eq - alpha - 0.04) / 0.08 + 0.5), ss((d - q) / 0.08 + 0.5)); // continue when pot odds are right or the hand is inside the MDF range
    let pR = ss((sMe - 0.72) / 0.12) * (0.45 + 0.4 * pers.aggr);
    if (sMe > 0.9) pR = Math.max(pR, street === 5 ? 0.97 : 0.85); // near-nuts almost always raise (and keep re-raising)
    else if (p.raises >= 2) pR = 0;
    const pBR = (p.raises >= 1 || toCall > p.chips * 0.25) ? 0 : Math.min(0.3, (draw ? 0.15 : 0.035) * (pers.bluff / 0.1));
    raise = pR + (1 - pR) * pBR;
    call = Math.max(0, cont - pR) * (1 - pBR);
    fold = Math.max(0, 1 - raise - call);
    size = G.currentBet + (pot + toCall) * 0.75;
  }
  return { fold, call, raise, size, eq };
}

function botAction(i) {
  const p = G.players[i], maxTo = p.bet + p.chips;
  let pol;
  if (G.street === 'preflop') {
    const m = preflopModel(i, 1.3 - 0.6 * p.tight, 0.7 + 0.6 * p.aggr, Math.max(0, 0.5 - p.aggr) * 0.5);
    pol = Object.assign({ size: m.size }, m.probs(CPCT[comboIndex(p.cards[0], p.cards[1])]));
  } else pol = postflopPolicy(i, p);
  const r = Math.random();
  if (r < pol.raise) {
    let to = Math.round(pol.size * (0.9 + Math.random() * 0.2) / SB) * SB;
    if (to >= maxTo * 0.7) to = maxTo;
    return { type: 'raise', amount: to };
  }
  return r < pol.raise + pol.call ? { type: 'call' } : { type: 'fold' };
}

// Strategy shown on the human's turn (same math as the bots, neutral personality)
function gtoAdvice(canRaise, minTo) {
  const me = G.players[0], maxTo = me.bet + me.chips;
  const toCall = Math.min(me.chips, Math.max(0, G.currentBet - me.bet));
  let pol;
  if (G.street === 'preflop') {
    const m = preflopModel(0, 1, 1, 0);
    pol = Object.assign({ size: m.size, eq: equityVsRanges(0, 600) }, m.probs(CPCT[comboIndex(me.cards[0], me.cards[1])]));
  } else pol = postflopPolicy(0, NEUTRAL);
  let { fold, call, raise } = pol;
  if (!canRaise) { call += raise; raise = 0; }
  if (toCall === 0) { call += fold; fold = 0; }
  const sum = fold + call + raise || 1;
  const size = Math.max(minTo, Math.min(maxTo, Math.round(pol.size / SB) * SB));
  return { fold: fold / sum, call: call / sum, raise: raise / sum, size, eq: pol.eq };
}
