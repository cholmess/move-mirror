# Personal pedagogy vertical slice

## Product behavior

Guided personal practice now starts from a recurrent pattern found across the player's own games. Before any engine result or explanation, the player chooses a move, predicts the opponent's most demanding response, records the intended plan and expected evaluation, and declares decision confidence. The server validates and timestamps this snapshot before invoking the engine. The stored answer is immutable, so later feedback cannot contaminate the observation with hindsight.

The server builds a bounded evidence packet containing the current decision, the predicted reply, verified engine reply/reference, aggregate recurrence, up to two similar errors, and up to two comparable non-errors when available. The pedagogical model may synthesize a working hypothesis, alternatives, a contrast explanation, and the next discriminating test. It cannot add moves or variations to the contract. Every chess-specific teaching claim must cite an evidence ID from the packet.

Hypotheses are stored independently from prose with category, alternatives, confidence, status, intervention, and observations. The first reflection always creates a low-confidence, tentative hypothesis. A guided probe can adjust confidence when it reproduces the primary signature or a named alternative. An unseen holdout measures skill transfer but does not by itself identify the cognitive cause. Only later real-game evidence can mark a cause supported. Holdout responses omit the diagnosis, evidence summary, and hypothesis.

## Hypothesis probes

When a tentative hypothesis already exists, a new session no longer orders every guided position only by exposure and centipawn loss. The deterministic probe planner assigns distinct, still-reserved guided positions to the primary hypothesis and up to two named alternatives. It scores only observable engine-derived features: novelty, verified reply, forcing reply, verified line length, loss severity, closed structure, and endgame context. The reserved holdout is never reordered or labelled by this planner.

Each guided DTO explains the target cause, the alternatives being contrasted, the observable reasons for selection, and whether the current interaction can measure that cause directly or only partially. Reply search, candidate comparison, and consequence evaluation currently have direct interaction signatures. Calculation depth, concept recognition, and strategic planning remain partial until the product captures a calculated line or another cause-specific observation.

After a guided decision, the stored intervention is mapped back to an observable category. Matching the primary category supports the working hypothesis; matching a named alternative contradicts it; a successful move or an unmeasurable signature is inconclusive. Holdout success/failure remains skill-transfer evidence and is no longer treated as proof of a cognitive cause.

## P2: later real-game challenge

The latest hypothesis for a pattern can now be challenged by newly analyzed 10+0 games, but only after a directly measurable guided probe and its blind holdout. The holdout timestamp is the preregistered cutoff: a game must start strictly later, have exact timing, use an unexposed position, remain coaching-eligible, and contain verified engine provenance. At most one observation per game enters the causal channel, preventing a single game with several errors from dominating confidence.

The rule-based matcher covers only the three causes that the current interaction can observe directly: reply search, candidate comparison, and consequence evaluation. A record supports the primary hypothesis only when its observable signature distinguishes it from the named alternatives; ambiguous signatures are stored as inconclusive. Strategic planning, concept recognition, and calculation depth remain pending until the product captures a cause-specific signal rather than inferring intent from PGN alone.

One later game never confirms a cause. A hypothesis becomes provisionally supported only with a direct supporting probe and the same discriminating signature in at least two distinct later games. Two contradictions favor a named alternative and mark the hypothesis contradicted. The real-game channel is rebuilt from the current valid corpus, so deleting, reclassifying, or excluding a source game withdraws its evidence. The UI shows the gate and counts instead of presenting a hidden confidence score as fact.

## Cost and failure controls

LLM use is disabled by default. Set all of the following to enable the OpenAI adapter:

```dotenv
COACH_LLM_ENABLED=true
COACH_LLM_MODEL=<model-with-structured-outputs>
OPENAI_API_KEY=<secret>
```

The API key remains server-side. The reasoning snapshot is captured with the move, but a provider call happens only after engine feedback when the player explicitly presses the pedagogical analysis button. Imports, Stockfish analysis, page loads, and move submissions never trigger the LLM. Repository game IDs are removed from the provider payload; the local result retains the source mapping. Each attempt accepts one immutable pre-feedback answer and one generation. Concurrent identical submissions share the same promise; reloads return the stored result. There are no automatic provider retries. A provider error or invalid schema produces a stored rule-based fallback, preserving the player's answer and avoiding another charge.

The stored metadata contains provider, model, prompt version, latency, and reported token use. It does not store a secret or hidden reasoning trace.

## Current boundary

This slice creates a grounded hypothesis, orders explicit probes, and challenges directly observable causes against later real games. It does not let the model invent arbitrary positions or generate engine lines. The selectors are transparent heuristics over verified personal positions, not learned causal discovery. Real-game recurrence alone cannot prove a cognitive cause: the temporal gate, discriminating probe, blind holdout, distinct-game threshold, and explicit alternatives are all required before the product uses the word supported.

All tests use a fake provider. Do not enable the real adapter in test or CI environments.
