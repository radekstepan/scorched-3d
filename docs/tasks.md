# Tasks

System instruction: Work through every item in ## List below, top to bottom, executing each task in its own fresh subagent. Rules:

1. One task per subagent: spawn a single subagent for the current list item only, giving it the task text plus everything below as its brief.
2. Strictly sequential: wait for the subagent to finish (and its commit to land) before spawning the next one. Never run two task subagents in parallel.
3. Each subagent must: implement the task, add tests covering the change, and commit the result on completion.
4. Do not run Playwright (unit/integration tests only).
5. Each commit must include a writeup of what changed in docs/tasks. Record any important decisions in that writeup.
6. If a task changes architecture or introduces a complex feature, update the app documentation (README.md) in the same commit.
7. If a task is blocked or fails, stop the loop and report — do not skip ahead to the next item.
8. Keep track of learnings from each task. Then once done with all of the tasks summarize the learnings into a markdown document so that we do not repeat the same mistakes over and over (in `docs/learnings.md`).
9. Each subagent must add a changeset (`yarn changeset`) describing its change and include it in the same commit, so versions keep moving. See `.changeset/README.md` and the "Versioning" section in `docs/development.md` for the workflow.

Use sibling `nanolathe` repo for inspiration.

## List

sometimes the models clip into terrain as they move to a higher/lower elevation. They should not be moving "flat", but based on a terrain up or down. Some areas will be too steep for them. Make sure this is considered in the pathfinding.

Sometimes 2 units next to each other appear stuck and won't move. Is it because they are in a brown "hole" caused by explosions?

Make sure the physics of a cannon barel shooting a projectile "makes sense".

The damage to terrain seems "odd". Shouldn't there be collateal damage where the trees are on fire, smouldering, partially destroyed, on their side etc?

When I select a unit somehow it's in this "brown mud" which I am not suer what is, but it's hard to see the "outline" when I click on the unit.
