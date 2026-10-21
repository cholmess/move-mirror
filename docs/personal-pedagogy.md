# Personal pedagogy vertical slice

## Product behavior

Guided personal practice now starts from a recurrent pattern found across the player's own games. Before any explanation, the player chooses a move, predicts the opponent's most demanding response, and then explains both the intended plan and the expected evaluation of the resulting position.

The server builds a bounded evidence packet containing the current decision, the predicted reply, verified engine reply/reference, aggregate recurrence, up to two similar errors, and up to two comparable non-errors when available. The pedagogical model may synthesize a working hypothesis, alternatives, a contrast explanation, and the next discriminating test. It cannot add moves or variations to the contract. Every chess-specific teaching claim must cite an evidence ID from the packet.

Hypotheses are stored independently from prose with category, alternatives, confidence, status, intervention, and observations. The first reflection always creates a low-confidence, tentative hypothesis. Guided practice and an unseen holdout can adjust confidence, but cannot mark it supported. That requires later real-game evidence. Holdout responses omit the diagnosis, evidence summary, and hypothesis.

## Cost and failure controls

LLM use is disabled by default. Set all of the following to enable the OpenAI adapter:

```dotenv
COACH_LLM_ENABLED=true
COACH_LLM_MODEL=<model-with-structured-outputs>
OPENAI_API_KEY=<secret>
```

The API key remains server-side. A call happens only after the player writes a reflection and presses the analysis button. Imports, Stockfish analysis, page loads, and move submissions never trigger it. Repository game IDs are removed from the provider payload; the local result retains the source mapping. Each attempt accepts one immutable answer and one generation. Concurrent identical submissions share the same promise; reloads return the stored result. There are no automatic provider retries. A provider error or invalid schema produces a stored rule-based fallback, preserving the player's answer and avoiding another charge.

The stored metadata contains provider, model, prompt version, latency, and reported token use. It does not store a secret or hidden reasoning trace.

## Current boundary

This slice creates a grounded hypothesis and changes what the next exercise asks the player to test. It does not yet let the model select arbitrary new positions or generate engine lines. Comparable positions come from the existing verified pattern analysis. Real-game observations are already separated from exposed positions by the transfer pipeline, but automatic causal hypothesis updates from those games remain a later experiment: recurrence alone cannot prove a cognitive cause.

All tests use a fake provider. Do not enable the real adapter in test or CI environments.
