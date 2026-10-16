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

put a limit on how far artillery can shoot up, this is ridiculous. also the cannon on it moves form straight to 90 degrees too quickly. give it some realism.

projectiles should "warp" with a more transparent "tail" as they fly through the air based on velocity and gravity

pan speed 1x should be old 0.75x

default Height scale should be 1x

panning is still not fixed, I am moving "off the map". put a bound on how far we can move in either dimension. there should be a virtual rectangle around the whole world.

the improved water looks great. When I switch it off I see these "blotches". is it "stand in water? because that "water" seems to be animated too. Also slow down the movement of the water and make it less high.

Clicking onto an area of the map still does not take me to that area with the item that's under the + being centered int he view. What I need is to be able to click on a minimap say where it shows the HQ and to be immediately transported there, preserving zoom level and viewing angle AND for the HQ to show in the middle of the screen.
