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

For unit folio show the unit on terrain with toggles for motion shotting etc. This from `redesign-stumpy-tank-model` sibling directory.

Use the logo from `redesign-stumpy-tank-model` sibling directory for the game

The tab for Battlefield is too far left. Should be aligned with the actual UI.

I don't like the faint border inside the game.

Last bunch of commits fucked up pan speed and max zoom when zoomed in close. Panning is too slow in some cases, I couldn't even zoom in up close, but now it seems to work. Is it unit count causing this? When zooming in don't zoom in so close and keep the angle!

Peewee shooting grenades too high, should be more ballistic. And while walking should have a gun pointing forward not up by default.

Tweak the commander model to have a weapon in one of the claw. Right now it seems to shoot from the body?

In top right corner show actual latest version number of the game.

Sometimes a tank in a forest being attacked seems to just "take it" pointing at one or the other unit attacking instead of firing.
