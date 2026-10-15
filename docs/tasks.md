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

the cannon of a tank sometimes clips through a tree trunk. this shouldn't happen. Make sure we implement collisions correctly. If it simplifies things, you can consider a bounding box around a vehicle and that's it's full "size" for collission purposes

Remote the "Patrolling TA ..." text under "Units"

vehicle tracks should be a bit more visible

We should have even "teams" starting across the map and hunting each other down. Make sure we can tell team colors. Really iron out the AI logic of the units.

See if we can have a bit more camo detail on the units.

When we select a unit, the circle and arrow don't have to be "flashing" or moving, static is fine. And when we do select a unit, show at the bottom a little list of boxes with a little icon (or rendering) of said unit and how many we have selected in the corner. I assume these would be pre-rendered once and reused. There should be a colored border (at the top?) matching the "color" of the unit that matches what we show in the Units box.

Add HQ building at opposing end of the map where the teams start and periodically open the "door" sliding up to it (a hall) and a new unit will drive out to join the fray. Enemy units can destroy the HQ, yes. Maybe reduce how far different units can shoot or they'll lob the HQ half way across the map.
