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

a unit wants to close in, but a forest that slows it down plus makes it harder for projectiles to get through. It should have a logic in pathfinding to try to go around if overall that were a better path.

2x default zoom speed and be able to zoom in closer still

Pan speed is tooo slow, 3x the current speed and increase the default

A peewee should have a faster firing (commander like) gun that does less damage but faster rate of fire. And close up it can lob "grenades"

At some point the units remain stationery even after engaging with enemy. Maybe the smallest unit, the peewee should work as a scout and look for enemy which then engages the rest.

Speed up the overall movement of uniots especially through rough terrain/woods

If we have a group of units selected, they try to move as a group rather than faster units cutting ahead.

Make the default height scale 1.5x

A dead unit still shows a "circle" around itself. Remove it immediately after exploding/dying.

If a group/unit is attacking the HQ, but it's attacked by enemy consistently, deal with the enemy first.

Show health over HQ (if toggled)

Make clicking on minimap more natural. Given the angle I am looking at, if I click at say HQ on minimap, the HQ should be in the center of my view after the click.

Do not show dead units on the minimap.
