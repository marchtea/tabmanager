# TabDock Agent Notes

## Product Context

TabDock is a local-first Chrome Extension new tab workspace manager. It organizes the current Chrome profile's open tabs into local `Space` -> `Stack` -> `Saved Tab` data, stored in extension-local state.

Before changing product behavior, read [docs/PRD.md](docs/PRD.md). Treat that PRD as the source of truth for:

- Existing product capabilities and current implementation status.
- Core concepts, data model, permissions, and persistence rules.
- Search, Open Tabs panel, workspace, settings, import/export, and local backup behavior.
- Acceptance criteria and expected test coverage.

Keep this file brief. Do not restate detailed feature requirements here.

## Product Change Rule

During iterative development, do not update [docs/PRD.md](docs/PRD.md) for every product behavior change.

When the user asks to commit or prepare a PR, review the accumulated product behavior changes, update [docs/PRD.md](docs/PRD.md) once with the final behavior, and summarize those product capability changes in the commit/PR notes.
