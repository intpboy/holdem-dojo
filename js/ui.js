'use strict';
// 화면 그리기, 버튼·단축키, 설정 (브라우저 전용)
/* ---------- UI ---------- */
let resolveHuman = null, RU = null;

(() => {
  const $ = id => document.getElementById(id);
  const seatsEl = $('seats'), boardEl = $('board'), potEl = $('pot'), msgEl = $('msg'), logEl = $('log'), statsEl = $('stats'), hintEl = $('hint');
  const bFold = $('bFold'), bCall = $('bCall'), bRaise = $('bRaise'), bNext = $('bNext'), slider = $('rSlider'), num = $('rNum');

  const store = {
    get(k, d) { try { const v = localStorage.getItem('holdem.' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('holdem.' + k, v); } catch (e) {} },
  };

  let manual = true, resolveStep = null, stepLabel = '';
  waitStep = (ms, label) => (!manual || AUTO) ? sleep(D(ms)) : new Promise(res => { resolveStep = res; stepLabel = label; renderControls(); });
  function step() {
    if (!resolveStep) return;
    const r = resolveStep; resolveStep = null;
    renderControls(); r();
  }

  log = (text, cls) => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = text;
    logEl.appendChild(d);
    while (logEl.childNodes.length > 400) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  };

  const cardHTML = c => c == null ? '<div class="card back"></div>'
    : `<div class="card${(c & 3) === 1 || (c & 3) === 2 ? ' red' : ''}"><b>${RANKS[c >> 2]}</b><i>${SUITS[c & 3]}</i></div>`;

  render = () => {
    const P = G.players, n = P.length;
    let h = '';
    P.forEach((p, i) => {
      const ang = (90 + i * 360 / n) * Math.PI / 180, cx = Math.cos(ang), sy = Math.sin(ang);
      const over = !G.busy && G.handNo > 0;
      const show = p.human || over || (G.reveal && !p.folded);
      const cards = (p.folded && !p.human && !over) ? '' : p.cards.map(c => cardHTML(show ? c : null)).join('');
      if (p.out && !p.cards.length) { p.last = '아웃'; p.lastAmt = null; }
      const cls = ['seat', p.human ? 'me' : '', p.folded || p.out ? 'folded' : '', G.turn === i ? 'turn' : '', p.win > 0 ? 'winner' : ''].join(' ');
      h += `<div class="${cls}" style="left:${50 + 43 * cx}%;top:${50 + 41 * sy}%">
        <div class="cards">${cards}</div>
        <div class="plate">${i === G.dealer && G.handNo > 0 ? '<span class="dealer">D</span>' : ''}
          <div class="nm">${p.emoji} ${p.name}</div><div class="ch">${fmt(p.chips)}</div>
          ${p.nH > 0 ? `<div class="st">VPIP ${Math.round(p.nV / p.nH * 100)} · PFR ${Math.round(p.nR / p.nH * 100)} · AF ${p.nCall ? (p.nAgg / p.nCall).toFixed(1) : p.nAgg ? '∞' : '-'}</div>` : ''}
          ${p.handName && (over || (G.reveal && !p.folded)) ? `<div class="hn">${p.handName}</div>` : ''}
        </div>
        ${p.win > 0 ? `<div class="bubble win">+${fmt(p.win)}</div>` : p.last ? `<div class="bubble">${p.last}${p.lastAmt != null ? ' ' + fmt(p.lastAmt) : ''}</div>` : ''}
      </div>`;
      if (p.bet > 0) h += `<div class="bet" style="left:${50 + 25 * cx}%;top:${50 + 23 * sy}%">${fmt(p.bet)}</div>`;
    });
    seatsEl.innerHTML = h;
    boardEl.innerHTML = G.board.map(cardHTML).join('');
    const pot = potTotal();
    potEl.textContent = pot > 0 ? `팟 ${fmt(pot)}` : '';
    msgEl.textContent = G.result || '';
    const me = P[0], net = me.chips + me.total - START * me.buyins;
    statsEl.innerHTML = `핸드 <b>#${G.handNo}</b> · 블라인드 ${SB}/${BB} · 수익 <b style="color:${net >= 0 ? '#7fe3a3' : '#ff8a8a'}">${net >= 0 ? '+' : ''}${fmt(net)}</b>`;
    renderControls();
  };

  function renderGto() {
    const el = $('gto');
    if (!resolveHuman || !RU || !RU.gto) { el.innerHTML = '<div class="gnote">내 차례가 되면 표시됩니다.</div>'; return; }
    const g = RU.gto, rows = [];
    if (RU.toCall > 0) rows.push(['폴드', g.fold, '#b8434c']);
    rows.push([RU.toCall > 0 ? '콜' : '체크', g.call, '#2c6fb5']);
    if (RU.can) rows.push([G.currentBet === 0 ? '벳' : '레이즈', g.raise, '#c07a12']);
    const mx = Math.max(...rows.map(r => r[1]));
    el.innerHTML = rows.map(([l, v, c]) => `<div class="grow${v === mx ? ' top' : ''}"><span>${l}</span><div class="gbar"><div style="width:${v * 100}%;background:${c}"></div></div><b>${Math.round(v * 100)}%</b></div>`).join('')
      + (RU.can && g.raise > 0.05 ? `<div class="gnote">권장 사이즈: ${fmt(g.size)}</div>` : '')
      + '<div class="gnote">레인지·팟 오즈·MDF 기반 근사치 (솔버 계산 아님)</div>';
  }

  function renderControls() {
    renderGto();
    const my = !!resolveHuman, me = G.players[0];
    $('actRow').classList.toggle('hide', !my);
    $('raiseRow').classList.toggle('hide', !(my && RU && RU.can));
    bNext.parentElement.classList.toggle('hide', G.busy && !resolveStep);
    if (resolveStep) {
      bNext.firstChild.textContent = '계속';
      hintEl.textContent = `다음: ${stepLabel}`;
      return;
    }
    if (!G.busy) {
      bNext.firstChild.textContent = G.over ? '새 게임' : G.handNo === 0 ? '게임 시작' : '다음 핸드';
      hintEl.textContent = G.over === 'lose' ? '칩을 모두 잃어 아웃됐습니다. 게임 오버!'
        : G.over === 'win' ? '모든 상대를 아웃시켰습니다. 우승! 🏆'
        : G.handNo === 0 ? '버튼을 누르거나 Space 키로 시작하세요.' : '';
      return;
    }
    if (!my) { hintEl.textContent = me.folded ? '폴드했습니다. 핸드가 끝나길 기다리는 중…' : '상대 차례…'; return; }
    const toCall = RU.toCall;
    bFold.disabled = toCall === 0;
    bCall.firstChild.textContent = toCall === 0 ? '체크' : toCall >= me.chips ? `올인 콜 ${fmt(toCall)}` : `콜 ${fmt(toCall)}`;
    bRaise.classList.toggle('hide', !RU.can);
    if (RU.can) bRaise.firstChild.textContent = RU.amt >= RU.maxTo ? `올인 ${fmt(RU.amt)}` : `${G.currentBet === 0 ? '벳' : '레이즈'} ${fmt(RU.amt)}`;
    let t = `내 패: <b>${RU.hand}</b>`;
    if (hintOn) {
      t += ` · 승률 약 <b>${Math.round(RU.eq * 100)}%</b> (상대 레인지 추정 기준)`;
      if (toCall > 0) t += ` · 필요 승률(팟 오즈) <b>${Math.round(toCall / (potTotal() + toCall) * 100)}%</b>`;
    }
    hintEl.innerHTML = t;
  }

  function setRaise(v) {
    if (!RU) return;
    RU.amt = Math.max(RU.minTo, Math.min(RU.maxTo, Math.round(v) || 0));
    slider.value = RU.amt;
    num.step = unitBB ? 0.5 : 10;
    num.min = unitBB ? RU.minTo / BB : RU.minTo;
    num.max = unitBB ? RU.maxTo / BB : RU.maxTo;
    num.value = unitBB ? Math.round(RU.amt / BB * 10) / 10 : RU.amt;
    renderControls();
  }

  humanAction = () => new Promise(res => {
    const me = G.players[0];
    const toCall = Math.min(me.chips, Math.max(0, G.currentBet - me.bet));
    const maxTo = me.bet + me.chips;
    const others = G.players.some((q, j) => j !== 0 && canAct(q));
    const minTo = Math.min(G.currentBet + G.minRaise, maxTo);
    RU = {
      toCall, maxTo, minTo, amt: minTo, can: maxTo > G.currentBet && others,
      hand: handName(evalHand(me.cards.concat(G.board))),
    };
    RU.gto = gtoAdvice(RU.can, minTo);
    RU.eq = RU.gto.eq;
    slider.min = minTo; slider.max = maxTo;
    resolveHuman = res;
    setRaise(minTo);
  });

  function act(type) {
    if (!resolveHuman) return;
    const r = resolveHuman, amount = RU.amt;
    resolveHuman = null;
    r({ type, amount });
  }
  function start() { if (G.over) { location.reload(); return; } if (!G.busy) playHand().catch(e => { console.error(e); log('오류: ' + e.message); }); }

  bFold.onclick = () => act('fold');
  bCall.onclick = () => act('call');
  bRaise.onclick = () => act('raise');
  bNext.onclick = () => resolveStep ? step() : start();
  slider.oninput = () => setRaise(+slider.value);
  num.onchange = () => setRaise(unitBB ? +num.value * BB : +num.value);
  const presets = Array.from($('raiseRow').querySelectorAll('[data-f]'));
  function applyPreset(f) {
    if (!RU || !resolveHuman) return;
    if (f === 'min') setRaise(RU.minTo);
    else if (f === 'max') setRaise(RU.maxTo);
    else setRaise(G.currentBet + Math.round((potTotal() + RU.toCall) * +f / SB) * SB);
  }
  presets.forEach(b => { b.onclick = () => applyPreset(b.dataset.f); });
  // 클릭한 버튼·체크박스에 포커스가 남아 단축키를 가로채지 않도록
  document.addEventListener('click', e => { const b = e.target.closest('button,input[type=checkbox]'); if (b) b.blur(); });
  document.addEventListener('change', e => { if (e.target.tagName === 'SELECT') e.target.blur(); });
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t.tagName === 'INPUT' && t.type === 'number') { if (e.code === 'Enter' || e.code === 'Escape') t.blur(); return; }
    if (t.tagName === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const c = e.code;
    const done = () => e.preventDefault();
    if (c === 'KeyU') { optUnit.value = optUnit.value === 'bb' ? 'chip' : 'bb'; optUnit.onchange(); return done(); }
    if (c === 'KeyM') { optManual.checked = !optManual.checked; optManual.onchange(); return done(); }
    if (c === 'KeyH') { optHint.checked = !optHint.checked; optHint.onchange(); return done(); }
    if (resolveHuman) {
      const d = /^(Digit|Numpad)([1-6])$/.exec(c);
      if (c === 'KeyF') { if (!bFold.disabled) act('fold'); }
      else if (c === 'KeyC') act('call');
      else if (c === 'KeyR') { if (RU.can) act('raise'); }
      else if (d && RU.can) applyPreset(presets[+d[2] - 1].dataset.f);
      else if (RU.can && (c === 'ArrowUp' || c === 'ArrowRight')) setRaise(RU.amt + BB * (e.shiftKey ? 5 : 1));
      else if (RU.can && (c === 'ArrowDown' || c === 'ArrowLeft')) setRaise(RU.amt - BB * (e.shiftKey ? 5 : 1));
      else return;
      return done();
    }
    if (c === 'Space' || c === 'Enter' || c === 'NumpadEnter') {
      done();
      if (resolveStep) step(); else if (!G.busy) start();
    }
  });

  // 설정
  const optN = $('optN'), optSpeed = $('optSpeed'), optHint = $('optHint');
  optN.value = store.get('n', '5');
  optSpeed.value = store.get('speed', '1');
  optHint.checked = store.get('hint', '0') === '1';
  speed = +optSpeed.value || 1; hintOn = optHint.checked;
  optSpeed.onchange = () => { speed = +optSpeed.value; store.set('speed', optSpeed.value); };
  optHint.onchange = () => { hintOn = optHint.checked; store.set('hint', hintOn ? '1' : '0'); renderControls(); };
  optN.onchange = () => { store.set('n', optN.value); location.reload(); };
  $('bNew').onclick = () => { store.set('n', optN.value); location.reload(); };

  const optUnit = $('optUnit'), optManual = $('optManual');
  optUnit.value = store.get('unit', 'chip'); unitBB = optUnit.value === 'bb';
  optUnit.onchange = () => {
    unitBB = optUnit.value === 'bb'; store.set('unit', optUnit.value);
    if (RU && resolveHuman) setRaise(RU.amt);
    render();
  };
  optManual.checked = store.get('manual', '1') === '1'; manual = optManual.checked;
  optManual.onchange = () => { manual = optManual.checked; store.set('manual', manual ? '1' : '0'); if (!manual) step(); };
  $('bFull').onclick = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  };

  setupGame(Math.max(1, Math.min(5, +optN.value || 5)));
  render();
})();
