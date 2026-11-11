'use strict';
// Game flow: dealing, betting rounds, showdown, side pots, eliminations
/* ---------- Game state ---------- */
const BOT_DEFS = [
  { name: 'Minjun', emoji: '🧐', tight: 0.8, aggr: 0.4, bluff: 0.05 },
  { name: 'Seoyeon', emoji: '😎', tight: 0.4, aggr: 0.8, bluff: 0.15 },
  { name: 'Doyun', emoji: '🤠', tight: 0.15, aggr: 0.35, bluff: 0.08 },
  { name: 'Jiwoo', emoji: '🦊', tight: 0.55, aggr: 0.6, bluff: 0.12 },
  { name: 'Hajun', emoji: '🤪', tight: 0.1, aggr: 0.9, bluff: 0.25 },
];
const G = { players: [], dealer: 0, deck: [], board: [], currentBet: 0, minRaise: BB, street: '', handNo: 0, busy: false, reveal: false, turn: -1, result: '' };

function setupGame(nOpp) {
  G.players = [{ name: 'You', emoji: '🙂', human: true, tight: 0.5, aggr: 0.6, bluff: 0.1 }];
  for (const d of shuffle(BOT_DEFS.slice()).slice(0, nOpp)) G.players.push(Object.assign({ human: false }, d));
  for (const p of G.players) Object.assign(p, { chips: START, buyins: 1, cards: [], folded: false, allIn: false, bet: 0, total: 0, last: '', lastAmt: null, raises: 0, win: 0, handName: '', score: 0, nH: 0, nV: 0, nR: 0, nAgg: 0, nCall: 0, nPass: 0, v: false, r: false, out: false });
  G.over = '';
  G.dealer = Math.floor(Math.random() * G.players.length);
  G.handNo = 0; G.board = []; G.result = ''; G.busy = false; G.reveal = false; G.turn = -1;
}
const canAct = p => !p.folded && !p.allIn;
const canActCount = () => G.players.filter(canAct).length;
const inHand = () => G.players.filter(p => !p.folded);
const potTotal = () => G.players.reduce((s, p) => s + p.total, 0);
const sleep = ms => (HEADLESS || ms <= 0) ? Promise.resolve() : new Promise(r => setTimeout(r, ms));
const D = ms => ms * speed * (G.players[0].folded ? 0.35 : 1);
let waitStep = ms => sleep(D(ms)); // in step mode this waits for a key press (replaced by the UI)
// These hooks are replaced with real implementations by js/ui.js in the browser (no-ops in tests)
let log = () => {}, render = () => {}, humanAction = () => Promise.resolve({ type: 'fold' });

function post(i, amt, label) {
  const p = G.players[i], a = Math.min(amt, p.chips);
  p.chips -= a; p.bet += a; p.total += a; p.last = label; p.lastAmt = a;
  if (p.chips === 0) p.allIn = true;
}
// Tendency stats: VPIP / PFR / postflop aggression
function track(p, type) {
  if (G.street === 'preflop') {
    if (type !== 'raise' && type !== 'call') return;
    if (!p.v) { p.v = true; p.nV++; }
    if (type === 'raise' && !p.r) { p.r = true; p.nR++; }
  } else if (type === 'raise') p.nAgg++;
  else { p.nPass++; if (type === 'call') p.nCall++; }
}

async function playHand() {
  if (G.busy || G.over) return;
  G.busy = true; G.handNo++;
  const P = G.players, n = P.length;
  log(`— Hand #${G.handNo} —`, 'h');
  for (const p of P) {
    // Eliminated players start every hand folded so the rest of the flow skips them
    Object.assign(p, { cards: [], folded: p.out, allIn: false, bet: 0, total: 0, last: '', lastAmt: null, raises: 0, win: 0, handName: '', score: 0, v: false, r: false });
    if (!p.out) p.nH++;
  }
  G.board = []; G.deck = newDeck(); G.result = ''; G.reveal = false; G.turn = -1;
  G.rng = P.map(p => p.out ? null : new Float64Array(NC).fill(1)); G.lastAggr = -1;
  const nextIn = i => { do { i = (i + 1) % n; } while (P[i].out); return i; };
  const nIn = P.filter(p => !p.out).length;
  G.dealer = nextIn(G.dealer);
  const sb = nIn === 2 ? G.dealer : nextIn(G.dealer), bb = nextIn(sb);
  G.minRaise = BB; G.street = 'preflop'; G.bb = bb;
  post(sb, SB, 'SB'); post(bb, BB, 'BB');
  G.currentBet = BB;
  for (let r = 0; r < 2; r++) for (let k = 1; k <= n; k++) { const q = P[(G.dealer + k) % n]; if (!q.out) q.cards.push(G.deck.pop()); }
  log(`Your cards: ${P[0].cards.map(cardText).join(' ')}`, 'me');
  render(); await sleep(D(500));

  let alive = await bettingRound((bb + 1) % n);
  for (const [name, cnt, label] of [['flop', 3, 'Flop'], ['turn', 1, 'Turn'], ['river', 1, 'River']]) {
    if (!alive) break;
    endStreet();
    if (canActCount() <= 1) G.reveal = true;
    render();
    await waitStep(G.reveal ? 1100 : 600, 'deal the ' + label.toLowerCase());
    G.street = name;
    for (let k = 0; k < cnt; k++) G.board.push(G.deck.pop());
    streetCache();
    log(`${label}: ${G.board.map(cardText).join(' ')}`, 'h');
    render();
    alive = await bettingRound((G.dealer + 1) % n);
  }
  endStreet();
  showdown();
  // Once the hand is over, reveal every hand including the folded ones
  for (const p of P) if (!p.out && !p.handName) p.handName = handName(evalHand(p.cards.concat(G.board)));
  const mucked = P.filter(p => p.folded && !p.human && !p.out);
  if (mucked.length) log('Folded hands: ' + mucked.map(p => `${p.name} ${p.cards.map(cardText).join(' ')}`).join(' / '));
  // Out of chips means out of the game
  for (const p of P) if (!p.out && p.chips <= 0) { p.out = true; log(`${p.name} is out`, 'h'); }
  if (P[0].out) G.over = 'lose';
  else if (P.filter(p => !p.out).length === 1) G.over = 'win';
  G.busy = false;
  render();
}

function endStreet() {
  for (const p of G.players) { p.bet = 0; p.raises = 0; if (canAct(p)) { p.last = ''; p.lastAmt = null; } }
  G.currentBet = 0; G.minRaise = BB;
}

async function bettingRound(start) {
  const P = G.players, n = P.length;
  let need = new Set();
  P.forEach((p, i) => { if (canAct(p)) need.add(i); });
  let i = start;
  while (need.size > 0) {
    if (inHand().length <= 1) break;
    const p = P[i];
    if (need.has(i)) {
      if (G.currentBet - p.bet <= 0 && canActCount() <= 1) break; // nobody left to bet against
      G.turn = i; render();
      let act;
      if (p.human && !AUTO) act = await humanAction();
      else { await waitStep(450 + Math.random() * 550, p.name + ' to act'); act = botAction(i); }
      const upd = rangeUpdater(i), potB = potTotal(), tc = Math.max(0, G.currentBet - p.bet), chipsB = p.chips;
      const raised = applyAction(i, act);
      upd(raised ? 'raise' : p.folded ? 'fold' : 'call', raised ? (chipsB - p.chips - tc) / Math.max(1, potB + tc) : 0);
      if (raised) G.lastAggr = i;
      need.delete(i);
      if (raised) { need = new Set(); P.forEach((q, j) => { if (j !== i && canAct(q)) need.add(j); }); }
      G.turn = -1; render(); await sleep(D(200));
    }
    i = (i + 1) % n;
  }
  G.turn = -1;
  return inHand().length > 1;
}

// Returns whether a bet or raise reopened the action
function applyAction(i, act) {
  const p = G.players[i];
  const toCall = Math.max(0, G.currentBet - p.bet);
  let type = act.type;
  if (type === 'raise') {
    const maxTo = p.bet + p.chips;
    const others = G.players.some((q, j) => j !== i && canAct(q));
    if (maxTo <= G.currentBet || !others) type = 'call';
    else {
      const minTo = Math.min(G.currentBet + G.minRaise, maxTo);
      const to = Math.max(minTo, Math.min(Math.round(act.amount) || 0, maxTo));
      const pay = to - p.bet, opened = G.currentBet === 0;
      p.chips -= pay; p.bet = to; p.total += pay;
      const size = to - G.currentBet;
      if (size >= G.minRaise) G.minRaise = size;
      G.currentBet = to; p.raises++;
      if (p.chips === 0) { p.allIn = true; p.last = 'All-in'; }
      else p.last = opened ? 'Bet' : 'Raise';
      p.lastAmt = to;
      track(p, 'raise');
      log(`${p.name}: ${p.last} ${fmt(to)}`, p.human ? 'me' : '');
      return true;
    }
  }
  if (type === 'check' && toCall > 0) type = 'fold';
  if (type === 'fold' && toCall === 0) type = 'check';
  if (type === 'call' && toCall === 0) type = 'check';
  p.lastAmt = null;
  if (type === 'fold') { p.folded = true; p.last = 'Fold'; track(p, 'fold'); }
  else if (type === 'call') {
    const pay = Math.min(toCall, p.chips);
    p.chips -= pay; p.bet += pay; p.total += pay;
    if (p.chips === 0) { p.allIn = true; p.last = 'All-in call'; } else p.last = 'Call';
    p.lastAmt = pay;
    track(p, 'call');
  } else { p.last = 'Check'; track(p, 'check'); }
  log(`${p.name}: ${p.last}${p.lastAmt != null ? ' ' + fmt(p.lastAmt) : ''}`, p.human ? 'me' : '');
  return false;
}

function showdown() {
  const P = G.players, n = P.length;
  // Return any uncalled part of the biggest bet
  const sorted = P.map(p => p.total).sort((a, b) => b - a);
  if (sorted[0] > sorted[1]) {
    const top = P.find(p => p.total === sorted[0]), ex = sorted[0] - sorted[1];
    top.total -= ex; top.chips += ex;
  }
  const live = inHand();
  if (live.length === 1) {
    const w = live[0], amt = potTotal();
    w.chips += amt; w.win = amt;
    P.forEach(p => { p.total = 0; });
    G.result = `${w.name} won the pot · ${fmt(amt)}`;
    log(G.result, 'w');
    return;
  }
  G.reveal = true;
  for (const p of live) { p.score = evalHand(p.cards.concat(G.board)); p.handName = handName(p.score); }
  log(live.map(p => `${p.name} ${p.cards.map(cardText).join(' ')} (${p.handName})`).join(' / '));
  // Build side pots
  const contrib = P.map(p => p.total), pots = [];
  for (;;) {
    let m = Infinity;
    P.forEach((p, i) => { if (!p.folded && contrib[i] > 0) m = Math.min(m, contrib[i]); });
    if (m === Infinity) break;
    let amt = 0; const elig = [];
    P.forEach((p, i) => {
      if (contrib[i] > 0) {
        const t = Math.min(contrib[i], m);
        if (!p.folded) elig.push(i);
        contrib[i] -= t; amt += t;
      }
    });
    pots.push({ amt, elig });
  }
  pots[pots.length - 1].amt += contrib.reduce((a, b) => a + b, 0);
  for (const pot of pots) {
    let best = -1;
    pot.elig.forEach(i => { if (P[i].score > best) best = P[i].score; });
    const ws = pot.elig.filter(i => P[i].score === best);
    ws.sort((a, b) => ((a - G.dealer - 1 + n) % n) - ((b - G.dealer - 1 + n) % n));
    const share = Math.floor(pot.amt / ws.length);
    let rem = pot.amt - share * ws.length;
    for (const i of ws) { let g = share; if (rem > 0) { g++; rem--; } P[i].chips += g; P[i].win += g; }
  }
  P.forEach(p => { p.total = 0; });
  G.result = P.filter(p => p.win > 0).map(p => `${p.name} +${fmt(p.win)} (${p.handName})`).join(' · ');
  log(G.result, 'w');
}
