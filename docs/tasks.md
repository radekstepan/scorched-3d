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

Units lock up where one might be attacking an another is maybe just moving but not shooting. It's weird. Or 10 units facing enemy and just 1 shooting.

The units sometimes engage in a little "dance" with each other. Distracting, reduce it and think about how groups of units and enemies can not "cycle" trying to avoid each other. This is still not fixed. Units will jitter around each other, I want smooth movement.

The HQ flag should be flickering and give it an outline so it doesn't blend e.g. against the blue water.

Add a "chrome" to the UI and for visual elements like the panels from `redesign-stumpy-tank-model` sibling directory. Make it look more like a full RTS

Now that we have a "chrome", add a second "tab" to the game which when clicked (will pause the game) and show units just like `redesign-stumpy-tank-model` sibling directory does. The goal is to have a "folio" of different units that we can browse and see up close.

Make units shoot through trees less.

The commander sometimes does a few steps back, same as peewee, while walking forward.
