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

clicking on the minimap still doesn't correctly move the viewport such that the item we clicked on is in the centre of the screen. Right now it's in the bottom right corner of the screen.

pan speed 1x should be old 1.2x

the "road" from the HQ should not be obstructed by trees. There needs to be a clear path "out". clear the way from the HQ for units to get out. And make sure we show the road, sometimes the HQ sits "too deep" in the tiles.

When a unit gets hit it is "stunned", it should more like recoil away from the "hit" is what I am after.

The units do not react to enemies unless fired upon, it's weird.

different maps should have different amounts of starting units, bigger maps like Ashen Pass (less water terrain = more accessible) should have more units, try double on that map and scale to the others

the cannon/turret of a vehicle has to point the direction the vehicle is firing. realism. And when it swings really far in one direction, make it have to overcorrect a little bit. meaning the turret goes too far and needs to go back a little bit.

if a unit is "higher up" it has better visibility. And a unit cannot "see" through mountains. and their visibility through thick forrest is reduced too

produce HQ units faster

make the HQ red light illuminate an area more than it does now

be able to toggle between day and "night". night should still be pretty visible though (moonlight) just so we can actually see the damned thing. also strategically place "fireflies" here and there or think of another "natural" way to illuminate a bit of the scene

The circle around a unit (when not sleected) should be about 30% more visible

publish (for free) on github pages, do not create new branches, it should work from master. If this is not possible use netlify

units in "River Crossing" struggle to cross the river crossings... waypoints show correctly but the units don't move past certain point. Or ok they do but it's a struggle. something is off with the pathfinding.

the peewee explosion is a bit too "dramatic". make them shoot smaller "bullets" and faster with less damage too. think automatic rifle

when we pan "back" at some point we need to stop. right now the angle will warp. Just stop as if there was a wall behind us.
