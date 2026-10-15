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

The projectiles streaking across the ground should show a smaller "highlight" circle on the ground. Right now it's a bit too much.

The icons for units when selected are ugly. Make them a 3D render of the actual units of from the side and somewhat from above. Cache these on load.

The factories we generate should look a bit more factory like and NOT be placed on high mountains or in the water.

Remove the long text in the "Units" section and remove everything but the (live) count of units starting with commander and ending with hammer.

Make the unit ring less visible and more subtle. When you select a unit, just make the unit's ring more visible.

Make the tracks that a unit leaves be actual 2 tracks in case of tanks and little lines that have gaps in them in case of commander. Basically match the footprint of the unit.

Something is off with the AI, it should be more real like and they should be tryign to fight each other and decice strategically when to engage whom and whom to pursue and if to wait for others etc.
