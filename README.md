# Holdem Dojo

A no-limit Texas Hold'em table you play alone, offline, against AI opponents. There is nothing to install and no server: open `index.html` in a browser and play.

## Run

```
double-click index.html
```

No build step, no external libraries, no network connection needed.

## Rules

- No-limit Texas Hold'em, blinds 10/20, 2,000 starting chips (100BB)
- 1 to 5 AI opponents, each with a different playing style
- Lose all your chips and you are out. If you bust, the game is over; knock out every opponent to win
- All-ins and side pots are settled correctly
- When a hand ends, every hand is revealed, including the folded ones

## Features

- **Step mode**: each AI action and each board card waits for a key press (turn it off for automatic play)
- **Tendency stats**: VPIP / PFR / AF for every player, shown on their name plate
- **Chips or BB**: switch how stacks, pots and bets are displayed
- **Strategy panel**: fold / call / raise frequencies and a suggested bet size on your turn
- **Equity hint**: your equity against the opponents' estimated ranges, and the pot odds
- The table scales to the window, with a fullscreen option

## Keyboard shortcuts

| Key | Action |
|---|---|
| `F` | Fold |
| `C` | Check / call |
| `R` | Bet / raise (at the selected amount) |
| `1` to `6` | Pick a size: min / ⅓ pot / ½ pot / ⅔ pot / pot / all-in |
| `↑` `↓` | Adjust the amount by 1BB (`Shift`: 5BB) |
| `Space` / `Enter` | Continue / next hand |
| `U` | Chips ↔ BB |
| `M` | Toggle step mode |
| `H` | Toggle the equity hint |

Shortcuts use physical key positions, so they work with any keyboard layout or input method.

## How the AI decides

The bots are not a trained model or a solver. They are poker theory written as rules.

- **Range tracking**: for every player the game keeps a range, the distribution of hands they plausibly hold given their actions so far, and narrows it with each action. Bots never look at an opponent's real cards; they only use these estimated ranges.
- **Preflop**: range widths are set per position and situation (open, limp, 3-bet, all-in), and the hand's rank decides the fold / call / raise frequencies.
- **Facing a bet**: a bot continues when the pot odds are right, or when the hand is inside the minimum defense frequency (MDF) share of its own range. It defends wider against players who bet often and tighter against players who rarely bet.
- **Betting**: big with near-nut hands and bluffs, medium with solid value, small with thin value. Bluff frequency is tied to the share of value hands and the bet size.
- **Personalities**: bots differ in tightness, aggression and bluff frequency.

### Limitations

- The numbers in the strategy panel and in the bots are approximations and can differ from solver output.
- Bluffs are chosen by hand strength only; blockers are not considered.
- Preflop hand ranking is a rough ordering based on the Chen formula.

## Fairness

- The 52-card deck is shuffled once at the start of each hand (Fisher–Yates) and dealt in order. Nothing changes the deck during a hand.
- No logic adjusts cards based on who is winning.
- Randomness comes from `Math.random()`.

## Project layout

```
index.html        page skeleton
css/style.css     styles
js/cards.js       shared constants, deck, hand evaluation
js/engine.js      game flow (dealing, betting rounds, showdown, side pots, eliminations)
js/ai.js          range tracking, bot strategy, strategy panel math
js/ui.js          rendering, buttons and shortcuts, settings
test/run.js       tests that run without a browser
```

The code is split into plain scripts rather than ES modules so the game still works when the file is opened by double-click. The scripts share the global scope.

## Tests

Only Node.js is required.

```
npm test
```

The tests cover hand evaluation, bot strategy in specific spots, and full bot-vs-bot games that check chips are conserved.
