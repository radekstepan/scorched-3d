---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

AI hot-loop sweep with no visual or gameplay change: the hunt sweep spotted every enemy pair twice per tick (once to share sightings team-wide, once to acquire on them), and the recent intel/footwork work multiplied the per-tick scans. Sight verdicts now memoize per sweep snapshot (a repeat ask replays instead of re-marching the terrain), tree counting stops at the penalty saturation instead of walking the whole forest, squad focus resolves once per team instead of once per hull, the gun-target tally builds once per pick instead of rescanning pending aims per candidate, and the odds/spacing/separation/intel gates compare squared distances instead of paying `hypot` roots. Measured on scripted skirmishes: the searching sweep drops ~36% per tick with ~37% fewer terrain probes, engaged brawls hold identical speed.

## Task writeup

# AI hot-loop sweep

The recent AI commits (shared team intel, orbit-strafe footwork, scout
recon) made the battlefield smarter and the tick slower. Benchmarking a
scripted 6v6 on this machine showed the hunt sweep burning most of its
time re-proving what it already knew: every sweep asked `canSpot` for
each ordered enemy pair twice — once in the sight-sharing pass, once in
the per-hull acquisition pass — and each ask marched the terrain at
8-unit steps plus a full 250-tree scan. Fort spotting doubled the same
way (share pass + assault pass), and the HQ provider rebuilt its target
list per hull per tick.

## What changed (all behavior-preserving)

- **Per-sweep spot cache** (`visibility.ts` `SpotCache`, wired in the
  renderer's sweep): repeat asks for identical inputs (same gate,
  endpoints, eye heights, surface, tree snapshot) replay the stored
  verdict. Anything else — moved hulls, different gates, swapped
  snapshots — recomputes from scratch, so the cache never changes
  admission. The sharing pass only stores verdicts for observers the
  acquisition pass will actually ask about again, keeping engaged
  steady-state overhead at zero.
- **Capped tree counting** (`combat.ts` `countTreesOnSegment`): the
  forest penalty saturates, so counting stops at saturation instead of
  walking the rest of the wood — and never allocates the fid list. Used
  by sight lines, the sidestep seat evaluator, and orbit-strafe lane
  checks (candidates cap at the seat's own lane: anything past it is
  vetoed either way).
- **Focus/forts/snapshot sharing in the sweep** (`movement.ts`): squad
  focus resolves once per team per tick, fort keys/roof heights resolve
  once per sweep, the HQ provider is called once per sweep, and the
  sweep hands its teams/alive/health snapshot to the drive instead of
  the drive rebuilding the same arrays.
- **Gun-target tally** (`strategy.ts` `pickStrategicTarget`): pending
  aims tally once per pick (was: rescanned per candidate), and the
  option now takes any iterable so the scheduler passes the live
  pending map without copying it per gun per tick.
- **Squared distance gates** in the per-tick loops (`battleOdds`,
  `nearestIntel`, intel confirm/teammate checks, `spacingScale`,
  separation, sidestep crowd + stand-off, leash gates): same decisions,
  no roots. Exactness edges preserved (zero leash still admits a
  coincident candidate, non-positive radii gate nothing).

## Decisions and pitfalls

- **Nanolathe parallel (adapted):** the sibling repo's sensor candidate
  index narrows pairs before the exact predicate without changing
  admission. Same discipline here at our scale: enumeration stays
  exhaustive (rosters are tiny), the exact spot predicate stays
  authoritative, and memoization only skips recomputation within one
  immutable snapshot.
- **Measure, then cut:** an early version of this change "hoisted" the
  tree-test invariants into a shared per-tree helper — micro-benchmarks
  showed it made every scan 2.5x *slower* (call + scratch indirection
  on the hottest reject path). It was reverted to inline loops (the
  three probes intentionally duplicate the tests now, with a comment
  saying why), and every number above comes from bundled-node A/B runs,
  not the vitest harness (whose JIT noise measured a phantom +8%).
- **Equivalence proof:** 17 new core guards in `hotloop.test.ts`
  (capped-count agreement, cache replay/recompute/rebind via surface
  probe counts, focus-hint and tally equivalence, open-lane hold,
  capped-lane mirrors, squared-gate edges) plus 3 renderer sweep tests
  (provider called once per sweep, snapshot contents). Full suites
  green: core 635/635, web 738/739 with the only failure the
  pre-existing unrelated `deployPages` branch-name mismatch (fails
  identically on the untouched tree).
