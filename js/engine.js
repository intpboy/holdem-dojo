'use strict';
// 게임 진행: 딜, 베팅 라운드, 쇼다운, 사이드 팟, 아웃 처리
/* ---------- 게임 상태 ---------- */
const BOT_DEFS = [
  { name: '민준', emoji: '🧐', tight: 0.8, aggr: 0.4, bluff: 0.05 },
  { name: '서연', emoji: '😎', tight: 0.4, aggr: 0.8, bluff: 0.15 },
  { name: '도윤', emoji: '🤠', tight: 0.15, aggr: 0.35, bluff: 0.08 },
  { name: '지우', emoji: '🦊', tight: 0.55, aggr: 0.6, bluff: 0.12 },
  { name: '하준', emoji: '🤪', tight: 0.1, aggr: 0.9, bluff: 0.25 },
];
const G = { players: [], dealer: 0, deck: [], board: [], currentBet: 0, minRaise: BB, street: '', handNo: 0, busy: false, reveal: false, turn: -1, result: '' };

function setupGame(nOpp) {
  G.players = [{ name: '나', emoji: '🙂', human: true, tight: 0.5, aggr: 0.6, bluff: 0.1 }];
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
let waitStep = ms => sleep(D(ms)); // 수동 진행 모드에서는 키 입력을 기다림 (UI에서 교체)
// 아래 훅들은 브라우저에서 js/ui.js가 실제 구현으로 교체한다 (테스트에서는 그대로 no-op)
let log = () => {}, render = () => {}, humanAction = () => Promise.resolve({ type: 'fold' });

function post(i, amt, label) {
  const p = G.players[i], a = Math.min(amt, p.chips);
  p.chips -= a; p.bet += a; p.total += a; p.last = label; p.lastAmt = a;
  if (p.chips === 0) p.allIn = true;
}
// 성향 통계: VPIP / PFR / 포스트플랍 공격 빈도
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
  log(`— 핸드 #${G.handNo} —`, 'h');
  for (const p of P) {
    // 아웃된 플레이어는 매 핸드 폴드 상태로 두어 모든 진행에서 건너뜀
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
  log(`내 카드: ${P[0].cards.map(cardText).join(' ')}`, 'me');
  render(); await sleep(D(500));

  let alive = await bettingRound((bb + 1) % n);
  for (const [name, cnt, label] of [['flop', 3, '플랍'], ['turn', 1, '턴'], ['river', 1, '리버']]) {
    if (!alive) break;
    endStreet();
    if (canActCount() <= 1) G.reveal = true;
    render();
    await waitStep(G.reveal ? 1100 : 600, label + ' 오픈');
    G.street = name;
    for (let k = 0; k < cnt; k++) G.board.push(G.deck.pop());
    streetCache();
    log(`${label}: ${G.board.map(cardText).join(' ')}`, 'h');
    render();
    alive = await bettingRound((G.dealer + 1) % n);
  }
  endStreet();
  showdown();
  // 핸드 종료 후에는 폴드한 패까지 전부 공개
  for (const p of P) if (!p.out && !p.handName) p.handName = handName(evalHand(p.cards.concat(G.board)));
  const mucked = P.filter(p => p.folded && !p.human && !p.out);
  if (mucked.length) log('폴드한 패: ' + mucked.map(p => `${p.name} ${p.cards.map(cardText).join(' ')}`).join(' / '));
  // 칩을 모두 잃으면 아웃
  for (const p of P) if (!p.out && p.chips <= 0) { p.out = true; log(`${p.name} 아웃`, 'h'); }
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
      if (G.currentBet - p.bet <= 0 && canActCount() <= 1) break; // 혼자 남아 더 걸 상대가 없음
      G.turn = i; render();
      let act;
      if (p.human && !AUTO) act = await humanAction();
      else { await waitStep(450 + Math.random() * 550, p.name + ' 차례'); act = botAction(i); }
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

// 반환값: 레이즈(또는 벳)로 액션이 다시 열렸는지
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
      if (p.chips === 0) { p.allIn = true; p.last = '올인'; }
      else p.last = opened ? '벳' : '레이즈';
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
  if (type === 'fold') { p.folded = true; p.last = '폴드'; track(p, 'fold'); }
  else if (type === 'call') {
    const pay = Math.min(toCall, p.chips);
    p.chips -= pay; p.bet += pay; p.total += pay;
    if (p.chips === 0) { p.allIn = true; p.last = '올인 콜'; } else p.last = '콜';
    p.lastAmt = pay;
    track(p, 'call');
  } else { p.last = '체크'; track(p, 'check'); }
  log(`${p.name}: ${p.last}${p.lastAmt != null ? ' ' + fmt(p.lastAmt) : ''}`, p.human ? 'me' : '');
  return false;
}

function showdown() {
  const P = G.players, n = P.length;
  // 콜 받지 못한 초과 베팅 반환
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
    G.result = `${w.name} 승리 · 팟 ${fmt(amt)}`;
    log(G.result, 'w');
    return;
  }
  G.reveal = true;
  for (const p of live) { p.score = evalHand(p.cards.concat(G.board)); p.handName = handName(p.score); }
  log(live.map(p => `${p.name} ${p.cards.map(cardText).join(' ')} (${p.handName})`).join(' / '));
  // 사이드 팟 계산
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
