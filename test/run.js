// Checks the game logic without a browser:  node test/run.js
// Loads every script except js/ui.js into one scope and lets the bots play full games against each other.
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

// 1) Hand evaluation
const name = s => handName(evalHand(C(s)));
const cases = [
  ['As Ks Qs Js 10s 2d 3c', 'Royal flush'],
  ['As 2s 3s 4s 5s Kd Kc', '5-high straight flush'],
  ['As Ad Ah Ac 5s Kd Kc', 'Four As'],
  ['As Ad Ah Kc 5s Kd 5c', 'Full house'],
  ['As Ad Ah Kc Ks Kd 5c', 'Full house'],
  ['As 9s 3s 4s 7s Kd Kc', 'Flush'],
  ['As 2d 3s 4c 5s Kd Kc', '5-high straight'],
  ['9s 10d Js Qc Ks Kd Ac', 'A-high straight'],
  ['9s 9d 9h Qc 2s Kd Ac', 'Three 9s'],
  ['9s 9d 2h Qc 2s Kd Kc', 'Two pair'],
  ['9s 9d 3h Qc 2s Kd Ac', 'Pair of 9s'],
  ['9s 7d 3h Qc 2s Kd Ac', 'A high'],
];
for (const [cards, want] of cases) assert(name(cards) === want, cards + ' → ' + name(cards) + ' (expected: ' + want + ')');
assert(evalHand(C('9s 9d 2h Qc 2s Kd Kc')) > evalHand(C('9s 9d 2h Qc 2s Kd Jc')), 'two pair comparison');
assert(evalHand(C('As Ad 2h Qc 7s Kd 3c')) > evalHand(C('As Ad 2h Jc 7s Kd 3c')), 'kicker comparison');
assert(evalHand(C('As Kd 2h 2c 7s 7d 3c')) === evalHand(C('Ah Kc 2h 2c 7s 7d 3c')), 'tie');
console.log('hand evaluation OK (' + (cases.length + 3) + ' cases)');

// 2) Bot strategy in specific spots
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
assert(scene('As Ks Qs 2d 7c', 'Js 10s', 150).raise > 0.9, 'river nuts facing a bet should raise');
assert(scene('As Ks Qs 2d 7c', 'Js 10s', 0).raise > 0.9, 'river nuts checked to should bet');
assert(scene('Kd 8s 3c', '8d 8c', 200).raise > 0.7, 'a flopped set should mostly raise');
assert(scene('Kd 8s 3c 5h 2d', '7s 6c', 200).fold > 0.8, 'river air should fold to a bet');
console.log('spot strategy OK');

// 3) Full bot-vs-bot games: chips are conserved, games end, strategy panel values are sane
return (async () => {
  let advice = 0;
  humanAction = async () => {
    const me = G.players[0], maxTo = me.bet + me.chips;
    const g = gtoAdvice(true, Math.min(G.currentBet + G.minRaise, maxTo));
    assert(Math.abs(g.fold + g.call + g.raise - 1) < 1e-6, 'frequencies do not sum to 1: ' + JSON.stringify(g));
    assert(g.eq >= 0 && g.eq <= 1 && g.size > 0, 'bad advice values: ' + JSON.stringify(g));
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
        assert(h < 5000, 'game never ends');
        const P = G.players, sum = P.reduce((s, p) => s + p.chips, 0);
        assert(sum === START * P.length, 'chip total mismatch: ' + sum);
        assert(!P.some(p => p.chips < 0 || p.total !== 0 || (p.out && p.chips !== 0)), 'bad player state');
      }
      const left = G.players.filter(p => !p.out).length;
      assert(G.over === 'win' ? (left === 1 && !G.players[0].out) : G.players[0].out, 'bad end state');
      hands += h;
    }
    console.log(n + ' opponent(s): ' + games + ' games / ' + hands + ' hands OK');
  }
  console.log('strategy panel checked ' + advice + ' times OK');
})();
`;

new Function(src + tests)()
  .then(() => console.log('ALL OK'))
  .catch(e => { console.error(e); process.exit(1); });
