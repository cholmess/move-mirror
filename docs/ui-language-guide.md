# UI language guide (MoveMirror v0.5.1)

## Voice

- Short sentences, active voice, one action per instruction.
- Explain advanced chess ideas in plain language before any abbreviation.
- Separate **what we see**, **possible explanation**, and **how much evidence we have**.
- Do not attribute psychological states or claim training caused real-game changes.

## Avoid in primary UI

- Raw enums (`verified_best`, `exposure_unknown`, …).
- Engine jargon (centipawns, FEN, UCI, bootstrap, cohort, detector, pipeline) except inside **Technical details**.
- “CCT” without prior explanation — prefer “checks, captures, and threats” (localized).

## Allowed tone examples

- “This move allows a forcing capture.”
- “The defense does not remove the threat.”
- “Practice more positions like this.”

## Discouraged

- “You made a terrible mistake.”
- “You failed again.”
- “Your calculation is bad.”

## Locales

- `es`, `en`, `de` with English fallback.
- Do not concatenate translated fragments; use interpolation and plurals.
