---
id: 20260918-organization-v2-handoff
title: Organization v2 Cohort Handoff
status: active
created: 2026-09-18
updated: 2026-09-18
branch: codex/organization-v2-handoff
pr:
supersedes: []
superseded_by:
---

# Organization v2 Cohort Handoff

## Summary

- Stable Action `v2.0.0` and the floating `v2` alias are published from
  `JoeyTeng/codex-review-gate-action`. This workstream implements and carries
  out the user-approved organization-wide transition from the inherited v1
  required status to v2.
- The cohort (a fixed, complete set of repositories migrated together) is the
  exact 11-member selector of `Joey-Tools` organization ruleset `16590367`,
  `Must Pass Codex Review`. Joey explicitly confirmed that this includes the
  formerly special compatibility, history, and deprecated members for this
  handoff.
- This is not a broad relaxation of the ordinary installer. It adds a separate,
  auditable temporary-bridge profile and a manifest-bound organization handoff
  transaction. The normal completed-installation contract continues to reject
  every v1 caller.

## Adopted Transition Contract

- The existing organization ruleset remains active throughout the preparation
  phase. Its repository selector, `deletion`, `non_fast_forward`, bypass
  configuration, and every other non-v1 rule remain unchanged.
- A separate organization ruleset is staged disabled, then activated only after
  complete cohort proof. It contains exactly one strict required-status rule:
  `codex/github-review-gate` from GitHub Actions integration `15368`; it has
  no bypass actors. It deliberately does not duplicate deletion,
  non-fast-forward, or pull-request policy from the old ruleset.
- Every cohort member receives canonical v2 verifier/controller workflows,
  CODEOWNERS control-plane coverage, its repository v2 policy, and the exact
  temporary legacy bridge. The bridge is constrained to an approved path and
  byte-for-byte template; it may emit only the legacy v1 context and cannot
  become another v2 producer.
- Each member must prove both the native v2 exact-head/test-merge CheckRun and
  the legacy v1 required status while the old organization rule is still
  active. A member with a compatibility or history-only legacy surface is not
  silently exempted.
- The v1 status is an availability proof for the temporary bridge, not the
  security authority for cutover: the inherited v1 required-status rule has no
  integration binding, and a commit-status `target_url` is writer-supplied
  metadata. The v2 CheckRun bound to GitHub Actions integration `15368` is the
  authoritative security proof.
- Unlike an ordinary completed single-repository canary, each cohort canary
  remains open and non-draft until the organization activation evidence is
  complete. This is required so the handoff can bind the current default-base
  test merge rather than a closed PR's historical result; it is then closed
  unmerged.
- After all 11 members are in that state, the new organization rule is active
  and read back across the full cohort. This intentionally creates a temporary
  dual-protection interval.
- The nine repository-local legacy required-status entries are then removed by
  the controlled `apply-repository-cleanup` mode. Each snapshot-bound action
  binds exact manifest `full_name`, `id`, `node_id`, and `default_branch`
  before every surface read and again immediately before any needed mutation,
  then performs exact-before comparison, the surface-specific mutation, and
  exact-after readback while preserving every other rule. The metadata tuple
  protects repository object identity/default-branch selection; the surface
  snapshots protect selected policy content. Unreadable or mismatched identity
  stops the batch at observation; a pre-mutation mismatch emits no current
  write, and no later mutation runs. A stable mixture of before/after items is
  resumable and plans only the remaining before-state items. Only after their
  readback and a full cohort pre-cutover snapshot may the old organization
  ruleset be updated.
- The sole old-rule cutover mutation is a `PUT` to the existing ruleset ID that
  removes its `codex/review-gate` required-status rule. It never deletes the
  ruleset. Two complete, stable cohort snapshots must show that every member is
  covered by v2 and that all old non-v1 policy is unchanged.
- The mutating `verify --apply` response does not authorize bridge removal.
  While the final policy-mutation freeze remains active, a separate read-only
  `verify` must return top-level
  `schema_version: organization-review-gate-handoff-output/v1`, `mode: verify`,
  `status: final-verified`, `applied: false`, and `action: null`. Its schema-v1
  final-closure receipt
  binds the organization, reviewed manifest digest, final snapshot digest,
  terminal legacy/v2 ruleset identities/states, and the exact repository
cohort in canonical UTF-8-byte `full_name` order. The receipt is valid only for that
complete fixed eleven-member cohort, never a subset or expanded set; the
top-level `plan_sha256` must bind its final read-only `verify` plan exactly,
and the receipt's canonical SHA-256 is the explicit removal proof.
- Removal of each temporary bridge is a later, separate PR phase. The local
  bootstrap accepts only the complete final read-only verify JSON, its exact
  embedded-receipt SHA-256, an unambiguous GitHub `origin`, and live GitHub
repository metadata that exactly match one receipt entry's `full_name`, `id`,
`node_id`, and `default_branch`. At the pre-rename boundary it reads `origin`
before and after the metadata lookup, repeats the local object checks, then
reads `origin` once more immediately before the atomic bridge quarantine
rename. After the rename and before unlink, it repeats the complete `origin`
to live metadata identity/default-branch to `origin` check and revalidates the
quarantined object's identity and canonical content. Remote-binding failure
attempts a no-clobber hard-link restoration of that same admitted bridge; an
occupied canonical path or failed verification stops without overwrite or
removal success. These are point-in-time checks, not a continuous lock.
This returns consumers to the ordinary no-v1-caller installation contract after
the global cutover is closed.

## Current State

- Source tooling implements the temporary bridge, cohort handoff transaction,
  receipt-bound bridge removal, and their operator-facing guides.
- No organization ruleset, repository ruleset, or consumer default branch has
  been mutated by this workstream yet.
- Read-only inventory confirms that all 11 members inherit old organization
  rule `16590367`; nine additionally retain a repository-level legacy
  `codex/review-gate` requirement. The other two compatibility/history cases
  still require an explicit bridge and v2 proof before they can enter the
  cohort's dual-protection state.
- `codex-waited-delivery` is currently a workspace retirement tombstone rather
  than an active configured mirror. Before its migration PR can be prepared,
  the workspace manifest must restore its prior active specification and a
  user-run host-level `codex_workspace.py ensure` must initialize the mirror.
  The automation does not bypass that rule by cloning or by writing repository
  contents through an API.

### Execution Update — 2026-09-18

- Ten bridge-preserving migration PRs are open. They install the canonical v2
  verifier/controller, the managed CODEOWNERS block, and the canonical legacy
  bridge without changing any required-status policy:
  - `codex-apple-notes-toolkit#6` at
    `5eb0b475d85b0f1cb99c2cc84fffb8c3fd3c004a`;
  - `codex-debug-triage#9` at
    `86944e7efbe31eeb21f15eb49485a233e656a253`;
  - `codex-personal-sync#22` at
    `472679a49b6b8d7d6d5be3eb8ea4e17e69a6474c`;
  - `codex-project-journal#7` at
    `e3db9a1b23077df90b6ad9edbed42b7fb2b083f7`;
  - `codex-review-workflows#115` at
    `3925e7ae47864ef87696cc73687c213691a0bc4d`;
  - `codex-rollout-backup#8` at
    `546df566f05aa36c78220d431a5e7280fe9f955a`;
  - `codex-session-retrospective-history#7` at
    `3bd7c6c42b45c8e6434cfd51de4beb9281d35325`;
  - `codex-toolbox#33` at
    `ee8ffaa6c5015316925ffb64ec33cbdac423bee8`;
  - `codex-workflow-hygiene#77` at
    `518185db0b5577733c9555638d29f04104f9aea4`; and
  - `codex-private-workflows#193` at
    `8e80ea15e1cc9a5d61e32f5a024bbc9c5b1ea5f2`.
- An installation PR is an intentional manual trust bootstrap. Its new
  controller exists only on the PR head, while `issue_comment` and
  `workflow_dispatch` consume the default-branch workflow. The initial v2
  verifier can therefore fail closed before a terminal provider result without
  constituting an Action defect. After merge, a separate harmless canary PR
  supplies the authoritative current-head v2 and v1 proof used by organization
  activation.
- The writable controller intentionally excludes `pull_request_review` and
  `pull_request_review_comment`. GitHub binds both event families to the PR
  merge ref; a controller carrying `actions: write` and `issues: write` must
  remain a protected-default-branch workflow. Review- or reaction-only
  provider evidence is instead consumed by the typed default-branch manual
  `reconcile` path. This preserves the single-producer and pre-runner trust
  boundary without adding a runtime App, status writer, or cron.
- A migration-review bridge run on `codex-review-workflows#115` demonstrated
  the same merge-ref boundary in practice: run `35355124380` failed its
  `issues: write` audit-comment POST with `403 Resource not accessible by
  integration` and wrote `codex/review-gate=error`. The canonical bridge now
  removes `pull_request_review` from its closed trigger envelope, while
  retaining only `pull_request_target` lifecycle events and
  `issue_comment: created`; an exact rerun of the pre-existing trusted
  default-branch publisher (`35353747519`) restored the current v1 success.
  Every open migration PR must be re-bootstrapped to the corrected canonical
  bridge bytes before it is eligible to merge.
- During dual enforcement, manual v2 `reconcile` can refresh only the native
  `codex/github-review-gate` CheckRun and must never write the legacy status.
  Review- or reaction-only evidence therefore recovers v1 only by rerunning
  one already existing, current-head-bound `pull_request_target` bridge run and
  proving its exactly-next attempt plus latest successful `codex/review-gate`
  status; it never adds a writable review event or `workflow_dispatch`. If no
  unique run remains inside GitHub's rerun window, draft-to-ready creates a new
  trusted lifecycle run before selection restarts.
- Before an organization v2 rule is activated, every pre-existing open PR
  must also have a fresh verifier on its current head/base/test-merge scope.
  A new push, reopen, or documented draft-to-ready transition creates that
  verifier; controller reconcile can only rerun an already-existing exact
  verifier and deliberately cannot synthesize a new pull-request event.
- Joey confirmed the final policy order: the new organization ruleset has v2
  as its sole required status context; the old ruleset retains deletion and
  non-fast-forward protection until the final, receipt-bound removal of its v1
  context. No organization-policy mutation is authorized before all eleven
  members have reached the dual-protection proof boundary.
- Activation also requires a durable independent control-plane Codeowner path.
  The managed `/.github/**` owner currently names `@JoeyTeng`, while some
  cohort repositories have no other writable principal. That does not block
  ordinary pull requests or this bridge preparation, but it would prevent a
  future control-plane PR authored by that account from receiving the required
  distinct Codeowner approval. Do not activate the v2 repository policy until
  a separately authorized writable reviewer path has been selected for every
  affected repository.

## Failure And Recovery Boundary

- Any changed selector, repository identity/default branch, workflow bytes,
  bridge bytes, complete workflow inventory, Actions default token permission,
  repository policy, canary evidence, old-rule fingerprint, or incomplete API
  response is inconclusive and prevents the next mutation. The workflow
  inventory admits only the three canonical files and rejects any extra v1/v2
  caller, related writer, nested workflow tree, symlink, submodule, or other
  non-regular entry; default workflow permission must be `read`.
- Each authoritative cohort snapshot consists of two complete reads separated
  by five seconds. A changed fingerprint restarts the pair; after 60 seconds
  without a stable pair the tool reports inconclusive and performs no next
  write. The comparison protects the selected policy/evidence content, not
  benign transport metadata.
- Activation requires the live open/non-draft canary evidence through its
  post-write dual-enforcement readback. Once that readback succeeds, later
  derive/cleanup/verify snapshots deliberately omit the closed canary
  lifecycle and do not require the default-branch head to remain at the
  historical canary base. They reread the live default branch and retain the
  current repository identity, complete regular-blob workflow inventory,
  canonical workflow/CODEOWNERS bytes, default-read Actions policy including
  an explicit boolean `can_approve_pull_request_reviews`, bridge, v2 rulesets,
  and cleanup-state closure.
- The operator holds an external organization-admin policy-mutation freeze
  from stage preview through apply, readback, and any recovery. A second
  organization/repository-admin freeze covers activation preview through its
  stable post-write readback. A third begins before repository-cleanup preview
  and remains continuous through cleanup apply/readback, final-cutover
  preview/apply, and a separate final read-only verify receipt capture and
  validation. During that third interval no cohort repository may be renamed,
  transferred, deleted, have its default branch changed, or be replaced or
  re-created at its original slug, and no ruleset, classic branch-protection,
  condition, required-check, or bypass-actor mutation is allowed. This is an
  operational freeze, not a continuous lock. The helper checks exact
  manifest-bound repository identity/default branch and bypass lists; it does
  not automatically discover an actor added outside the snapshot.
- Before the old organization-rule `PUT`, the helper repeats the complete
  cohort revalidation and then reads the old rule's writable identity directly
  adjacent to the write. GitHub's ruleset update endpoint has no conditional
  compare-and-swap contract. Plan digests and readback detect observed drift,
  but cannot prevent or reconstruct an external update overwritten in the
  final GET-to-PUT interval.
- A potentially successful but unacknowledged stage POST is never replayed.
  The apply path first attempts one read-only reconciliation and may return
  `applied-recovered`; interrupted or still-unknown outcomes use the explicit
  read-only `stage --recover-created-v2` path. It can bind only one unique
  same-name candidate whose source and complete writable state exactly match
  the canonical Disabled v2 payload while the old rule remains at its
  before-state; absent, multiple, Active, or drifted candidates stop. The
  recovery read requires an external organization-admin policy-mutation freeze.
- Repository cleanup accepts a stable before/after mixture and plans only
  still-before items. Each action binds exact repository identity/default
  branch before every surface read and immediately before a needed mutation;
  each mutation is also preceded by exact-before validation and followed by
  exact-after readback. An error or unknown write result triggers an immediate
  narrow read-only reconciliation: exact after is complete, while before,
  identity or policy drift, or an unreadable result stops the batch for a fresh
  reviewed preview. It never blindly replays the old request or digest. GitHub
  exposes no repository-ID conditional/CAS mutation, so the operational freeze
  covers the final metadata-read-to-write gap.
- The third freeze may end only after the complete final read-only verify JSON
  and its canonical receipt digest are captured. An inconclusive final read,
  bound-policy drift, or a known policy mutation before bridge-removal
  preparation leaves every bridge installed. Recovery is to restore the
  manifest-bound closure and mint a fresh final read-only receipt under a new
  freeze; neither the `verify --apply` response nor a known-stale receipt may be
  substituted.
- A partial activation remains fail closed: the old v1 rule stays active and
  the new v2 rule is not used as evidence to remove v1. The transaction does
  not automatically delete or weaken either rule.
- The organization handoff manifest is evidence for a bounded API transaction,
  not a durable decision ledger. GitHub remains the authority; each recovery
  reruns the full readback before continuing.

## Next Steps

1. After the source change lands, create the 11 migration PRs and stage the
   new organization v2 rule without removing v1.
2. Collect each exact canary proof, activate v2 organization protection, remove
   the bound repository-level legacy contexts, and perform the one old-rule
   v1-status removal with double-read verification.
3. Capture and validate the separate final read-only closure receipt, then use
   that repository-bound proof in each bridge-removal PR.

## Evidence

- Stable release: `https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.0.0`
- Old organization ruleset: `Joey-Tools` ruleset `16590367`, read through
  `GET /orgs/Joey-Tools/rulesets/16590367` on 2026-09-18.
- Prior v2 decisions and implementation ledger:
  `docs/project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md`.
- Current delivery validation: `npm run test:organization-handoff` passed
  218/218. Documentation `git diff --check` and project-journal validation
  passed after this boundary update.
