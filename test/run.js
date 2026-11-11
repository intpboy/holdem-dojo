// 브라우저 없이 게임 로직을 검증한다:  node test/run.js
// js/ui.js를 뺀 나머지 스크립트를 한 스코프에 올려서, 봇끼리 게임을 끝까지 돌려 본다.
'use strict';
const fs = require('fs');
const path = require('path');

const src = ['cards.js', 'engine.js', 'ai.js']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))
  .join('\n');

const tests = `
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const C = s => s.split(' ').map(x => {
  const r = RANKS.indexOf(x.slice(0, -1)), su = 'shdc'.indexOf(x.slice(-1));
  assert(r >= 0 && su >= 0, 'bad card ' + x);
  return r * 4 + su;
});

// 1) 족보 판정
const name = s => handName(evalHand(C(s)));
const cases = [
  ['As Ks Qs Js 10s 2d 3c', '로열 플러시'],
  ['As 2s 3s 4s 5s Kd Kc', '5 하이 스트레이트 플러시'],
  ['As Ad Ah Ac 5s Kd Kc', 'A 포카드'],
  ['As Ad Ah Kc 5s Kd 5c', '풀하우스'],
  ['As Ad Ah Kc Ks Kd 5c', '풀하우스'],
  ['As 9s 3s 4s 7s Kd Kc', '플러시'],
  ['As 2d 3s 4c 5s Kd Kc', '5 하이 스트레이트'],
  ['9s 10d Js Qc Ks Kd Ac', 'A 하이 스트레이트'],
  ['9s 9d 9h Qc 2s Kd Ac', '9 트리플'],
  ['9s 9d 2h Qc 2s Kd Kc', '투페어'],
  ['9s 9d 3h Qc 2s Kd Ac', '9 원페어'],
  ['9s 7d 3h Qc 2s Kd Ac', 'A 하이'],
];
for (const [cards, want] of cases) assert(name(cards) === want, cards + ' → ' + name(cards) + ' (기대: ' + want + ')');
assert(evalHand(C('9s 9d 2h Qc 2s Kd Kc')) > evalHand(C('9s 9d 2h Qc 2s Kd Jc')), '투페어 비교');
assert(evalHand(C('As Ad 2h Qc 7s Kd 3c')) > evalHand(C('As Ad 2h Jc 7s Kd 3c')), '키커 비교');
assert(evalHand(C('As Kd 2h 2c 7s 7d 3c')) === evalHand(C('Ah Kc 2h 2c 7s 7d 3c')), '동점');
console.log('족보 판정 OK (' + (cases.length + 3) + '건)');

// 2) 특정 상황에서의 봇 전략
function scene(board, hand, bet) {
  setupGame(1);
  const P = G.players;
  G.board = C(board); G.street = G.board.length === 5 ? 'river' : 'flop';
  G.rng = P.map(() => new Float64Array(NC).fill(1)); streetCache(); G.lastAggr = 0;
  P[1].cards = C(hand); P[0].cards = [0, 5];
  P.forEach(p => { p.total = 200; p.chips = 1800; p.bet = 0; p.folded = false; });
  G.currentBet = bet;
  if (bet) { P[0].bet = bet; P[0].total += bet; P[0].chips -= bet; }
  return postflopPolicy(1, P[1]);
}
assert(scene('As Ks Qs 2d 7c', 'Js 10s', 150).raise > 0.9, '리버 넛으로 벳을 받으면 레이즈해야 함');
assert(scene('As Ks Qs 2d 7c', 'Js 10s', 0).raise > 0.9, '리버 넛으로 체크를 받으면 벳해야 함');
assert(scene('Kd 8s 3c', '8d 8c', 200).raise > 0.7, '플랍 셋은 대부분 레이즈해야 함');
assert(scene('Kd 8s 3c 5h 2d', '7s 6c', 200).fold > 0.8, '리버 에어는 벳에 폴드해야 함');
console.log('상황별 전략 OK');

// 3) 봇끼리 끝까지 돌리기: 칩 합계 보존, 게임 종료, 조언 패널 값 검증
return (async () => {
  let advice = 0;
  humanAction = async () => {
    const me = G.players[0], maxTo = me.bet + me.chips;
    const g = gtoAdvice(true, Math.min(G.currentBet + G.minRaise, maxTo));
    assert(Math.abs(g.fold + g.call + g.raise - 1) < 1e-6, '빈도 합이 1이 아님: ' + JSON.stringify(g));
    assert(g.eq >= 0 && g.eq <= 1 && g.size > 0, '조언 값 이상: ' + JSON.stringify(g));
    advice++;
    return botAction(0);
  };
  for (const n of [1, 3, 5]) {
    let hands = 0;
    const games = n === 1 ? 10 : 4;
    for (let g = 0; g < games; g++) {
      setupGame(n);
      let h = 0;
      while (!G.over) {
        await playHand(); h++;
        assert(h < 5000, '게임이 끝나지 않음');
        const P = G.players, sum = P.reduce((s, p) => s + p.chips, 0);
        assert(sum === START * P.length, '칩 합계 불일치: ' + sum);
        assert(!P.some(p => p.chips < 0 || p.total !== 0 || (p.out && p.chips !== 0)), '플레이어 상태 이상');
      }
      const left = G.players.filter(p => !p.out).length;
      assert(G.over === 'win' ? (left === 1 && !G.players[0].out) : G.players[0].out, '종료 상태 이상');
      hands += h;
    }
    console.log('상대 ' + n + '명: ' + games + '게임 / ' + hands + '핸드 OK');
  }
  console.log('조언 패널 검증 ' + advice + '회 OK');
})();
`;

new Function(src + tests)()
  .then(() => console.log('ALL OK'))
  .catch(e => { console.error(e); process.exit(1); });
