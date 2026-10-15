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

obstructed unit shold show its outline, and sligh transparent fill of where it is behind trees and such, NOT a rectangle around it.

Waypoints is wrong, I want to see the path the unit wants to take, not just waypoints.

When a unit is hit it should be slightly "stunned" and maybe it jerks back a bit away from the direction of the hit.

The subtle shake of a vehicle is distracting. The idea was to show the vehicle is "running" make it more believable. Subtle.

When a unit "dies" it should obviously expolode, then the charred hush should sink into the grand. Husk, not the full model. Make it look "exploded". Smoulder a bit. With tanks the turret should explode away and the body explode too. Similar with the other units. THink about how they should explode when they die.

Vehicles should leave (disappearing) tricks behind themselves as they move around. Make it subtle.

When I zoom in using a scrollwheel it should naturally zoom onto the area under the cursor. Right now it does something unintuitive.

Check for "hot loops" in the app and try to optimize them.

AS projectors fly through the air, they should illuminate objects they are near to (trees, ground etc.)

The turret itself should recoil a bit when shooting

If a vehicle gets hit from a direction, it's more likely to move that way to pursue and fight back. If the attacking vehicle moves far away though, it should resume its patrolling. Try to be logical about this and implement an AAA RTS AI logic here.
