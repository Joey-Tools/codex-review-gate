# Project State

## Current State
- The source workspace keeps the publishable GitHub Action package under `packages/action`.
- The confirmed v2 runtime, installation, and manifest-driven publisher
  contract is being implemented from the 2026-08-26 delivery confirmation; no
  v2 publication or consumer activation is recorded yet.
- Per-workstream details live under `docs/project_journal/`; keep this file as a short repo-wide recovery entrypoint.

## Recovery Pointers
- Action subtree layout workstream: `docs/project_journal/2026/05/2026-05-18-action-subtree-layout-4df8f16.md`
- Authoritative active v2 delivery workstream: `docs/project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md`
- Superseded pre-confirmation v2 implementation record: `docs/project_journal/2026/08/2026-08-13-action-v2-release-pipeline-7bf930a.md`
- Superseded v1 release automation history: `docs/project_journal/2026/05/2026-05-18-action-release-automation-9a806cf.md`

## Global Blockers
- v2 cannot publish until the infrastructure change is merged and validated,
  a separate release-intent change is reviewed, and the target Environment,
  App/GPG, rulesets, and release reconciliation preflights are complete.

## Notes
- The generated `docs/project_journal/INDEX.md` is a local convenience artifact and should not be committed.
