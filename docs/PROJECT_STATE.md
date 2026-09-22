# Project State

## Current State
- The source workspace keeps the publishable GitHub Action package under `packages/action`.
- The v2 runtime, installation, and manifest-driven publisher infrastructure
  are released as immutable stable `v2.0.1` with the floating `v2` alias. The
  current active workstream adds the controlled organization-wide consumer
  handoff needed to migrate the inherited v1 gate without weakening branch
  protections.
- Per-workstream details live under `docs/project_journal/`; keep this file as a short repo-wide recovery entrypoint.

## Recovery Pointers
- Action subtree layout workstream: `docs/project_journal/2026/05/2026-05-18-action-subtree-layout-4df8f16.md`
- Completed v2 delivery plan and release evidence: `docs/project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md`
- Authoritative active organization v2 cohort handoff: `docs/project_journal/2026/09/2026-09-18-organization-v2-handoff.md`
- Superseded pre-confirmation v2 implementation record: `docs/project_journal/2026/08/2026-08-13-action-v2-release-pipeline-7bf930a.md`
- Superseded v1 release automation history: `docs/project_journal/2026/05/2026-05-18-action-release-automation-9a806cf.md`

## Global Blockers
- The inherited v1 organization gate must remain active until every member of
  the fixed active 10-repository v2 cohort proves its canonical v2 check under
  a separately active v2-only organization rule. Any missing or drifting proof
  leaves the system in the deliberately fail-closed dual-protection state.
- Before the organization v2 activation proof, the manifest-bound Private
  Overlay scheduler must be explicitly quiesced, allowed to drain without
  cancellation, and restored only after the stable dual-enforcement readback.
  The authoritative operation/recovery details are in the active handoff
  journal.
- The old rule's original 11-repository legacy selector remains intact,
  including archived `Joey-Tools/codex-waited-delivery`. Final cutover removes
  only the v1 required-status rule; it retains `deletion` and
  `non_fast_forward`. The archived repository requires no v2 install, canary,
  repository cleanup, receipt membership, or bridge removal. Its fixed
  `legacy_only_repository` identity is independently read in post-activation
  and cutover snapshots, then reread immediately before the legacy-rule `PUT`;
  an unreadable, mismatched, or non-archived result blocks that write.
- A schema-2 final receipt must carry both the manifest-derived active
  `manifest_repositories` list and the stable observed `repositories` list;
  canonical entry-by-entry equality is required. Bridge removal authorizes only
  the manifest-derived list. In this rollout, either list rejects
  `Joey-Tools/codex-waited-delivery` by slug, ID, or node ID. Schema-1 keeps
  its historical exact shape and canonical digest for audit but authorizes no
  new bridge removal.

## Notes
- The generated `docs/project_journal/INDEX.md` is a local convenience artifact and should not be committed.
