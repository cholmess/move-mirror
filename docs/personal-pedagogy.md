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

## P3: adaptive curriculum

The training plan now turns the separated evidence channels into a transparent intervention decision. Every recurrent pattern receives one of five actions:

- `diagnose`: no blind generalization result exists yet, so the coach gathers discriminating evidence instead of asserting a cause.
- `reteach`: the latest blind holdout failed, so the coach changes the explanation and teaching approach before testing again.
- `revise_hypothesis`: later evidence contradicted the working cause. The strongest named alternative becomes a new tentative hypothesis linked to the contradicted parent; the old record remains immutable for audit.
- `bridge_transfer`: the skill generalized in holdout, but real-game transfer is pending or the descriptive recurrence rate did not fall. The intervention moves toward recognition under game-like conditions: before feedback, the guided screen hides the pattern evidence, hypothesis/probe labels, source-game link, hints, and solution reveal.
- `maintenance`: the skill generalized and the sufficiently powered descriptive comparison shows lower later recurrence. This schedules maintenance; it still does not claim the training caused the change.

The curriculum planner selects at most one primary item, one support item, and one maintenance item. Active learning outranks maintenance even when the maintained pattern had greater raw engine-loss severity. Existing review dates, active sessions, lesson retention, and owner-scoped persistence remain authoritative.

The decision and its evidence snapshot are stored on the practice session. When a hypothesis is contradicted, the next probe is planned against the new revision's category rather than silently continuing the rejected cause. This changes exercise selection behavior while preserving the complete hypothesis lineage.

## P4: personal lesson composer

Every new personal-practice session now persists a bounded lesson compiled from the selected curriculum action and the current verified corpus. The lesson contains the teaching method, working hypothesis when one exists, up to three examples from distinct personal games, at most one comparable personal non-error, the actual guided-position count, a reserved blind holdout, and explicit practice/generalization/transfer success channels.

The lesson DTO is spoiler-free by construction: it never contains FENs, played moves, engine references, or principal variations. Exact source games remain optional evidence links, while hints and reference moves continue through the existing assisted-feedback controls. A transfer-bridge lesson additionally hides evidence, hypothesis labels, source links, hints, and solution reveal until feedback.

The composer is fully functional without an LLM. If the player previously and explicitly requested a pedagogical reflection, its schema-validated, evidence-grounded teaching synthesis and spoiler-safe citation map are stored with the hypothesis and can be reused in the next lesson. Starting, resuming, or rendering a lesson never calls a provider. A contradicted hypothesis clears the old teaching explanation before compiling the alternative lesson, so refuted prose cannot silently survive a causal revision.

Lesson evidence is frozen on the session for audit and resume behavior. The independent holdout result is linked back to the lesson summary; the following plan is recalculated from the newly persisted evidence rather than mutating the completed lesson.

## P5: second real focus

P5 tests that the coach architecture is not a CCT-specific pipeline. Each catalog pattern now resolves to a versioned skill definition containing a stable skill ID, decision family, observable teaching objective, diagnostic categories, and an explicit `pattern:<id>` evidence scope. `closed-center-planning` is the first non-tactical second focus: it can be selected only when verified personal decisions show costly errors in at least three distinct games and positions with the existing blocked-center opportunity definition. Its rules fallback asks about the intended pawn break, the piece that must improve, and opposing counterplay rather than recycling the CCT explanation. This is evidence of a recurring context, not proof of a strategic cause.

The curriculum portfolio now contains one primary focus, at most one support focus, and at most one maintenance item. When more than one equally urgent active candidate is valid, support selection prefers a different decision family before a lower-ranked overlapping pattern. A more urgent intervention such as reteaching or hypothesis revision is never displaced for diversity. This prevents several equivalent variants of candidate/refutation work from occupying the entire visible plan while preserving pedagogical urgency.

Evidence never crosses skill boundaries. Lesson compilation rejects guided or holdout records from another pattern; session creation rejects a lesson whose pattern or evidence scope does not match the session. Hypotheses, independent holdout outcomes, learning domains, and real-game comparisons remain keyed by pattern. A result for blocked-center planning cannot raise or lower material-safety evidence, and a maintained CCT skill can coexist with a newly taught strategic focus.

This remains a transparent rules baseline, not learned ranking or causal diagnosis. P5 demonstrates extensibility and evidence isolation. It does not yet prove that the blocked-center detector captures the correct strategic concept, and it does not enable a lesson unless the player's real corpus passes the recurrence gates.

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

This slice creates a grounded hypothesis, orders explicit probes, challenges directly observable causes against later real games, adapts the next curriculum action, and compiles it into a personal lesson. It does not yet retrieve master-game examples or capture full calculated lines and time usage. It does not let the model invent arbitrary positions or generate engine lines. The selectors are transparent heuristics over verified personal positions, not learned causal discovery. Real-game recurrence alone cannot prove a cognitive cause: the temporal gate, discriminating probe, blind holdout, distinct-game threshold, and explicit alternatives are all required before the product uses the word supported.

All tests use a fake provider. Do not enable the real adapter in test or CI environments.
