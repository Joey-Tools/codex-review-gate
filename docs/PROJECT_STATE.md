# Project State

## Current State
- The source workspace keeps the publishable GitHub Action package under `packages/action`.
- The v2 runtime, installation, and manifest-driven publisher infrastructure
  are released as immutable stable `v2.0.4` with the floating `v2` alias. The
  controlled organization-wide v2 handoff is complete for its fixed 10-member
  active cohort: the old organization rule no longer requires v1, and all eight
  affected repository-local legacy surfaces now require only `test`.
- The source repository `Joey-Tools/codex-review-gate` is not part of that
  cohort. Its canonical v2 verifier and controller are installed alongside an
  exact temporary v1 bridge, and separate status-only v2 ruleset `23927388`
  is Active after source canary `#67`. The separately approved source-local
  cleanup has removed the v1 `codex/review-gate` required status from
  independent repository ruleset `16410326` while retaining its non-status
  protections; the temporary bridge remains intentionally installed. The
  controller admits only exact Codex-bot `issue_comment` `created` events;
  edited carriers use protected manual reconciliation.
- Per-workstream details live under `docs/project_journal/`; keep this file as a short repo-wide recovery entrypoint.

## Recovery Pointers
- Action subtree layout workstream: `docs/project_journal/2026/05/2026-05-18-action-subtree-layout-4df8f16.md`
- Completed v2 delivery plan and release evidence: `docs/project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md`
- Authoritative active organization v2 cohort handoff: `docs/project_journal/2026/09/2026-09-18-organization-v2-handoff.md`
- Superseded pre-confirmation v2 implementation record: `docs/project_journal/2026/08/2026-08-13-action-v2-release-pipeline-7bf930a.md`
- Superseded v1 release automation history: `docs/project_journal/2026/05/2026-05-18-action-release-automation-9a806cf.md`

## Global Blockers
- Temporary bridge removal for the frozen active 10-member cohort remains
  blocked until the authorized post-cutover fresh audit is implemented and
  produces a new receipt from fresh v2 canaries plus current exact policy and
  workflow readback. It must retain equal manifest-derived and observed identity
  lists and explicit `bypass_actors` arrays from every manifest-bound ruleset
  detail read; a redacted/malformed bypass field requires a ruleset-write-capable
  credential and a fresh read under the applicable freeze. It cannot authorize
  removal of a source-local bridge outside that cohort or claim historical
  activation evidence retroactively.
- The source repository's v1 required-status transition is complete: its
  independent local ruleset `16410326` no longer requires
  `codex/review-gate`, while Active status-only v2 ruleset `23927388` and every
  unrelated protection remain intact. Its temporary bridge is intentionally
  retained. Any later source-local bridge removal needs its own separately
  authorized closure proof and must not broaden the organization receipt scope.
- The old rule's original 11-repository legacy selector remains intact,
  including archived `Joey-Tools/codex-waited-delivery`. The completed final
  cutover removed only the v1 required-status rule; it retains `deletion` and
  `non_fast_forward`.
  The archived repository requires no v2 install, canary,
  repository cleanup, receipt membership, or bridge removal. Its fixed
  `legacy_only_repository` identity remains outside the active receipt and
  bridge-removal scope.
- A schema-2 final receipt must carry both the manifest-derived active
  `manifest_repositories` list and the stable observed `repositories` list;
  canonical entry-by-entry equality is required. Bridge removal authorizes only
  the manifest-derived list. In this rollout, either list rejects
  `Joey-Tools/codex-waited-delivery` by slug, ID, or node ID. Schema-1 keeps
  its historical exact shape and canonical digest for audit but authorizes no
  new bridge removal.

## Notes
- The generated `docs/project_journal/INDEX.md` is a local convenience artifact and should not be committed.
