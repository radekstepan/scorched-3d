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

Units on larger maps are genuinely lost. If a team discovers enemy, the other units know their last location. Look at how the AI is implemented in the nanolathe repo to fix this/improve this.

The fog should be slowly moving.

The fireflies look "flashing" at the moment. It should be gentle pulsating glow and all of them should reflect against the terrain and trees, not just those close to the trees.

The closeup zoom level is a bit too close. Back off a bit from max zoom. Right now what happens is we get too close and the view angle turns completely vertical. Stop that, keep the angle.

The red HQ light should not be showing the 2 red "cones", the cones is just a faded glow of light that reflects against the surrounding surfaces, is diffused and travels firther without a harsh border.

Make the projectiles reflecting against the surroundings a bit more subtle on night map and more sublte on day map.

On Dust Plains we fixed the HQ position such that it's at a high enough elevation. See if we can place the HQs further inland to not have to build a little "hill" for it.
