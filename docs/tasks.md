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

Follow battle should continue working if I zoom in/out or rotate.

Sound should be muted by default

Make the unit rank symbol smaller, centered properly above health bar

I didn't ask you to add "Factories" panel.

Sometimes units struggle to clar an obstacle and "jitter" back and forth. Investigate and fix. Maybe because unit is close to a rock? Trying to clear a hill?a

Be able to toggle a "pan" mode which locks the angle we viewing at and dragging a cursor across the page pans the screen instead just like arrow keys would.

Double clicking a particular unit will select all units of the same type and faction visible on the screen right now.

Remove the "Indexed filter toggle"

Why do the units in Unit Folio look different if Terrain is toggled on /off?

Default Commander in Unit Folio and remove the little arrow.

I have 17 units selected. They destroyed HQ. Back at their own HQ. They do this "dance" driving around. Looks odd. They should create an orderly formation and keep adding to it.

When enemy HQ is destroyed, stop producing units!

Use sounds from kenney_interface-sounds AND kenney_sci-fi-sounds from Downloads directory to completely replace sound effects in the game. Make sure to include the license.
