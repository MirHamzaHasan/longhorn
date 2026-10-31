# docs

One guide per feature, each recording ownership, API, connections, verification and
limits. [features.md](features.md) is the index.

- Do not read this folder wholesale. Search `features.md`, then open what it links.
- A guide should say what was really run, and name what was not.
- Keep guides small and link between them instead of repeating.
- Link with relative paths, as the existing guides do.

## Files many tasks touch

`features.md`, `architecture.md`, `roadmap.md`, `supported-runtimes.md` and
`v0.1-plan.md` collide constantly: each changed in more than 20 of 53 commits.

- List them under `shared:` in your task, not `paths:`.
- Add your row or section. Do not reorder, reflow or reword what is already there.
- Make these edits last, after rebasing, in as small a commit as you can.
