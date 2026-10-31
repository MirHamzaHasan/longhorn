# starters

Editable launchers, tests and guides copied into generated applications. Guide:
[docs/starter-templates.md](../docs/starter-templates.md).

- Everything inside a template folder can reach a user's project. Do not add agent
  files, task notes or repository-relative links inside a template.
- Generated projects must work outside this monorepo, so no imports or paths may point
  back into it. `{{PROJECT_NAME}}` is substituted at generation.
- A new file must be declared in the matching `cli/src/*-template.ts`.
- Each template carries its own `docs/`. Update them when behaviour changes.
- Verify with the matching packed gate, listed in [cli/AGENTS.md](../cli/AGENTS.md).
