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

don't zoom in so close to fly through actual ground/water etc.

the red light on HQ should show circulating red light, like on a lighthouse, it's not radiating in and out, it's circling inside directing the cone of light in a particular angle that's moving.

Greenreach. At some point each army just creates a line and nobody moves. Very stationary, it shouldn't be like that. On Dust Plains that's how they all start.

Looking at the water, the very last tile by the edge has lighter color and there is a visible hard line separating the last tiles from the rest.

Can the reflection of a projectile flying against the ground match somewhat the actual projectile? Right now it's a circle.

Some fireflies look "stuck" in a tree and illuminte an area too much. I want gentle illumination of a small area fading away from all the fireflies.

On Dust Plains one of the HQ is set in the ground such that the driveway out is in a "pass" that's hard for units to climb out of. Make the building sit higher up to clear local terrain or adjust the terrain.

Add subtle fog here and there, white fog on a day map.
