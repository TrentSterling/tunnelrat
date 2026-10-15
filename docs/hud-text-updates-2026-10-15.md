# HUD text update validation

Baseline: `d4f26268619bd964bf881ce1ebdf7bbaabe1ac08` (current public main).

The game calls the shield and energy setters every animation frame. Even when
their displayed values are unchanged, assigning `textContent` replaces their
text nodes. The escape timer repeats the same work between displayed seconds.
`setTextIfChanged` skips those three identical text assignments. Formatting,
bar animation, timer visibility/pulse, simulation, content and controls are unchanged.

Matched runs used the same seeded mine, 1280x720 viewport, Chrome 155.0.8059.41,
ANGLE D3D11 on an NVIDIA RTX 5070 Ti, and four 4-second stages. Browser keyboard
input held Space during firing. Escape used the existing debug reactor setup.
These are scripted, real-browser measurements, not human play or simulated frames.
Audio was muted; no listening or audio quality conclusion was made.

| Stage | Text replacements before | After | Browser frame p95 before / after |
| --- | ---: | ---: | ---: |
| Stationary shield/energy | 480 | 0 | 16.8 / 16.8 ms |
| Firing shield/energy | 480 | 47 | 16.8 / 16.8 ms |
| Recharge shield/energy | 482 | 15 | 16.8 / 16.8 ms |
| Escape shield/energy | 482 | 0 | 16.8 / 16.8 ms |
| Escape timer | 241 | 5 | same escape stage |

Natural frame scheduling and firing cadence vary slightly; stage frames were
239-241 and the firing end-energy values were not identical. No FPS gain or
general CPU/GPU speedup is claimed. All runs retained the 12-enemy population.
The concrete gain is removal of redundant DOM text replacements.

The candidate passed 2,064 complete DOM comparisons against the historical HUD:
quarter-step shield/energy values with maxima of 100 and 150, negative/overfull
values, rounded display boundaries, minute/second boundaries, hidden timer
transitions, pulse thresholds and other HUD setters. A further 240 repeated
unchanged shield/energy/timer updates produced zero text mutations.

Reproduce with `node tools/hud-profile.mjs URL OUTPUT HISTORICAL_HUD_JS`.
Set `HEADED=1` for an ordinary desktop window. The output contains full-page
screenshots, a canvas-only WebM, browser/GPU identity, raw frame intervals, DOM
mutation counts and Chromium performance counters. The WebM excludes the DOM
HUD; use the full-page screenshots for HUD comparison. Timing instrumentation
and recording are identical between compared runs and add measurement overhead.

Before merging, run this against an archive of the exact PR commit, plus
`node tools/smoketest.mjs URL`, `node tools/movetest.mjs URL` and
`node --test tests/about-contract.cjs`. The mission smoke uses debug navigation;
the movement test uses synthetic keyboard events. Neither is a human playthrough.

Rollback: revert the eventual merge commit in a new commit, restoring the runtime
from the baseline above. The baseline bundle and media are retained separately.
