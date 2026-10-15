# Tasks

System instruction: Work through every item in ## List below, top to bottom, executing each task in its own fresh subagent. Rules:

1. One task per subagent: spawn a single subagent for the current list item only, giving it the task text plus everything below as its brief.
2. Strictly sequential: wait for the subagent to finish (and its commit to land) before spawning the next one. Never run two task subagents in parallel.
3. Each subagent must: implement the task, add tests covering the change, and commit the result on completion.
4. Do not run Playwright (unit/integration tests only).
5. Each commit must include a writeup of what changed as an individual markdown in docs/tasks/ (e.g. `docs/tasks/17-sideways-tanks.md`). Record any important decisions in that writeup. Never append writeups to docs/tasks.md itself.
6. If a task changes architecture or introduces a complex feature, update the app documentation (README.md) in the same commit.
7. If a task is blocked or fails, stop the loop and report — do not skip ahead to the next item.
8. Keep track of learnings from each task. Then once done with all of the tasks summarize the learnings into a markdown document so that we do not repeat the same mistakes over and over (in `docs/learnings.md`).
9. Each subagent must add a changeset (`yarn changeset`) describing its change and include it in the same commit, so versions keep moving. See `.changeset/README.md` and the "Versioning" section in `docs/development.md` for the workflow.

Use sibling `nanolathe` repo for inspiration.

## List

When clicking somewhere for the unit to move, use the same round "circle" logic we use around the existing units now. The circle is "cutoff" by hilly terrain when  try to get a unit to go somewhere. But the regular outline around a unit shows always correct.

I should not see double circles when I select a unit. Again, just make the one circle thicker when I select a unit.

Units move slower when next to each other, so figure out if units should move away from each other so they move faster. Don't make them stuck.

The HQ should not "float" when on a hilly terrain. THe "foundations" need to go deep enough to show it being actually "set" in the ground.

Double the size of the maps.

The longer the projectile distance, the less accurate it'll be, especially with artillery. But other units too. Make it shoot "around" randomly. But not too far off target.

Turn on health by default.

Add smaller "infantry" like units. Fit with the theme of the game.

Make the tracks behind units a bit more visible.
