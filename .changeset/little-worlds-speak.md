---
"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Correct commander and peewee footfall direction during forward walking.

The procedural gait lifted a leg while its foot rotated backward relative to the hip, then planted it on the forward stroke. Both models face local +Z and their legs extend below the X-axis hip pivot, so positive rotation moves their feet aft. This reversed support/recovery pairing made advancing commanders and peewees appear to take backward steps. Switch the lift to the negative-cosine half-cycle so the airborne foot recovers toward the nose and the support foot sweeps aft.

Keep the distance-driven phase, antiphase hips, stride lengths, amplitude settling, hull movement and crowd steering unchanged. The existing core test's comment already described the correct planted leg at phase zero, but its assertions checked the opposite lift; update those expectations and the peewee assembly test. No architecture changes or README changes are needed. Nanolathe's walk preview separates script poses from presentation smoothing; this bug is the authored lift/rotation relationship itself, so interpolation or movement changes would conceal the cause.

Add six renderer regressions sampling two full strides on both actual walker assemblies at three world yaws. Track sole points through real Three.js transforms during forward hull travel, subtract that hull travel, and require every raised recovery sample to advance toward the nose and planted samples to sweep aft. All six fail with the original lift sign and pass with the correction. The focused renderer suites pass 77 tests; the core locomotion suite passes nine tests, and workspace typechecking passes. Existing start/stop and model/occlusion contracts remain covered. No Playwright was run.
