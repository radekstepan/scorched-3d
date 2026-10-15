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

the hq should have a red flashing light on the top front of the building by the entrance, it should be a little detail to tell it's a "working" building. Make it illuminate the area a little bit.

improve the water. Right now it looks "static" with rectangles just flowing in one direction, make it a ibt more random.

check for hot loops. If my cursor is not over an area I am getting 120fps, but around 70 when I hover the cursor over the UI.

Clicking on a minimap the view should jump to place the item in the center of the view that I just clicked at, given the angle and zoom level.

Increase zoom speed by 2x by default. And all the current defaults are 1x on the slider (remap them)

the units that come out of the HQ should be random, but "stronger" units should take more time to make.

If a tank is being shelled it shouldn't just stay there, it should inbestigate where the firing is coming from.
