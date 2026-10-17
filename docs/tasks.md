# Tasks

System instruction: Work through every item in ## List below, top to bottom, executing each task in its own fresh subagent. Rules:

1. One task per subagent: spawn a single subagent for the current list item only, giving it the task text plus everything below as its brief.
2. Strictly sequential: wait for the subagent to finish (and its commit to land) before spawning the next one. Never run two task subagents in parallel.
3. Each subagent must: implement the task, add tests covering the change, and commit the result on completion.
4. Do not run Playwright (unit/integration tests only).
5. Each commit must include a writeup of what changed inside the changeset itself (see rule 9). Record any important decisions in that writeup. Do not create separate markdown files in docs/tasks/. Never append writeups to docs/tasks.md itself.
6. If a task changes architecture or introduces a complex feature, update the app documentation (README.md) in the same commit.
7. If a task is blocked or fails, stop the loop and report — do not skip ahead to the next item.
8. Keep track of learnings from each task. Then once done with all of the tasks summarize the learnings into a markdown document so that we do not repeat the same mistakes over and over (in `docs/learnings.md`).
9. Each subagent must add a changeset (`yarn changeset`) describing its change and include it in the same commit, so versions keep moving. The changeset body is the task writeup: summarize what changed and why, including any important decisions. See `.changeset/README.md` and the "Versioning" section in `docs/development.md` for the workflow.

Use sibling `nanolathe` repo for inspiration.

## List

The red HQ light needs to have wider cones, travel further and fade more gently into the distance but also onto the sides.

Make new units drive off the road leading from HQ and not block the entrance. THis is still not fixed from the last batch.

Fireflies need to move slightly faster.

Add an overlay we can toggle that would show in the minimap and on actual map the area each team considers "theirs". If an area is contested, fade the 2 factions colors. Same in an area that hasn't been around a unit in a long time. Make this performant.

When we manually move units somewhere, they stop all their behaviors like movememtn, attacking etc. Wrong. They should go where we ask them to do, while responding to any fire if attacked, but still moving to where we want them. And once they get to the destination, they continue with the SAME behavior as now of wayfinding, monitoring, attacking, defending etc.
