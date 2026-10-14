# Play-first practice

The primary experience is now playing chess, with help on demand. `/` offers mistakes from the player's games, an opponent from a position or a complete game, and closed-position practice. `/train` immediately accepts a legal board move. There is no compulsory reasoning form. `/coach` and `/train/guided` preserve the optional structured tools.

## Learning loop

- An existing evidence-based selector chooses a position from the player's games.
- A move is checked by the existing engine evaluator. Acceptable alternatives remain valid.
- Feedback can show the opponent's verified reply on the board, or demonstrate the reference move.
- The player may retry, move to another position, or continue that exact position against the opponent.
- Requested sparring hints return a legal move from engine analysis of the current position. This is a candidate, not a claim that it is the only valid move or a complete strategic explanation.
- Finished sparring reviews expose positions that can be replayed against the opponent.

## Evidence boundaries

Direct practice attempts persist and support exercise selection. They do not qualify the historical structured CCT intervention. Assisted attempts persist but do not increase independent mastery or completion. General closed-position sessions do not update the defensive weakness profile.

The new closed-center positions are general exercises. They are not diagnosed weaknesses of this player. The general opponent uses the engine's best quality-eligible candidate instead of secretly applying the defensive pressure policy. Full games do not guarantee a particular pawn structure or attack.

## Remaining product work

The existing personal exercise bank is still centered on the forcing-reply pattern. It does not yet cover every recurring strategic mistake. Strategic plan explanations, additional personal patterns and a calibrated opponent need actual teaching content and evidence. Engine suggestions alone do not provide those explanations. This change makes practice playable and removes compulsory data entry; it does not establish learning effectiveness.

## Verification

Use `npm run games:migrate` when setting up a fresh checkout; historical import integration tests require those generated local files. Run `npm test`, `npm run build`, `npm run i18n:check` and the play-first Playwright suite. Its live-engine test requires Stockfish; the UI tests use controlled API replies. `E2E_BROWSER_PATH` optionally selects an installed Chromium executable.
