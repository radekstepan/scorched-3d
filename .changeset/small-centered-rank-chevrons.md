---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Smaller unit rank chevrons, centered above the health bar

## Task writeup

The veterancy badge was chunky and sat off-balance: each ∧ spanned ~11.7u (nearly half the 24u health bar), stripe thickness was half the bar height, every chevron was anchored by its bottom edge, and rank pips stacked upward from the anchor — so the emblem's visual center climbed with seniority and the ace stack towered ~14u over a 3.5u-tall bar.

Chevrons are now smaller (stripe length 7.4→4.6, thickness 1.7→1.0, stack step 3.4→2.0 — the ∧ spans ~7.2u, under a third of the bar width) and properly centered: each chevron's stripes sit at ±(L·√2/4) about the local origin so the bars meet exactly at the apex, and the visible pips are rebalanced about the anchor every tick (`(r − (rank−1)/2) · STACK`), so ranks 1–3 all read as one emblem centered on the bar. The promotion flourish centers its pips the same way. Badge lift, gold color, and render order are unchanged; even the centered ace stack clears the bar top by ~1.9u.

Decisions worth recording:

- Stripe offsets are derived from the stripe length instead of hardcoded (±2.5), so future size tweaks cannot break the apex joint — the old constant only happened to almost match 7.4·√2/4.
- Pip centering is dynamic per rank rather than centering a fixed 3-stack on the anchor: a fixed center would leave a lone rank-1 pip floating a full stack step above the bar.
- Nanolathe inspiration: the TA retail spec keeps rank display subordinate to the health bar (a "Veteran" word in the HUD panel only, no in-world pips), which supports shrinking the in-world emblem to a fraction of the bar rather than growing it.
