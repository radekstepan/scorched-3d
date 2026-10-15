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

Units are clipping through trees, let's make sure they are not clipping through the trunks.

The units on fire/smoking animation needs to be a bit more subtle with more smaller "puffs" here and there. Also sometimes the units turn completely black (charred I guess) - don't make it that severe.

Make the destruction of the environment a bit less severe. And make the brown blotches of ground blown up less severe and less "poop colored"

The projectile firing looks great, make it look even more amazing an awesome. I like that you can see the flash against the units. Do the same against environment and when there is an explosion make it look even more realisting and AAA RTS like.

The physics of some of the units, give them little wheels, legs should realistically move, the turrets should move slower I think.

Add explosion of units when they exhaust their health. Make it look epic.
