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

the HQ light should not be on a platform with a rod. It should just be a half 3d circle with a light rotating inside it

Current 1.5x pan speed should be the new 1x pan speed.

Current 2x height scale should be the new 1x height scale.

I don't like while panning how if I get to a corner the view suddenly flips backwards or something. No, stop the movemembnt if we can't move forward. Retain the angle we are looking at the world.

The waves are still nore realistic. I see shallow and deep water waves, they follow patterns too much still. Looka t what we are doing with the world itself, give it some variation.

Still when I keep moving cursor over the world the fps dips to 80, when I stop moving it's 120. Clearly there is an optimization to be had.

Clicking onto an area of the map still does not take me to that area with the item that's under the + being centered int he view.

After the last AI update, a bunch of units are "waiting" in their area and nothing is happening. It should be an active battlefield with recon and engagement. Only when I move one opponent closer do they start engaging. But when the one opponent is under attack and finds opposing HQ, the other units on its side do nothing.
