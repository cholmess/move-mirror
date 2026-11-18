# Daily training loop

The daily loop puts practice volume first. It has four parts. All of them live under `/daily` and `/review`, and the home page shows a one-button entry.

## 1. Today's session (`/daily`)

The session lasts about 20 minutes and has up to 30 items, in this order:

1. **Due reviews.** Spaced repetition puts positions from your own games before puzzles.
2. **New mistakes from your games**, up to 8. Each analysed costly decision becomes two cards:
   - **Refutation:** your move is already on the board, and you play the opponent's strongest reply. This trains the blunder check directly.
   - **Find the move:** find a better move than the one you played. Any engine-verified alternative is accepted (`verified_best` or `verified_acceptable`).
3. **New puzzles**, up to 15, from the Lichess database. They are close to your latest rating and weighted toward your recurrent patterns. Two thirds are framed as refutations.

Items have a clock: 30 s for refutations and 45 s for finding the move. The grade comes from what you did, not from a self-rating:

- **again:** wrong answer or solution revealed;
- **hard:** right, but over the time limit;
- **easy:** right, in under a third of the time limit;
- **good:** right, otherwise.

The scheduler is SM-2 style (`shared/daily/srs.js`). A missed card comes back the next day.

## 2. Post-game review (`/review`)

For each analysed game, the review shows the three costliest decisions. For each one, before showing the engine, it asks:

1. what you would play now (optional move on the board);
2. what happened in the game (didn't see the reply / saw it but misjudged / time trouble / no plan / other).

Then it shows your move, the opponent's punishment and the engine's line. The self-reports are the first direct evidence about *why* the mistakes happen. The pattern detector deliberately leaves the cause as "unknown".

"Fetch my latest games" imports the current month from the Chess.com and Lichess usernames in your player identity. Analysis then runs in the background.

## 3. Weekly progress

The headline metric is **pieces lost per 100 of your decisions** (`piece-loss` pattern), with a goal line at 1.5. It is shown with:

- your rating at the end of each week, as a separate chart (never a dual axis);
- training minutes, training days and accuracy;
- a breakdown by time control;
- the distribution of causes you reported in game reviews.

This view is descriptive only. It does not claim causation.

## 4. Explanations

**Checked summary.** "Why?" always shows a summary built from board facts computed with chess.js: what the reply captures or checks, forks, the material lost in the line, and the better move.

**AI wording.** When Anthropic credentials are available (`ANTHROPIC_API_KEY`, or an `ant auth login` profile), Claude (`claude-opus-5-5`, low effort, server-side refusal fallback) also words the explanation. The text is accepted only if every move and square it mentions belongs to the verified lines. Otherwise only the checked summary is shown.

- Accepted texts are cached in `data/explain/cache.json`.
- `MOVE_MIRROR_LLM=off` disables the AI wording.
- `MOVE_MIRROR_LLM_MODEL` overrides the model.

Explanations send only the FEN-derived facts (moves in SAN and piece names). Your username and game metadata are never sent.

## Puzzle bank

```bash
# Lichess puzzle DB, CC0, about 250 MB compressed
curl -LO https://database.lichess.org/lichess_db_puzzle.csv.zst
npm run puzzles:import -- --file lichess_db_puzzle.csv.zst   # needs zstd (brew install zstd)
```

The import:

- keeps legal, popular puzzles of up to 8 plies, rated 800–2000;
- keeps only themes that map to MoveMirror patterns (`shared/daily/puzzles.js`);
- caps each pattern group so the bank stays balanced.

The bank is written to `data/puzzles/bank.json`. `PUZZLE_BANK_FILE` can point to another bank. A `.csv` file also works, which is how tests use `fixtures/puzzles/sample.csv`.

## 15+10

Verified 15+10 games are now coaching eligible under their own policy, `rapid-15p10-coaching-v1`. 10+0 keeps `rapid-10m-coaching-v1`. Slower games give room to run the blunder check on every move. The weekly view splits metrics by control, so the two are never silently mixed. Transfer cohorts and their 10+0 detector are unchanged.

## Evidence boundaries

The daily domain stores its own state in `data/daily/` (`DAILY_DATA_DIR`). It never writes pattern mastery, practice exposures, transfer cohorts or the validation ledger. It reads the pattern analysis only.
