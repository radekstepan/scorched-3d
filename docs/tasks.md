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

The red light on HQ, it looks like a red circle is on top of the light. Improve it, make sure it's moving inside, in the center, radiating out.

When a unit leaves the hq it needs to walk along the "tracks"/road from the HQ. Right now the units spawn at the end of the bridge. Commander is a bit too tall so maybe make the HQ taller.

the starting view of the map should naturally match the minimap. So if I go right on the minimap the view should pan right as well.

pan speed 1x should be old 0.3x

If I view the world from the top it's almost all brown. I don't get the brown. It's not clouds. Extra mud texture? But then fix it so it's applied on the tiles and doesn't keep changing based on which angle we look at.

When you make road outside of HQ so it's cleared out for leaving units, you don't have to make it all brown. Just devoid of trees.

if a unit keeps firing through forest and cannot shoot through, it needs to leave the forest.

Make the recoil when hit shorter, faster, with a faster recoil back. It should tilt back and forward is what I am after. But being physically pushed back a bit is nice too.

At night different lights should be more noticeable, illuminate more. the "moonlight" should be a bit darker. The little flying lights should actually illuminate the area around them.

A firing unit should always thinka bout getting to a better position to attack enemy, so away from trees, flanking enemy when another friendly is hitting it from another side etc. stationary is weird. But don't overdo it.

peewee and commander should also have a "reloading" animation or shooting from their weapon animation.
