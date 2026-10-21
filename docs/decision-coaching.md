# Decision coaching: first intervention

The current personal-practice flow selects positions from the player's recurrent errors, but previously showed a generic rule before the move and engine feedback afterwards. It did not observe the player's expected response.

The new flow asks for a candidate on the board, then an expected opponent reply (or explicitly no reply found), before submitting either for evaluation. Guided training keeps its existing multi-decision continuation, retry and unseen-position holdout. Holdouts do not collect predictions or expose the topic.

On an unsuccessful candidate, a proposed legal response is evaluated from the opponent-to-move position by the existing local engine. Any verified best or acceptable reply is accepted; equality to the principal variation is not required. Failed prediction verification preserves the verified move result but prevents a causal hypothesis. At most one additional local engine evaluation is made per unsuccessful submission with a prediction; no LLM or paid API is introduced.

The intervention is selected from observable evidence:

- No response proposed: practise searching for replies; no causal claim.
- Proposed reply loses value compared with strong defence: compare replies.
- Proposed reply is strong but the candidate loses value: examine consequences and evaluation, as a hypothesis.
- Verification unavailable: explain the uncertainty.
- Candidate is valid: continue and test whether the approach holds.

The board can display the candidate position, the engine response, and the verified reference move. The observation, predicted SAN, engine provenance and working hypothesis are stored with the attempt. Recent unassisted first-decision observations inform the next guided prompt. These observations do not themselves change mastery or establish a cognitive diagnosis.

## Evidence and limitations

The checked-in historical review (`data/fase-2/review_output/review_summary.json`) includes allowed forcing responses across discovery and validation games. That supports investigating response anticipation, not asserting that the player has an attention deficit. Current per-user pattern analysis remains the source of practice positions; no frozen example is presented as a new diagnosis.

This is the first implemented intervention, not the full high-level coach. It does not yet collect a calculated multi-ply line or the player's resulting evaluation, generate position-specific strategic explanations, select pedagogical contrast pairs, or establish which teaching intervention produces better transfer. Historical hints/repeated positions can bias observations. The existing holdout and transfer machinery remains responsible for independent evidence; one good exercise never proves real-game improvement.

The next vertical slice is documented in `docs/personal-pedagogy.md`. It adds the player's intended plan and resulting evaluation, a bounded evidence packet across personal games, an optional structured LLM synthesis, persistent hypotheses, explicit alternatives, and a blind holdout update. The LLM is opt-in and never runs during import, engine analysis, or automated tests.

## Validation

Focused unit/service tests cover alternative strong replies, missing provenance, unavailable verification, legal-move validation before evaluation, persistence across restart and duplicate submission. Browser fixtures test that predictions precede feedback, reload, mobile layout and the blind holdout. Browser fixtures are simulated engine results, not chess-quality validation. Use `playwright.decision.config.ts` for web-only tests with all coaching requests mocked; no production data or engine server is needed.
