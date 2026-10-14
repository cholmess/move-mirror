# Personal pattern updates

MoveMirror now updates a personal, evidence-based training profile when games are imported or edited. It also resumes analysis on startup when Stockfish is available. The home page shows up to three recommended patterns; `/patterns` shows observations and supporting games; `/practice/:id` opens a playable position with optional teaching help. A practice position can be continued against the opponent.

## What the model currently is

This is a versioned rule-based detector and a small Beta-Binomial practice profile. It is not a retrained neural network and does not discover arbitrary motifs outside its catalog. Current observations cover piece losses, missed valuable captures, missed verified mates, costly moves followed by a principal check, and costly decisions in blocked centers or low-material contexts. The last two classify where an error happened, not why it happened. Cognitive causes remain unknown.

A recommendation requires errors in at least three distinct games and three distinct positions. Three supporting games are labelled limited evidence; six or more are moderate evidence. Those labels describe support, not a calibrated probability. Priority combines observed severity, independent practice performance, uncertainty and review timing. Templates provide a short goal and a hint appropriate to the pattern. Reference moves and acceptable alternatives are checked by the existing evaluator; a template hint is not an engine proof of a strategic plan.

## Data and analysis

- At most the latest 200 non-archived, completed, standard-start 10+0 games with verified player identity are selected.
- Games with eight or fewer plies or unresolved metadata conflicts are excluded.
- Every own decision is analyzed. Partial games contribute no pattern evidence or rate denominators.
- Analysis keys include game fingerprint, player color, detector version and engine/pipeline signature.
- Analysis resumes from verified decision checkpoints. Changes to game data or engine signature invalidate the relevant analysis.
- Analysis shards and profile metadata are written atomically under `data/patterns`; that directory is excluded from Git. A checkpoint writes only its game's shard rather than rewriting all analyzed positions.
- Removed games or changed player attribution revoke their exercise and practice evidence. Reads filter current eligibility immediately.
- Import updates are coalesced. Duplicate imports reuse verified analysis. Cancelled/interrupted analysis can resume.

The application does not alter frozen transfer cohorts, the legacy dose protocol or the static teaching bank.

## Practice and transfer

Before an answer, exercise responses contain the position, source and goal, not the solution. Explicit help marks an exercise as assisted. Repeated positions also count as assisted, and a completed submission is idempotent. Assisted attempts persist but do not increase independent practice estimates. Existing legacy practice histories are not retroactively treated as novel exposures by this new domain.

Descriptive recurrence comparisons require at least five games and thirty verified comparable decisions on each side of the first recorded exposure. Future games must start strictly after exposure and have exact timestamps; known positions exposed in this domain are excluded. Baseline games must be known to have finished or been imported before exposure. Comparisons do not claim causal improvement or rating gains. No sample-size rule by itself establishes statistical significance.

## Evaluator corrections

The existing pair evaluator searched the played move from a position after that move, mixing score perspectives and shifting the principal reply. It now runs both searches from the original decision position using `searchmoves` for the selected move. The evaluator pipeline is `eval-pipeline-v0.2.2`, invalidating previous cached evaluations. Existing stored legacy attempt classifications are preserved; this change does not retroactively re-evaluate their historical mastery or dose ledgers.

The HTTP evaluator now cancels on an aborted request or prematurely closed response, rather than the normal completion of the incoming request body.

## Validation

Unit/service tests cover legal evidence, recurrence, partial-game exclusion, cache reuse, engine changes, checkpoint recovery, unavailable engines, identity/control filtering and assisted practice. Playwright tests cover pattern cards, mobile width, real import → automatic analysis → new pattern → practice → retry → idempotent update, plus a real evaluator root/reply regression. The live tests require Stockfish and are explicitly skipped when unavailable.
