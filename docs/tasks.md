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

The red HQ light needs to have wider cones, like 45 degrees each, and fade more gently into the distance but also onto the sides. RIght now you can clearly see a "line" of the angle.

Make new units drive off the road leading from HQ and not block the entrance. THis is still not fixed from the last batch. Multiple times not fixed.

are we animating areas that the user is not looking at? Can be simplified right? identify how to make maps like Ashen Pass more performant. We are at 29 fps now.

When units are close together you see this jitter. I assume it's them trying to not be close together, I hate the jitter though, is distracting.

Units in fog are (a bit) harder to see.

A unit can fire while moving, just not as fast.

A unit shooting another unit should try to "snap" (have a stickiness) rather than try attacking always a new unit. Maybe that's why we sometimes have a big group of enemies and they all are more stationary and not shooting much. Investigate if that's the case. We could even model a simplified model of units on a "grid" without all the nuances of their movement and see how likely they are to shoot or move etc. Make sure we haev great unit test coverage on this core functionality of the "ai"

The territory right now is flashing. Make it fade a bit more slowly and be a contiguous blob.

Sometimes the tanks and other units just turn 45 degrees. That's not how physics of a vehicle like a tank work. Make proper turns.
