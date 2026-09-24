# Agent Installation Runbook: Codex Review Gate v2

Use this runbook when a coding agent installs v2 for a repository maintainer.
It is the executable form of the [human guide](human.md), not an alternative
installation design. Copy the canonical assets; never reconstruct either
consumer workflow from examples in this document.

Install and verify all three required asset groups: the canonical verifier and
controller workflows, the repository ruleset, and the final effective
`.github/CODEOWNERS`. The two
managed CODEOWNERS rules must name the same explicit `CONTROL_PLANE_OWNER`,
and the ruleset must require Code Owner review with stale approvals dismissed
after a push. `integration_id: 15368` identifies the whole GitHub Actions App,
not either workflow, so it is not a substitute for the byte-verified workflows
and the CODEOWNERS control plane.

## Inputs and stop conditions

Resolve these values first:

```text
SOURCE_ROOT = clean checkout of Joey-Tools/codex-review-gate
TARGET_ROOT = authorised consumer-repository worktree
REPO = OWNER/REPO for TARGET_ROOT
DEFAULT_BRANCH = consumer repository default branch
INSTALL_BRANCH = branch for the migration PR
MIGRATION_PR = migration PR number after it is opened
CONTROL_PLANE_OWNER = one @USER with write, maintain, or admin on REPO
V2_RULESET_NAME = selected v2 ruleset name; default "Must Pass Codex Review"
```

Stop before writing when the target is not authorised, unrelated work makes
`TARGET_ROOT` dirty, the default branch cannot be proved, or the repository is
outside the supported GitHub.com/default-branch PR scope.

Maintain these invariants:

- in the ordinary single-repository path, one migration PR may remove v1 and
  install v2;
- the canary is a separate PR created after the migration merges;
- close the canary without merging it;
- every manual run targets one PR and one exact expected head;
- `workflow_dispatch` is the sole manual entry point;
- invoke `gh workflow run` without `--ref`, then read the created run back and
  prove that it used `DEFAULT_BRANCH`;
- prefer a direct `@codex review` provider-side attempt; it does not grant
  provider capability or guarantee that Codex starts. Use `begin-review` only
  when request creation and a newer verifier attempt need controller
  coordination;
- select exactly one request producer for each exact-head review generation.
  A direct request is preferred only while no controller `begin-review` with
  `request_review=true` is active for that head. Once such a run has been
  dispatched, is starting, or has emitted its hidden marker, do not also post
  a direct `@codex review`. If ownership is uncertain, read the controller run,
  canonical marker, sticky diagnostic, and provider evidence before mutating;
- select only `default` and `expanded` through protected repository variable
  `CODEX_REVIEW_GATE_LIMITS_PROFILE`, never dispatch or numeric overrides.
- canonical workflows fix `CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`.
  Do not add a repository variable, Action input, or strict policy to an
  ordinary consumer workflow; `write` is reserved for a future nonstandard
  verifier identity that can read collaborator permissions.
- keep `CONTROL_PLANE_OWNER` explicit in every bootstrap invocation. It
  defaults to `@JoeyTeng`, but a non-Joey repository must substitute its own
  eligible GitHub user.

## Narrow source-repository self-hosting exception

Use this path only when `REPO` is exactly `Joey-Tools/codex-review-gate` and
the task is to migrate that source repository itself. It is not an alternative
ordinary-consumer or repository-level cohort installation mode: the importable
template and the bootstrap default `full` profile remain mandatory everywhere
else.

1. Prepare the source migration PR with the canonical v2 verifier and
   controller plus the exact temporary legacy bridge. Use `--legacy-bridge` on
   the source worktree preparation; do not pass `--ruleset-profile status-only`
   there, because that profile is remote-stage-only.
2. Merge that PR while the existing source legacy rule remains Active. Record
   the owner-approved `LEGACY_INVENTORY_SHA256`; do not synthesize or replace
   its value.
3. Stage the distinct disabled source rule remotely, preserving the temporary
   bridge and exact legacy inventory boundary:

   ```bash
   REPO="Joey-Tools/codex-review-gate"
   CONTROL_PLANE_OWNER=@JoeyTeng
   V2_RULESET_NAME="Must Pass Codex Review v2"
   # Set this from the owner-approved legacy inventory snapshot.
   LEGACY_INVENTORY_SHA256=OWNER_APPROVED_LEGACY_INVENTORY_SHA256

   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --ruleset-profile status-only \
     --legacy-bridge \
     --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --ruleset-profile status-only \
     --legacy-bridge \
     --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256" \
     --apply
   ```

4. Carry `--ruleset-name "$V2_RULESET_NAME"`, `--ruleset-profile status-only`,
   and `--legacy-bridge` through every later remote canary activation and
   read-only cleanup derivation/verification invocation. Do not fall back to
   the default `full` profile for this source exception. While the legacy
   required status exists, the CLI rejects this source-only profile without
   `--legacy-bridge`, so a drifted bridge cannot strand `codex/review-gate`
   with no producer. Verify that the new
   rule contains only the strict GitHub-Actions-bound
   `codex/github-review-gate` requirement. It must be a second rule: the
   existing source rule keeps deletion, non-fast-forward, pull-request, and
   associated CODEOWNERS protection. After the separate canary passes and the
   source-specific rule becomes Active, both the legacy v1 status and v2
   CheckRun remain required until an owner-approved cleanup action removes
   only the legacy requirement and the post-cleanup proof succeeds. Do not
   remove or broaden legacy protection.
5. Never use an organization schema-2 final-closure receipt to remove this
   source bridge. Stop until a separately authorized, recorded source-local
   closure proof exists.
6. After the source-only v2 rule is exactly Active, derive and review the
   source-local cleanup plan with the same `status-only` profile and bridge.
   Keep the plan's raw UTF-8 bytes unchanged; its SHA-256 is an explicit
   approval input. The plan also binds the exact owner-approved
   legacy-inventory SHA-256, so execution must supply that same digest rather
   than substitute a later inventory approval. This path is unavailable to
   ordinary consumers:

   ```bash
   POST_CLEANUP_PLAN="$(mktemp)"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --ruleset-profile status-only \
     --legacy-bridge \
     --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256" \
     --derive-post-cleanup-plan > "$POST_CLEANUP_PLAN"
   jq . "$POST_CLEANUP_PLAN"
   EXPECTED_POST_CLEANUP_SECURITY_SHA256="$(jq -er \
     '.expected_post_cleanup_security_sha256 |
      select(test("^[0-9a-f]{64}$"))' \
     "$POST_CLEANUP_PLAN")"
   POST_CLEANUP_PLAN_SHA256="$(shasum -a 256 "$POST_CLEANUP_PLAN" |
     awk '{print $1}')"
   ```

7. The source plan must contain no classic mutation and exactly one
   `remove-legacy-check-only` action for the retained legacy ruleset. Preview
   it first, then add `--apply` only after the separately recorded
   authorization:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --ruleset-profile status-only \
     --legacy-bridge \
     --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256" \
     --apply-post-cleanup-plan "$POST_CLEANUP_PLAN" \
     --expected-post-cleanup-plan-sha256 "$POST_CLEANUP_PLAN_SHA256"

   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --ruleset-profile status-only \
     --legacy-bridge \
     --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256" \
     --apply-post-cleanup-plan "$POST_CLEANUP_PLAN" \
     --expected-post-cleanup-plan-sha256 "$POST_CLEANUP_PLAN_SHA256" \
     --apply
   ```

   Before its single PUT, the executor re-derives a final pair of complete
   pre-cleanup closures, requires canonical equality with the admitted plan,
   then reads both the exact legacy target and selected v2 ruleset immediately
   before comparing their complete writable projections. GitHub does not offer
   a ruleset-update CAS (compare-and-swap, an atomic read-and-write
   precondition), so these reads detect observed drift but cannot exclude an
   administrator change in the final API gap. Run final derivation, exact
   reads, PUT, readback, and closure under a separately authorized external
   single-writer policy freeze; if that freeze cannot be maintained, do not
   apply. It reads the exact after-state and automatically runs the two-round
   closure. If the PUT, readback, or closure fails, it may already have
   completed: do not replay it, mutate classic protection, remove the bridge,
   or disable/overwrite v2. Preserve Active v2 and use only the read-only proof
   below plus exact ruleset inspection before separately authorizing repair:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --ruleset-profile status-only \
     --legacy-bridge \
     --verify-post-cleanup \
     --expected-post-cleanup-security-sha256 \
     "$EXPECTED_POST_CLEANUP_SECURITY_SHA256"
   ```

## Advanced controlled handoff for an active ten-repository v2 cohort

Use this execution path only when the authorized scope is exactly one reviewed
active ten-repository v2 cohort covered by a shared v1 organization ruleset.
The old v1 rule retains its original eleven-repository legacy selector. This
is not a reusable `allow-v1` switch. Outside the separately documented source
self-hosting exception above, the ordinary phases below continue to reject
every v1 caller, and the advanced path must return every active member to that
same final no-v1 contract.

`Joey-Tools/codex-waited-delivery` is archived and legacy-only. It stays in the
old rule's original eleven-repository selector so `deletion` and
`non_fast_forward` remain protected after cutover. It receives no v2
installation, canary, repository cleanup, final-closure receipt membership, or
bridge removal.
The manifest records this sole exception at
`legacy_ruleset.legacy_only_repository` with exact `slug`, numeric `id`,
`node_id`, `default_branch`, and `archived: true`. The old selector may contain
only the ordered ten active IDs plus that identity's ID exactly once. Reject an
unknown eleventh ID, duplicate, or any identity overlap with the active cohort;
otherwise archive protection could be silently redirected.

Add these cohort inputs:

```text
HANDOFF_MANIFEST = absolute path to reviewed JSON
HANDOFF_SCHEMA = organization-review-gate-handoff-manifest/v3
V2_ORGANIZATION_RULESET_NAME = Must Pass Codex Review v2
COHORT_REPOSITORY_V2_RULESET_NAME = Must Pass Codex Review v2
```

The manifest must bind the exact organization ID and node ID; the complete
old organization ruleset snapshot, its original eleven-repository selector,
and the fixed archived-only repository identity; the new rule's name and ID;
exactly ten ordered active repository slugs, numeric IDs, node IDs and default
branches; the Git blob and SHA-256 identities of verifier, controller and
temporary bridge; the effective CODEOWNERS identity; each complete Active
repository v2 ruleset; and every active repository legacy-cleanup before/after
action. Each canary must bind an exact
open, non-draft, same-repository PR to its current head, base and test-merge
SHAs; the v2 CheckRun, run, workflow, attempt and job IDs; and the latest
successful legacy commit-status ID. Version 3 additionally binds the
per-repository legacy-evidence window; the complete repository-evidence,
scheduler-snapshot, and organization-evidence phase capacities; the
full-cohort coverage-round capacity; the two-round coverage-stability capacity;
every repository's `legacy_writer_scan_timeout_ms`; and exactly one
`scheduler_quiescence` descriptor. That descriptor is valid only for
`Joey-Tools/codex-private-workflows` workflow
`.github/workflows/scheduled-sync-release.yml`; it binds workflow ID, source
blob/SHA-256, initial `active` state, and the drain timeout. Stop on any
incomplete field, active-member set difference, identity drift, unexpected
scheduler descriptor, or unsupported surface.

The exact `activation` keys are `legacy_evidence_stability_timeout_ms`,
`repository_evidence_timeout_ms`, `scheduler_snapshot_timeout_ms`,
`organization_evidence_timeout_ms`, `coverage_round_timeout_ms`, and
`coverage_stability_timeout_ms`. They are manifest-bound plan input, never ad
hoc CLI overrides.

This is the current v2 handoff path. A previously issued v1 output with a
schema-1 receipt is historical eleven-member closure evidence only; do not use
it for installation, staging, activation, cleanup, or bridge removal here. Its
published JSON shape and canonical receipt digest remain strictly validated for
historical audit, but schema 1 authorizes no new bridge removal.

Instantiate
`templates/organization-review-gate-handoff/joey-tools-10-member-manifest.template.json`
according to the README beside it. Replace every explicit placeholder from
authoritative live evidence; never synthesize a missing ID or digest. Before
`stage`, the only permitted incomplete value is literal JSON `null` at
`v2_ruleset.id`, because the organization v2 ruleset does not yet exist.
Every other placeholder or incomplete field must fail validation. After the
successful `stage` readback, replace that `null` with only
`next_manifest_update.v2_ruleset.id`, review the now-complete manifest, and
rerun `plan`.

Hold an external organization-admin policy-mutation freeze from the stage
preview through its apply, readback, and any recovery because an ambiguous
POST may require no-receipt adoption. Establish an organization- and
repository-admin freeze again before the scheduler-quiesce preview; retain it
through the fresh shared-rule activation preview/apply, stable post-write
readback, and scheduler restore readback. The bound scheduler must remain
`disabled_manually` between the explicit quiesce and restore commands.
Establish a third freeze before the
repository-cleanup preview and keep it continuously through the complete
cleanup batch/readback, final old-rule preview/apply, and the separate final
read-only verify receipt capture and validation.
No administrator may change an organization/repository ruleset, classic branch
protection, condition, required check or bypass actor during these freezes; in
the second or third freeze, no one may separately enable or disable the bound
scheduler.
During the third freeze, no active cohort repository may be renamed, transferred,
deleted, have its default branch changed, or be replaced or re-created at its
original slug. These are operational freezes, not continuous API locks.
GitHub's ruleset endpoint has no documented conditional/CAS update, and its
cleanup mutation APIs have no repository-ID conditional/CAS write. Plan
digests and adjacent rereads reject observed drift but cannot prevent a racing
write in the final GET-to-PUT or repository-metadata-read-to-write interval;
the freeze covers those gaps. Validate only the manifest-bound bypass actors;
never claim that the runtime automatically discovers an actor added outside
the bound snapshot.

Every post-activation/cutover stable snapshot must also reread the
manifest-bound scheduler and require its live Actions workflow state to be
`active`, then read the archived-only repository from GitHub and match its
`full_name`, `id`, `node_id`, `default_branch`, and `archived: true` against the
manifest. Immediately before the old-rule cutover `PUT`, reread that identity
beside the old ruleset and reread the exact manifest-bound scheduler as
`active` and unchanged from the stable snapshot. An unreadable response,
same-slug replacement,
identity/default-branch drift, or `archived: false` is inconclusive and must
send no cutover write. This proof does not make the archived repository an
active v2, receipt, or bridge-removal member. If restoration was skipped or
failed, `derive-cutover`, `apply-repository-cleanup`, and `verify` fail closed
with `recovery_code=activation-scheduler-restore-required`; run a fresh
`restore-scheduler` preview/apply, confirm its active readback, then restart
the blocked preview.

Execute the following state machine in order.

1. For each active cohort member, replace the ordinary Phase 1 bootstrap calls with the
   exact bridge profile:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --legacy-bridge \
     --control-plane-owner "$CONTROL_PLANE_OWNER"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --legacy-bridge \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --apply
   ```

   This installs only the fixed canonical
   `.github/workflows/codex-review-gate-legacy-bridge.yml`. It does not waive
   the inventory check for any other v1 caller. Preserve `--legacy-bridge` on
   every remote repository bootstrap invocation until organization cutover is
   verified. Merge the migration with the same exact-head Code Owner review
   boundary as the ordinary path. Do not run this path for the archived
   legacy-only repository.

   The bridge has a closed writable event envelope: `pull_request_target` only
   for `opened`, `reopened`, `synchronize`, and `ready_for_review`, plus
   `issue_comment` only for `created`. It deliberately excludes
   `pull_request_review`: GitHub binds that workflow to the PR merge ref, where
   the compatibility publisher's `issues: write` authority is not a safe write
   surface. Do not add a local review trigger. The temporary bridge remains a
   compatibility status publisher; v2 manual reconcile cannot refresh its v1
   status. Phase 3 documents the separate exact-run recovery required while
   dual protection remains active.
2. The reviewed repository ruleset name is exactly
   `Must Pass Codex Review v2`, not the ordinary default
   `Must Pass Codex Review`. For each active cohort member, reuse the ordinary
   runbook only for its canonical-file controls and Phase 2 Disabled
   repository-policy staging. Pass both
   `--ruleset-name "$COHORT_REPOSITORY_V2_RULESET_NAME"` and
   `--legacy-bridge` to every repository bootstrap preview/apply. Do not enter
   the ordinary cleanup or canary-close steps.

   After the Disabled rule is read back, create the cohort canary. Reuse the
   ordinary evidence mechanics and only the repository activation portion of
   Phase 5: prove the exact successful `codex/github-review-gate` CheckRun and
   canonical current-test-merge workflow run/job receipt; prove the latest
   `codex/review-gate` bridge commit status is successful on the same feature
   head; then activate the complete repository v2 rule with the same distinct
   name and bridge profile. Stop before ordinary legacy cleanup. Record every
   bound ID and keep the canary open, non-draft, same-repository and
   current-base until shared organization activation is proven. The old
   organization v1 rule and all repository legacy requirements must still be
   present.
3. Complete and independently review `HANDOFF_MANIFEST`. Run the read-only
   organization plan:

   ```bash
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode plan
   ```

4. Preview and create the Disabled v2-only organization ruleset. The apply
   must use the exact digest from the matching preview:

   ```bash
   HANDOFF_STAGE_PREVIEW="$(mktemp)"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode stage > "$HANDOFF_STAGE_PREVIEW"
   HANDOFF_STAGE_PLAN_SHA256="$(jq -er \
     '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
     "$HANDOFF_STAGE_PREVIEW")"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode stage \
     --apply \
     --expected-plan-sha256 "$HANDOFF_STAGE_PLAN_SHA256"
   ```

   Require the payload to contain only one strict, source-bound
   `codex/github-review-gate` requirement for GitHub Actions integration
   `15368`, exact cohort/default-branch conditions, and an explicitly empty
   bypass list. It must not copy `deletion`, `non_fast_forward` or pull-request
   rules from the old organization rule. Bind the returned
   `next_manifest_update.v2_ruleset.id` into the reviewed manifest and rerun
   `plan` before continuing.

   If the POST might have committed but then fails, the helper first attempts
   one read-only reconciliation. Treat returned `applied-recovered` plus
   `next_manifest_update` as verified success. If the process was interrupted
   or still reports an unknown outcome, do not repeat `stage --apply`. Keep
   `v2_ruleset.id: null` and run the read-only recovery entry:

   ```bash
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode stage \
     --recover-created-v2
   ```

   `--recover-created-v2` must not be combined with `--apply` or a digest. It
   may emit `next_manifest_update` only for one unique same-name rule whose
   source and entire writable payload equal canonical Disabled v2 while the
   old organization rule remains at its exact before-state. Absent, multiple,
   Active or drifted candidates are stop conditions. Hold an external
   organization-admin policy-mutation freeze for the complete recovery read.
   Never replay the POST.
5. Preview and quiesce the sole manifest-bound private scheduler before any
   activation proof. This is limited to
   `Joey-Tools/codex-private-workflows` workflow
   `.github/workflows/scheduled-sync-release.yml`; it must not disable the v2
   verifier or temporary legacy bridge. The drain reads the complete unfiltered
   run inventory (no `status`, `head_sha`, event, or creation-time filter). Do
   not cancel an already-started run: wait for two identical all-terminal
   inventories.

   ```bash
   HANDOFF_QUIESCE_PREVIEW="$(mktemp)"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode quiesce-scheduler > "$HANDOFF_QUIESCE_PREVIEW"
   HANDOFF_QUIESCE_PLAN_SHA256="$(jq -er \
     '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
     "$HANDOFF_QUIESCE_PREVIEW")"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode quiesce-scheduler \
     --apply \
     --expected-plan-sha256 "$HANDOFF_QUIESCE_PLAN_SHA256"
   ```

   Continue only after `applied-drained`. A failure after disable intentionally
   leaves the scheduler `disabled_manually`. Read the supplied `recovery_code`,
   do not replay an ambiguous PUT, and reconcile the exact manifest-bound
   scheduler state with a fresh preview. The helper never restores the
   scheduler automatically after failed quiesce or activation.
6. Preview and activate the new organization rule from a **fresh** post-quiesce
   coverage snapshot. Never reuse coverage evidence read before quiesce:

   ```bash
   HANDOFF_ACTIVATE_PREVIEW="$(mktemp)"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode activate > "$HANDOFF_ACTIVATE_PREVIEW"
   HANDOFF_ACTIVATE_PLAN_SHA256="$(jq -er \
     '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
     "$HANDOFF_ACTIVATE_PREVIEW")"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode activate \
     --apply \
     --expected-plan-sha256 "$HANDOFF_ACTIVATE_PLAN_SHA256"
   ```

   The helper must prove all ten exact active repository identities, the three
   exact canonical workflows plus the manifest-bound quiesced scheduler,
   effective CODEOWNERS identities, complete Active repository
   v2 rulesets, open/non-draft/current-base canaries, exact v2 run/job
   receipts, latest successful legacy commit statuses, unmodified active
   repository legacy surfaces and the exact old organization rule before
   writing. Its successful readback is the double-protection handoff point:
   shared v2 is Active and shared v1 remains Active with its original
   eleven-repository legacy selector.

   Do not close a canary before `activate` completes and step 7 restores the
   scheduler after its successful post-write dual-enforcement readback. Later
   `derive-cutover`,
   `apply-repository-cleanup`, and `verify` use post-activation active-cohort
   snapshots and do not require reopening those PRs. They also do not require a current
   default-branch head equal to the historical canary base. Treat the canary
   receipt only as activation-bound evidence. Each later round instead reads
   the live default branch and proves the current control-plane/ruleset
   closure: exact repository identity; a complete regular-blob workflow
   inventory containing the three canonical workflows, the separately
   manifest-bound scheduler, and no extra producer; exact CODEOWNERS;
   default-read Actions policy with an explicit
   boolean `can_approve_pull_request_reviews`; Active repository and
   organization v2 rules; the temporary bridge; cleanup state; and the
   separately manifest-bound scheduler's live `active` state.
7. After `activate --apply` returns its successful dual-enforcement readback,
   preview and restore the scheduler. This is a separate mutation with its own
   plan digest; it is also the only normal recovery operation after deciding
   whether an interrupted activation reached dual enforcement.

   ```bash
   HANDOFF_RESTORE_PREVIEW="$(mktemp)"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode restore-scheduler > "$HANDOFF_RESTORE_PREVIEW"
   HANDOFF_RESTORE_PLAN_SHA256="$(jq -er \
     '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
     "$HANDOFF_RESTORE_PREVIEW")"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode restore-scheduler \
     --apply \
     --expected-plan-sha256 "$HANDOFF_RESTORE_PLAN_SHA256"
   ```

   An uncertain enable outcome is not retryable by replay: first reconcile the
   exact workflow state and follow its `recovery_code`.
8. Derive the cutover transaction read-only:

   ```bash
   HANDOFF_CUTOVER_PLAN="$(mktemp)"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode derive-cutover > "$HANDOFF_CUTOVER_PLAN"
   jq . "$HANDOFF_CUTOVER_PLAN"
   ```

   Review the manifest-bound `external_repository_actions`. Each action may
   remove only `codex/review-gate`; it must retain all non-legacy checks and
   strictness, ruleset identity and targets, bypass actors, `deletion`,
   `non_fast_forward` and unrelated rules. Do not execute the raw actions.
   Start the continuous cleanup-to-final-verify external policy-mutation
   freeze, then preview and run the controlled executor:

   ```bash
   HANDOFF_CLEANUP_PREVIEW="$(mktemp)"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode apply-repository-cleanup > "$HANDOFF_CLEANUP_PREVIEW"
   HANDOFF_CLEANUP_PLAN_SHA256="$(jq -er \
     '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
     "$HANDOFF_CLEANUP_PREVIEW")"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode apply-repository-cleanup \
     --apply \
     --expected-plan-sha256 "$HANDOFF_CLEANUP_PLAN_SHA256"
   ```

   Treat this as an operational freeze, not a continuous repository or API
   lock. From cleanup preview through final read-only `verify`, prohibit cohort
   repository rename, transfer, deletion, default-branch change, and
   replacement or re-creation at an original slug, as well as the listed
   policy mutations. GitHub cleanup mutation APIs have no repository-ID
   conditional/CAS write; this freeze covers the final
   repository-metadata-read-to-write gap.

   Before every cleanup surface GET—including initial classification, normal
   readback, and error reconciliation—require live GitHub metadata to match the
   manifest-bound `full_name`, `id`, `node_id`, and `default_branch`. For an
   item still requiring a write, repeat that identity check immediately before
   mutation, require exact `expected_before`, use the surface-specific
   mutation, and require exact `expected_after` readback. `id` and `node_id`
   bind the repository object; `full_name` binds its expected route and exposes
   rename, transfer, or slug reuse; `default_branch` binds the branch selector.
   The snapshots protect selected policy content. Ignore unrelated metadata
   churn. Any unreadable or mismatched identity stops the batch at that
   observation: a pre-mutation mismatch emits no write for the current action,
   and no later mutation runs. A stable mix of before and after items is
   resumable: already-after items are no-ops, and a fresh preview plans only
   still-before items. If any mutation reports an error or an unknown outcome,
   the executor performs a narrow read-only reconciliation first. Exact
   after-state is completed; before-state, drift or an unreadable result stops
   the batch. Run a fresh preview under the freeze and review that state; never
   replay the old request or digest blindly. Stop before organization cutover
   unless every action is at exact `expected_after`.
9. Preview and apply final organization cutover:

   ```bash
   HANDOFF_VERIFY_PREVIEW="$(mktemp)"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode verify > "$HANDOFF_VERIFY_PREVIEW"
   HANDOFF_VERIFY_PLAN_SHA256="$(jq -er \
     '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
     "$HANDOFF_VERIFY_PREVIEW")"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode verify \
     --apply \
     --expected-plan-sha256 "$HANDOFF_VERIFY_PLAN_SHA256"
   HANDOFF_FINAL_VERIFY=/absolute/path/to/final-read-only-verify.json
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode verify > "$HANDOFF_FINAL_VERIFY"
   jq -e '
     .schema_version == "organization-review-gate-handoff-output/v2" and
     .mode == "verify" and
     .status == "final-verified" and
     .applied == false and
     .action == null and
     .final_closure_receipt.schema_version == 2 and
     (.final_closure_receipt_sha256 | test("^[0-9a-f]{64}$"))
   ' "$HANDOFF_FINAL_VERIFY"
   HANDOFF_FINAL_CLOSURE_RECEIPT_SHA256="$(jq -er \
     '.final_closure_receipt_sha256 | select(test("^[0-9a-f]{64}$"))' \
     "$HANDOFF_FINAL_VERIFY")"
   ```

   `verify --apply` is the only helper operation allowed to change the old
   organization ruleset. It removes the entire legacy-only required-status
   rule and must retain that ruleset's ID, name, original eleven-repository
   selector in `conditions`, enforcement, bypass actors, `deletion`,
   `non_fast_forward` and every other field. It never deletes the ruleset.
   Keep the external policy-mutation freeze in force beyond that apply/readback
   through a distinct final read-only `verify`, because the control plane can
   drift after the mutating command's `applied-final-verified` boundary. Admit
   only an output with top-level
   `schema_version: "organization-review-gate-handoff-output/v2"`,
   `mode: "verify"`, `status: "final-verified"`, `applied: false`, and
   `action: null`, plus `final_closure_receipt.schema_version: 2` and a
   lowercase 64-hex `final_closure_receipt_sha256`. The embedded receipt must
   bind the organization, reviewed manifest digest, final snapshot digest,
   legacy/v2 ruleset IDs and states, and the fixed complete ten-repository
   active v2 cohort twice. `manifest_repositories` is derived from the reviewed
   manifest; `repositories` is the stable observed identity list. Both contain
   `full_name`, `id`, `node_id`, and `default_branch` in canonical UTF-8-byte
   `full_name` order and must be exactly equal entry by entry—never a subset or
   expanded active cohort. For this rollout, either list is rejected if it
   contains archived `Joey-Tools/codex-waited-delivery` by case-insensitive
   slug, numeric ID, or node ID, so the archive cannot enter an active receipt
   list. The separate old selector remains the original eleven repositories,
   but it does not confer final-closure receipt membership or bridge-removal
   authority. Its top-level `plan_sha256` must exactly bind the final read-only
   `verify` plan (`mode`, manifest digest, snapshot digest, and `action: null`).
   Preserve the complete JSON output in `HANDOFF_FINAL_VERIFY`; an extracted
   embedded receipt is not a valid input to the bootstrap.

   The third freeze ends only after that file and its top-level shape have
   been validated. If this read is inconclusive or any bound policy differs,
   keep every bridge, resolve the drift, and repeat the final read-only verify
   under the freeze. If a known organization/repository policy mutation occurs
   after capture but before removal preparation, discard the old proof and
   mint a fresh final read-only output under a new freeze. Never substitute
   the `verify --apply` response or reuse a known-stale receipt.
10. Only after step 9 closes successfully, prepare a separate bridge-removal PR
   in every active cohort member from a clean worktree. Do not prepare one for
   the archived legacy-only repository:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --remove-legacy-bridge \
     --final-closure-receipt "$HANDOFF_FINAL_VERIFY" \
     --expected-final-closure-receipt-sha256 \
     "$HANDOFF_FINAL_CLOSURE_RECEIPT_SHA256" \
     --control-plane-owner "$CONTROL_PLANE_OWNER"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --remove-legacy-bridge \
     --final-closure-receipt "$HANDOFF_FINAL_VERIFY" \
     --expected-final-closure-receipt-sha256 \
     "$HANDOFF_FINAL_CLOSURE_RECEIPT_SHA256" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --apply
   ```

   `--final-closure-receipt` takes the complete final read-only verify output,
   despite the singular option name. The bootstrap validates its terminal
   top-level fields, recomputes the canonical embedded receipt digest, compares
   the explicit expected SHA-256, parses the target worktree's unambiguous
   GitHub `origin`, and reads live repository metadata from GitHub. It requires
   exact `full_name`, `id`, `node_id`, and `default_branch` equality with one
   entry in the fixed ten-member manifest-derived `manifest_repositories`
   cohort. The observed `repositories` list is independently checked for exact
   equality but is not an authorization source. The archived legacy-only
   repository is deliberately absent, so it cannot authorize bridge removal.
   At the pre-rename boundary it reads `origin` before and after the live-
   metadata query, repeats the local object checks, then reads `origin` once
   more immediately before the atomic bridge quarantine rename. After the
   rename and before unlink, it repeats the complete `origin` -> live metadata
   identity/default-branch -> `origin` check, then revalidates the quarantined
   file's admitted object identity and canonical content. If that remote
   binding check fails, it attempts to restore the same admitted bridge to the
   canonical path with no-clobber hard-link creation. An occupied destination
   or failed restoration verification fails closed, never overwrites the
   occupant, and reports no removal success. These are point-in-time remote
   binding and local identity/content checks, not a continuous lock. Do not
   edit the receipt, change `origin`, or bypass this proof.

   An absent bridge makes the bridge-removal component an idempotent no-op. An
   existing non-canonical bridge is rejected. The command as a whole also
   enforces the canonical verifier, controller and managed CODEOWNERS block;
   `--apply` repairs drift in any of those surfaces even when the bridge is
   already absent. Before applying, verify them independently and inspect the
   dry run. If it proposes anything other than bridge removal, stop and
   resolve or separately review the drift rather than treating the change as
   a bridge-only PR. After merge, run the ordinary bootstrap and inventory
   checks without `--legacy-bridge`; any remaining v1 caller is a failure.

Every ordinary authoritative helper success boundary reads a complete snapshot,
waits five seconds and reads it again. A selected evidence or policy difference
restarts the pair. Activation uses the manifest-bound capacity contract instead
of a generic 60-second cap: 900 seconds for one repository's legacy evidence,
1,200 seconds for every complete repository-evidence read, 120 seconds for
every scheduler snapshot (including the activation preflight), and 120 seconds
for organization evidence. One full-cohort coverage round has a 9,000-second
cap. Its successful topology is explicitly bounded at 8,340 seconds:
`2,100 + 2 * 120 + max(120, ceil(10 / 2) * 1,200)`. The scheduler drain and
its two state snapshots finish first; organization evidence then runs in
parallel with five two-repository evidence waves. The remaining 660 seconds
are intentional slack. A two-round stable pair has an 18,005-second cap: two
rounds plus its five-second interval. Pre-write and post-write stable coverage
use both bounds: each coverage round independently has the round cap, and the
complete pair has the pair cap. Immediate revalidation uses only the round cap.
This prevents one overlong round from consuming the pair budget and extending
the scheduler's `disabled_manually` state. Every scheduler snapshot,
repository-evidence read, and organization-evidence read has an independently
enforced deadline.

After scheduler evidence completes, the organization and repository branches
run concurrently. If either branch fails, retain the first observed error but
wait for the sibling branch and every already-started repository worker to
finish before returning. An early organization failure can therefore wait for
the remaining bounded repository phase; this intentional fail-closed draining
prevents stale reads from overlapping a later recovery attempt.

The workflow YAML inventory, Actions workflow inventory, and local repository
ruleset inventory each have a hard 32-entry admission cap. An excess is
inconclusive and fails closed. Do not infer a hard number of HTTP pagination
requests from that admission cap: the phase deadline is the wall-clock boundary
for a paginated GitHub read. A reviewed deployment manifest may raise soft
limits only within 1,800 seconds per repository, 300 seconds per scheduler
snapshot, 600 seconds for organization evidence, 15,000 seconds per round, and
30,005 seconds per stable pair, while still satisfying the topology formula.
These are upper capacity limits, not the total `activate` wall-clock or a
GitHub Actions-minutes-free promise: normal execution ends when its actual
reads finish. No capacity limit permits incomplete pagination or a changed
execution epoch. Expiry or changed evidence is inconclusive and sends no next
write; read the `recovery_code`, then take the relevant fresh preview. Never
disable v2 or delete the old organization rule as recovery.

## Phase 1: prepare and merge one migration PR

1. Resolve and record the default branch:

   ```bash
   DEFAULT_BRANCH="$(gh api --hostname github.com \
     "repos/$REPO" \
     --jq '.default_branch')"
   test -n "$DEFAULT_BRANCH"
   ```

2. Perform a read-only preflight of the repository's default workflow
   permissions before changing the worktree:

   ```bash
   DEFAULT_WORKFLOW_PERMISSIONS="$(gh api --hostname github.com \
     "repos/$REPO/actions/permissions/workflow" \
     --jq '.default_workflow_permissions')"
   test "$DEFAULT_WORKFLOW_PERMISSIONS" = read
   ```

   A missing, unreadable, or non-`read` value is a stop condition. Do not
   silently change it as part of this installation. Obtain separate
   authorisation to set the default workflow permissions to read-only, then
   read the endpoint back and restart this preflight.

3. Create `INSTALL_BRANCH` from the latest `DEFAULT_BRANCH` in `TARGET_ROOT`.
4. Preview and apply both canonical consumer workflows:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --control-plane-owner "$CONTROL_PLANE_OWNER"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --apply
   ```

   The helper revalidates the target workflow parents at explicit checkpoints.
   This is not an operation-bound filesystem sandbox: a hostile same-UID
   process can still race path-based operations between checkpoints. Stop on a
   safety failure; never replace the helper with a manual copy. Proceed only
   when untrusted processes cannot concurrently modify those parent
   directories.

   If the helper reports a root `CODEOWNERS` or `docs/CODEOWNERS`, stop and
   move or merge every existing entry into `.github/CODEOWNERS` in this same
   PR. Rerun the helper; never allow the new higher-precedence file to shadow
   an unmerged policy.

5. If the helper reports other v1 callers, inspect only the reported workflow
   paths. Remove a file only when it is dedicated to v1; otherwise remove or
   deactivate the legacy job. Repeat the preview until no v1 caller remains.
6. Prove that both installed workflows exactly match the templates, then read
   the final effective CODEOWNERS rules:

   ```bash
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate.yml"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate-controller.yml"
   tail -n 4 "$TARGET_ROOT/.github/CODEOWNERS"
   ```

7. Require the CODEOWNERS suffix to protect `/.github/workflows/` and
   `/.github/CODEOWNERS` with only `CONTROL_PLANE_OWNER`. Review the complete
   diff, run the consumer repository's required checks, commit, push, and open
   one migration PR. The PR may contain v1 removal, v2 installation, and the
   CODEOWNERS merge.
8. Before requesting owner approval, run the tracked executable
   `$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh`. It accepts
   exactly repository, expected default branch, and output path; do not
   reconstruct it from this guide. Capture its digest output:

   ```bash
   APPROVAL_INVENTORY_DIR="$(mktemp -d)"
   APPROVAL_INVENTORY="$APPROVAL_INVENTORY_DIR/legacy-inventory.json"
   LEGACY_INVENTORY_SHA256="$("$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
     "$REPO" "$DEFAULT_BRANCH" "$APPROVAL_INVENTORY")"
   LEGACY_INVENTORY_SHA256="${LEGACY_INVENTORY_SHA256#LEGACY_INVENTORY_SHA256=}"
   printf 'LEGACY_INVENTORY_SHA256=%s\n' "$LEGACY_INVENTORY_SHA256"
   ```

   Record the canonical JSON and printed SHA-256 in the approval snapshot.
   Keep every inventoried legacy requirement active through migration merge.
9. Treat the first approval as a manual trust-bootstrap gate. The base branch
   does not yet contain the new CODEOWNERS rules and the new ruleset is still
   absent, so GitHub cannot enforce this first owner approval for you. Require
   `CONTROL_PLANE_OWNER` to be different from the PR author, then prove that
   the owner's latest review is an `APPROVED` review bound to the current head:

   ```bash
   CONTROL_PLANE_LOGIN="${CONTROL_PLANE_OWNER#@}"
   MIGRATION_HEAD="$(gh pr view "$MIGRATION_PR" \
     --repo "github.com/$REPO" \
     --json headRefOid,state,isDraft \
     --jq 'if .state == "OPEN" and (.isDraft | not) then .headRefOid else error("migration PR is not open and ready") end')"
   REVIEW_PAGES="$(mktemp)"
   gh api --hostname github.com --paginate --slurp \
     "repos/$REPO/pulls/$MIGRATION_PR/reviews?per_page=100" \
     > "$REVIEW_PAGES"
   jq -e \
     --arg owner "$CONTROL_PLANE_LOGIN" \
     --arg head "$MIGRATION_HEAD" \
     '[.[][] | select((((.user.login? // "") | ascii_downcase) == ($owner | ascii_downcase)) and .user.type == "User")]
      | sort_by([.submitted_at, .id])
      | last
      | .state == "APPROVED" and ((.commit_id | ascii_downcase) == ($head | ascii_downcase))' \
     "$REVIEW_PAGES"
   rm -f "$REVIEW_PAGES"
   test "$(gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" --json headRefOid --jq .headRefOid)" = "$MIGRATION_HEAD"
   ```

   Stop if `jq -e` fails, the owner is the PR author, the head changes, or a
   later owner review is not an exact-head approval. Do not merge on prose or
   a stale UI indication.
   This migration PR is a manual trust bootstrap, not its own v2 canary. After
   it merges, every pre-existing open PR needs a fresh verifier for its current
   head/base/test-merge scope before v2 becomes required: push a new head,
   reopen it, or use the documented draft-to-ready transition. `reconcile` can
   rerun an existing exact verifier but deliberately cannot create one for an
   arbitrary pre-installation PR.
10. Preserve the exact `MIGRATION_HEAD` and approval snapshot from step 9.
   Keep every legacy requirement active until merge so later failure remains
   fail closed. The canonical read-only inventory and its SHA-256 were recorded
   before owner approval by step 8.
   It binds the exact repository slug, numeric repository ID, opaque node ID,
   and default branch; every matching ruleset's ID, name,
   source, enforcement, target, conditions, complete `bypass_actors`, and
   complete `rules`; the complete matching effective
   `required_status_checks` rule with all parameters; and the complete classic
   required-status object, including `strict` and each check's producer
   `app_id`, or explicit null. The producer and runtime call the same Node
   canonicalizer. Before hashing, it sorts semantically unordered
   bypass/check/context arrays and condition include/exclude sets. Even an
   empty legacy inventory has a digest bound to this repository/default
   branch. An incomplete API response or schema is inconclusive, and any drift
   fails closed. A successful empty or JSON `null` classic response is
   inconclusive; only a recognised absence response becomes canonical null.
   Inject the owner-approved digest externally as
   `LEGACY_INVENTORY_SHA256`; there is no default. Preserve and reuse that same
   cross-process baseline for every Disabled staging and activation
   preview/apply through the canary and exact Active readback. A new helper
   process must not establish a new baseline.

   Run the final gate and sole merge mutation in one fail-fast transaction:

   ```bash
   (
     set -euo pipefail
     MIGRATION_PR=PR_NUMBER
     MIGRATION_HEAD=FULL_HEAD_SHA_FROM_APPROVAL_SNAPSHOT
     MERGE_METHOD=REPOSITORY_APPROVED_METHOD
     CONTROL_PLANE_LOGIN="${CONTROL_PLANE_OWNER#@}"
     case "$MERGE_METHOD" in
       merge|squash|rebase) ;;
       *) printf 'unsupported or unset repository merge method\n' >&2; exit 1 ;;
     esac
     TXN_DIR="$(mktemp -d)"
     PR_STATE="$TXN_DIR/pr.json"
     FINAL_REVIEW_PAGES="$TXN_DIR/reviews.json"
     MERGE_BODY="$TXN_DIR/merge-body.json"
     MERGE_RESPONSE="$TXN_DIR/merge-response.json"
     POST_MERGE_STATE="$TXN_DIR/post-merge.json"
     LEGACY_INVENTORY="$TXN_DIR/legacy-inventory.json"
     cleanup() {
       rm -f "$PR_STATE" "$FINAL_REVIEW_PAGES" "$MERGE_BODY" \
         "$MERGE_RESPONSE" "$POST_MERGE_STATE" "$LEGACY_INVENTORY"
       rmdir "$TXN_DIR" 2>/dev/null || true
     }
     trap cleanup EXIT
     trap 'exit 130' HUP INT TERM

     DEFAULT_BRANCH_FRESH="$(gh api --hostname github.com \
       "repos/$REPO" --jq '.default_branch')"
     test "$DEFAULT_BRANCH_FRESH" = "$DEFAULT_BRANCH"
     "$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
       "$REPO" "$DEFAULT_BRANCH_FRESH" "$LEGACY_INVENTORY" > /dev/null
     FRESH_LEGACY_INVENTORY_SHA256="$(node -e '
       const crypto=require("node:crypto"); const fs=require("node:fs");
       process.stdout.write(crypto.createHash("sha256")
         .update(fs.readFileSync(process.argv[1])).digest("hex"));' "$LEGACY_INVENTORY")"
     test "$FRESH_LEGACY_INVENTORY_SHA256" = \
       "${LEGACY_INVENTORY_SHA256:?external approval-snapshot digest is required}"

     gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" \
       --json author,baseRefName,headRefOid,state,isDraft > "$PR_STATE"
     jq -e --arg base "$DEFAULT_BRANCH_FRESH" --arg head "$MIGRATION_HEAD" \
       --arg owner "$CONTROL_PLANE_LOGIN" \
       '.baseRefName == $base and .headRefOid == $head and .state == "OPEN" and (.isDraft | not)
        and (((.author.login // "") | ascii_downcase) != ($owner | ascii_downcase))' \
       "$PR_STATE"
     CURRENT_ACTOR="$(gh api --hostname github.com user --jq '.login')"
     jq -ne --arg actor "$CURRENT_ACTOR" --arg owner "$CONTROL_PLANE_LOGIN" \
       '($actor | ascii_downcase) == ($owner | ascii_downcase)'
     gh api --hostname github.com --paginate --slurp \
       "repos/$REPO/pulls/$MIGRATION_PR/reviews?per_page=100" \
       > "$FINAL_REVIEW_PAGES"
     jq -e --arg owner "$CONTROL_PLANE_LOGIN" --arg head "$MIGRATION_HEAD" \
       '[.[][] | select((((.user.login? // "") | ascii_downcase) == ($owner | ascii_downcase)) and .user.type == "User")]
        | sort_by([.submitted_at, .id]) | last
        | .state == "APPROVED" and ((.commit_id | ascii_downcase) == ($head | ascii_downcase))' \
       "$FINAL_REVIEW_PAGES"

     jq -n --arg sha "$MIGRATION_HEAD" --arg method "$MERGE_METHOD" \
       '{sha:$sha, merge_method:$method}' > "$MERGE_BODY"
     gh api --hostname github.com --method PUT \
       "repos/$REPO/pulls/$MIGRATION_PR/merge" \
       --input "$MERGE_BODY" > "$MERGE_RESPONSE"
     jq -e '.merged == true' "$MERGE_RESPONSE"
     test "$(gh api --hostname github.com "repos/$REPO" --jq '.default_branch')" = \
       "$DEFAULT_BRANCH_FRESH"
     gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" \
       --json baseRefName,headRefOid,state,mergedAt > "$POST_MERGE_STATE"
     jq -e --arg base "$DEFAULT_BRANCH_FRESH" --arg head "$MIGRATION_HEAD" \
       '.state == "MERGED" and .mergedAt != null and .baseRefName == $base
        and ((.headRefOid | ascii_downcase) == ($head | ascii_downcase))' \
       "$POST_MERGE_STATE"
   )
   ```

   Every precondition precedes the synchronous merge mutation. Any API, `jq`,
   `test`, pagination, parse, actor, base, head, state, or review failure exits
   and the trap cleans the temporary files. The REST endpoint merges
   immediately or fails, including 405/409; it cannot enqueue. Do not use
   `gh pr merge`, auto-merge, merge queue, or admin bypass. The current actor
   must be the trusted owner and performs the direct merge immediately after
   fresh review readback; GitHub has no atomic review-state-plus-head CAS, and
   a head-only reread is insufficient.

   After the immediate post-merge current-default/base/head/merged readback
   succeeds, keep both legacy surfaces unchanged and active. Stage a separate
   v2 ruleset as Disabled, canary it while legacy still blocks merges, then
   activate v2 and require an exact complete Active readback. Only then execute
   the separately authorised legacy-removal plan and read both legacy surfaces
   back. Temporary dual enforcement is expected; zero enforcement is forbidden.

11. Read the merge back, then fetch the default branch and repeat the byte
   comparison against the merged file. Also re-read the final effective
   CODEOWNERS block and explicit owner:

   ```bash
   gh pr view "$MIGRATION_PR" \
     --repo "github.com/$REPO" \
     --json state,mergedAt,headRefOid \
     | jq -e --arg head "$MIGRATION_HEAD" \
       '.state == "MERGED" and .mergedAt != null and ((.headRefOid | ascii_downcase) == ($head | ascii_downcase))'
   git -C "$TARGET_ROOT" fetch origin "$DEFAULT_BRANCH"
   MERGED_VERIFIER="$(mktemp)"
   MERGED_CONTROLLER="$(mktemp)"
   git -C "$TARGET_ROOT" show \
     "FETCH_HEAD:.github/workflows/codex-review-gate.yml" \
     > "$MERGED_VERIFIER"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml" \
     "$MERGED_VERIFIER"
   git -C "$TARGET_ROOT" show \
     "FETCH_HEAD:.github/workflows/codex-review-gate-controller.yml" \
     > "$MERGED_CONTROLLER"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml" \
     "$MERGED_CONTROLLER"
   rm -f "$MERGED_VERIFIER" "$MERGED_CONTROLLER"
   git -C "$TARGET_ROOT" show \
     "FETCH_HEAD:.github/CODEOWNERS" \
     | tail -n 4
   ```

The canonical workflows must have this contract after the merge:

- `JoeyTeng/codex-review-gate-action@v2`; a prerelease selector is never an
  installation value. The sole exception is the release operator's temporary
  RC admission bridge in [`RELEASING.md`](../RELEASING.md), including its
  installed-consumer and fresh-fixture forms; neither is an installation or
  activation path;
- verifier path `.github/workflows/codex-review-gate.yml`, workflow name
  `Codex Review Gate Verifier`, `pull_request` types `opened`, `reopened`,
  `synchronize`, `ready_for_review`, and required job
  `codex/github-review-gate` on the exact PR feature-head SHA;
- controller path `.github/workflows/codex-review-gate-controller.yml`, workflow
  name `Codex Review Gate Controller`, exact Codex `issue_comment` `created`,
  and default-branch `workflow_dispatch`. An edited comment does not allocate a
  runner; use protected manual `reconcile` if it needs evaluation. It intentionally
  excludes `pull_request_review`: GitHub binds review events to the PR merge
  ref, so a controller with narrow write authority must not execute that
  ref. Reconcile review- or reaction-only evidence through the protected
  default-branch dispatch instead;
- exact pre-runner sender and author checks for
  `chatgpt-codex-connector[bot]` with type `Bot`;
- `workflow_dispatch` as the only manual trigger, with `operation`,
  `pr_number`, `expected_head_sha`, optional `request_comment_id`,
  and `request_review` defaulting to `true`; no dispatch limits profile;
- `ubuntu-slim` by default, with only
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` selecting `ubuntu-latest`;
- separate verifier/controller concurrency namespaces; verifier latest-wins
  cancellation and non-cancelling controller operations;
- no cron, `repository_dispatch`, `pull_request_target`, writable
  `pull_request_review`, status bridge, runtime App, or ledger.

Canonical workflows set
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any` directly. This accepts an
already-observed exact ordinary request author at any repository permission as
a candidate without a collaborator lookup. It becomes a generation boundary
only after the official Codex Bot directly adds a strictly post-revision
`eyes` or `+1` receipt to that same comment. It does not grant the commenter
permission to invoke Codex or ensure that Codex starts; provider-side
eligibility and delivery remain independent, and an unconfirmed candidate
cannot preempt an existing clean. Do not add the nonstandard
`write`/`maintain`/`admin` policy to an ordinary consumer: it
needs a verifier identity allowed to read collaborator permissions, which the
bundled read-only verifier token cannot reliably do. The setting never makes a
qualifying Codex finding non-blocking.

The controller Action step must use underscore input names:
`github_token`, `pr_number`, `expected_head_sha`, `operation`,
`request_comment_id`, and `request_review`. Both Action steps derive
`limits_profile=default|expanded` from protected repository variable
`CODEX_REVIEW_GATE_LIMITS_PROFILE`. Their public outputs
are exactly `execution_health`, `gate_outcome`, `recovery_code`, and
`retry_safe`. Treat finding counts as summary/sticky diagnostics, never as
outputs.

## Phase 2: stage and verify the disabled ruleset

Run staging only after both canonical workflows are on `DEFAULT_BRANCH`:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --apply
```

The expected staged object is
`templates/codex-gated-repo/rulesets/codex-review-gate.json`. Re-read the
repository rulesets and require exactly one intended gate ruleset with all of
these properties:

```text
target coverage: a new ruleset is exactly the default branch; an existing same-name branch ruleset may preserve broader include/exclude conditions, which must be reviewed explicitly
enforcement: disabled
required context: codex/github-review-gate
expected source: GitHub Actions
expected source integration_id: 15368
strict up-to-date: true
code-owner review: true
dismiss stale reviews on push: true
ordinary approving review count: 0 for a new ruleset; preserve any existing higher count
all review conversations resolved: true
non-fast-forward default-branch updates blocked: true
bypass actors: empty
```

For an existing same-name ruleset, require that it covers `DEFAULT_BRANCH`,
then inspect every preserved additional include/exclude target and confirm it
is intended. Do not report broader preserved coverage as though the helper had
narrowed it to the default branch.

Require the helper's legacy inventory to cover both effective repository
rulesets and classic branch protection required-status contexts. Preserve every
active inherited, separately managed, or classic `codex/review-gate`
requirement through Disabled staging, canary, activation, and exact Active
readback. Every preview and apply must compare the complete canonical
dual-surface inventory with the same owner-approved digest; repository/default
branch drift, any ruleset-policy or classic-producer change, and API/schema
incompleteness are inconclusive and fail closed. The helper must permit this
overlap without mutating those legacy surfaces. If an active legacy or
incomplete ruleset already has the selected v2 name, stop with no write and
select a distinct `V2_RULESET_NAME`. Every
staging, activation, and final probe command already passes that variable;
never omit it. Treat an API/schema failure or overlap drift as inconclusive,
not absent. Do not activate v2 before the canary passes, and do not remove
legacy before v2 is Active and read back.

## Phase 3: create the separate canary PR

1. From the merged `DEFAULT_BRANCH`, create a temporary branch with one
   harmless, reviewable change. Push it and open a non-draft PR.
2. Record the authoritative PR number, base, and exact `headRefOid` as the full
   head SHA:

   ```bash
   CANARY_PR="$(gh pr view CANARY_SELECTOR \
     --repo "github.com/$REPO" \
     --json number \
     --jq '.number')"
   CANARY_BASE="$(gh pr view "$CANARY_PR" \
     --repo "github.com/$REPO" \
     --json baseRefName \
     --jq '.baseRefName')"
   CANARY_HEAD="$(gh pr view "$CANARY_PR" \
     --repo "github.com/$REPO" \
     --json headRefOid \
     --jq '.headRefOid')"
   CANARY_HEAD_REPO="$(gh api --hostname github.com \
     "repos/$REPO/pulls/$CANARY_PR" \
     --jq '.head.repo.full_name')"
   CANARY_HEAD_REF="$(gh api --hostname github.com \
     "repos/$REPO/pulls/$CANARY_PR" \
     --jq '.head.ref')"
   test "$CANARY_BASE" = "$DEFAULT_BRANCH"
   test "${#CANARY_HEAD}" -eq 40
   test "$CANARY_HEAD_REPO" = "$REPO"
   test -n "$CANARY_HEAD_REF"
   ```

3. Prefer a direct exact request. This path does not allocate a gate runner
   merely to ask for review:

   ```bash
   REQUEST_COMMENT_ID="$(gh api --hostname github.com \
     --method POST \
     "repos/$REPO/issues/$CANARY_PR/comments" \
     -f body='@codex review' \
     --jq '.id')"
   test -n "$REQUEST_COMMENT_ID"
   ```

   Before posting, prove that no controller `begin-review` with
   `request_review=true` is already active for `CANARY_HEAD` and that no
   matching canonical hidden marker exists. Do not race a controller-owned
   request with this low-cost path.

   Do not add prose to the request. GitHub may persist this one-line direct
   request with exactly one terminal LF or CRLF; those two storage forms are
   equivalent to exact `@codex review`. Do not accept or emit any other
   whitespace, visible text, or hidden comment. A qualifying Codex bot `issue_comment`
   `created` event will wake the installed workflow. Editing an existing comment
   does not; use manual `reconcile` when that carrier needs a later evaluation.
   A review or reaction alone does not have an automatic consumer job. Treat
   this direct comment as only a candidate until the official Codex Bot adds a
   strictly post-revision `eyes` or `+1` reaction directly to it; a terminal
   elsewhere on the PR is not a substitute for that receipt.

   ### Dual-protection legacy-status recovery

   A manual v2 `reconcile` updates only `codex/github-review-gate`; it never
   writes `codex/review-gate`. While both contexts remain required, a review-
   or reaction-only result can therefore require a separate v1 recovery. First
   use the REST API to bind one complete current scope. `GET repos/$REPO` must
   still return `full_name=$REPO` and a positive `id`; bind that ID as
   `REPOSITORY_ID`, its `default_branch` as `DEFAULT_BRANCH`, and
   `DEFAULT_BRANCH_HEAD_SHA` from the corresponding
   `GET repos/$REPO/branches/$DEFAULT_BRANCH` response. The fresh
   `GET repos/$REPO/pulls/$CANARY_PR` response must be open, non-draft, and
   same-repository, with its head repository/ref/SHA equal to `$REPO`,
   `CANARY_HEAD_REF`, and `CANARY_HEAD` and its base repository/ref/SHA equal
   to `$REPO`, `DEFAULT_BRANCH`, and `DEFAULT_BRANCH_HEAD_SHA`.

   Resolve the current bridge with
   `GET repos/$REPO/actions/workflows/codex-review-gate-legacy-bridge.yml`,
   bind its positive `LEGACY_WORKFLOW_ID`, and verify it again with
   `GET repos/$REPO/actions/workflows/$LEGACY_WORKFLOW_ID`. Require the same
   ID, exact path `.github/workflows/codex-review-gate-legacy-bridge.yml`, and
   `state=active`; the display name is diagnostic, not identity. Read
   `GET repos/$REPO/contents/.github/workflows/codex-review-gate-legacy-bridge.yml?ref=$DEFAULT_BRANCH_HEAD_SHA`,
   require `type=file` and the exact path, decode its base64 content, and
   compare the bytes exactly with
   `$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-legacy-bridge.yml`.
   Missing, truncated, undecodable, or different content is inconclusive.

   List runs from
   `GET repos/$REPO/actions/workflows/$LEGACY_WORKFLOW_ID/runs` with
   `event=pull_request_target`, `head_sha=$CANARY_HEAD`,
   `exclude_pull_requests=false`, and `per_page=100`. Follow every pagination
   link. This must be a complete paginated workflow-run inventory: every page
   has the same nonnegative `total_count`, every non-final page is full, and
   the flattened run count equals `total_count`. Reject a malformed run, any
   duplicate run ID across pages, or a result that reaches GitHub's documented
   1,000-result filtered-search ceiling; none of those conditions proves an
   empty set. Then immediately reread page 1 with the identical query and
   require its canonical JSON, including `total_count` and ordered runs, to
   equal the captured first page. A changed pagination horizon invalidates the
   whole read; restart from the scope binding instead of mixing pages from
   different horizons.

   From that full stable inventory, a run is eligible only when its API
   `created_at` proves that it is still inside GitHub's documented 30-day
   rerun window, it is completed, and its REST object has all of the following:
   the bound positive `workflow_id` and
   positive `run_attempt`; `repository.full_name` and
   `head_repository.full_name` equal to `$REPO` and their IDs equal
   `REPOSITORY_ID`; `event=pull_request_target`; `head_sha` equal to
   `CANARY_HEAD`; and exactly one `pull_requests` entry whose number, head/base
   ref and SHA, and nested head/base repository IDs equal the complete bound PR
   scope. The embedded Actions-run repository objects are minimal
   `{id,name,url}` references and may omit `full_name`; their positive ID must
   equal `REPOSITORY_ID`, rather than treating a missing name as a match. A
   matching nonterminal run is pending, not evidence of zero candidates. In the run
   object, `DEFAULT_BRANCH_HEAD_SHA` is bound only by
   `pull_requests[0].base.sha`; never compare the top-level `run.head_sha` to
   the default-branch SHA. For `path`,
   accept the bare canonical path, GitHub's documented
   `<canonical-path>@<DEFAULT_BRANCH>` form, or the equivalent
   `<canonical-path>@refs/heads/<DEFAULT_BRANCH>` form. Parse a suffixed form
   by removing the known canonical-path-plus-`@` prefix and treating the entire
   nonempty remainder as the ref; require that ref to equal either
   `$DEFAULT_BRANCH` or `refs/heads/$DEFAULT_BRANCH`, and reject every other
   path or ref. The bare form is valid only because the independent PR base
   repository/ref/SHA, feature-head `head_sha`, active workflow identity, and
   exact bridge-byte checks supply the missing ref binding.

   These repository, branch, PR, workflow, canonical-byte, and stable
   paginated-inventory values are the **recovery binding set** (the complete
   state that selection and both sides of the write must revalidate).

   Classify the complete eligible set by cardinality. Exactly one candidate
   may proceed; set `LEGACY_RUN_ID` and `LEGACY_RUN_ATTEMPT` from its `id` and
   `run_attempt`. More than one is inconclusive even if one is newer: stop
   rather than choosing the latest. Only cardinality zero after a complete
   stable read permits the draft-to-ready fallback below. Missing fields, a
   pagination cap, duplicate IDs, horizon drift, or unreadable scope is
   inconclusive, never zero.

   Immediately before the write, repeat the repository, default-branch head,
   PR, active workflow, exact bridge bytes, complete run pagination,
   duplicate-ID check, and page-1 horizon reread. Require the same recovery
   binding set and exactly one candidate with the same `LEGACY_RUN_ID` and
   `LEGACY_RUN_ATTEMPT`. Also completely paginate and horizon-stabilize
   `GET repos/$REPO/commits/$CANARY_HEAD/statuses?per_page=100`, reject
   duplicate status IDs, and record every pre-POST status ID plus the current
   first reverse-chronological exact-context `codex/review-gate` status. This
   is the final pre-POST recovery binding-set read.

   Re-run that exact pre-existing bridge run, never a different v1 workflow.
   Before the write, set `LEGACY_RERUN_RECEIPT` to an operator-retained,
   transaction-specific path that does not exist. Keep that exact path; never
   select a new path to retry the mutation. The no-clobber response-file creation
   prevents this block from silently overwriting an earlier receipt:

   ```bash
   : "${LEGACY_RERUN_RECEIPT:?set an operator-retained recovery receipt path}"
   if test ! -e "$LEGACY_RERUN_RECEIPT"; then
     :
   else
     printf 'recovery receipt already exists; do not submit the POST: %s\n' \
       "$LEGACY_RERUN_RECEIPT" >&2
     exit 1
   fi
   if (
     umask 077
     set -C
     gh api --hostname github.com \
       --include \
       --header "X-GitHub-Api-Version: 2026-03-10" \
       --method POST \
       "repos/$REPO/actions/runs/$LEGACY_RUN_ID/rerun" \
       > "$LEGACY_RERUN_RECEIPT"
   ); then
     LEGACY_RERUN_GH_EXIT=0
   else
     LEGACY_RERUN_GH_EXIT=$?
   fi

   LEGACY_RERUN_HTTP_VERSION=
   LEGACY_RERUN_HTTP_STATUS=
   if IFS=$' \t\r' read -r LEGACY_RERUN_HTTP_VERSION LEGACY_RERUN_HTTP_STATUS _ \
     < "$LEGACY_RERUN_RECEIPT"; then
     :
   else
     printf 'rerun POST response is inconclusive; retain %s and do not replay\n' \
       "$LEGACY_RERUN_RECEIPT" >&2
     exit 1
   fi
   case "$LEGACY_RERUN_HTTP_VERSION" in
     HTTP/1.1|HTTP/2|HTTP/2.0|HTTP/3|HTTP/3.0) ;;
     *)
       printf 'rerun POST status line is inconclusive; retain %s and do not replay\n' \
         "$LEGACY_RERUN_RECEIPT" >&2
       exit 1
       ;;
   esac
   if test "$LEGACY_RERUN_GH_EXIT" -ne 0; then
     printf 'rerun POST did not prove HTTP 201; retain %s and do not replay\n' \
       "$LEGACY_RERUN_RECEIPT" >&2
     exit 1
   fi
   if test "$LEGACY_RERUN_HTTP_STATUS" = 201; then
     :
   else
     printf 'rerun POST did not prove HTTP 201; retain %s and do not replay\n' \
       "$LEGACY_RERUN_RECEIPT" >&2
     exit 1
   fi
   printf 'recovery receipt retained at %s (HTTP %s)\n' \
     "$LEGACY_RERUN_RECEIPT" "$LEGACY_RERUN_HTTP_STATUS"
   ```

   GitHub re-runs preserve the triggering run's `GITHUB_SHA` and `GITHUB_REF`;
   that preservation is why the selected run must bind the exact feature head
   and its embedded PR entry must separately bind the current default-branch
   repository/ref/SHA. `--include` puts the HTTP status line first in the
   retained response, and the fixed API-version header prevents API-version
   negotiation from changing this request. The parser accepts the status
   tokens emitted for HTTP/1.1, HTTP/2, and HTTP/3, extracts the second field,
   and requires exactly `201`. Retain even a partial or empty receipt as
   evidence of an inconclusive attempt; it can never prove success. A nonzero
   `gh` exit, missing or malformed first line, non-`201` status, or any other
   transport uncertainty is inconclusive: preserve the receipt and never
   submit the POST again. Submit the POST once.

   After the POST, poll the exact run ID to a terminal state, then revalidate
   the same recovery binding set, including the stable full run enumeration.
   Require the repository, default branch/ref/SHA, PR head/base scope, active
   workflow ID/path/state, canonical bridge bytes, and sole eligible run ID to
   be unchanged. The run must now have `run_attempt` exactly
   `LEGACY_RUN_ATTEMPT + 1`, `status=completed`, and `conclusion=success`.
   Finally, completely paginate
   `GET repos/$REPO/commits/$CANARY_HEAD/statuses?per_page=100`, reject
   duplicate status IDs, stabilize its page-1 horizon in the same way, and
   require the first reverse-chronological status with exact context
   `codex/review-gate` to have an ID absent from the complete pre-POST
   inventory, `state=success`, `creator.login=github-actions[bot]`, and
   `creator.type=Bot` on the still-current `CANARY_HEAD`. An old success is
   not rerun evidence. A timeout, unchanged or jumped attempt, changed scope,
   unstable/incomplete inventory, or nonunique candidate is inconclusive: do
   not submit the POST again.

   Only when the complete stable eligible set has cardinality zero (including
   when all otherwise matching runs are outside GitHub's rerun window),
   convert the PR to draft and mark it ready again to create a fresh
   `pull_request_target` lifecycle run. Rebind the complete recovery binding
   set and restart this selection procedure; do not reuse the earlier zero
   result. Do not add
   `workflow_dispatch`, `pull_request_review`, `pull_request_review_comment`,
   cron, or a new status writer to recover v1.

   On an unconfirmed default-`any` ordinary, unmarked request, an official
   direct strictly post-revision `eyes` or `+1` reaction is first its receipt:
   it promotes the candidate into a boundary. Afterwards, reactions are
   liveness-only. An ordinary `+1` cannot independently create head-bound
   clean evidence. An official Codex `eyes` reaction or progress artifact
   whose timestamp is the same as or later than candidate terminal clean
   evidence vetoes success. If that liveness change arrives without a later
   qualifying bot comment event, dispatch a manual exact-head `reconcile` to
   observe it.

   For predecessor-to-successor generation closure, liveness whose timestamp
   equals the successor request is also ambiguous and keeps the predecessor
   open. Evidence outside the original gap cannot repair it. A new head is a
   valid reset only when every ambiguous predecessor is explicitly bound to a
   different full head. An unconfirmed default-`any` ordinary candidate is not
   a predecessor. If any provider-confirmed ordinary, deleted, or otherwise
   unbound predecessor remains, open a replacement PR and run one canonical
   review generation there.

   Treat every physical request except an unconfirmed default-`any` ordinary
   candidate as a generation boundary. Without a base epoch, unbound provider
   terminal evidence can close only the first gap; once any predecessor exists,
   every later gap and positive/superseding authority require a qualifying `+1`
   directly on the corresponding canonical request.
   With a base epoch, every gap requires direct `+1` evidence. Never attribute
   a later terminal to a newer generation merely by timestamp; it may be a
   delayed or duplicate carrier from an older flight. Treat edited unbound
   provider-triggerable request shape as a physical boundary even when edited,
   malformed, wrong-author, denied, or stale-base; those conditions remove
   positive authority, not the possible provider flight. Explicit commit-bound
   progress is scoped to that head, while every unbound progress carrier stays
   in the current inventory. An edited terminal also contributes an unbound
   unknown-activity interval from creation through terminal revision. A
   provider terminal closes the first gap only when predecessor reactions were
   read completely and no current `eyes` or provider activity follows it
   through the successor.

   Before choosing this low-cost path, identify the native
   `codex/github-review-gate` verifier run/job/CheckRun that GitHub records
   against the exact current PR feature-head SHA, and require that run to be
   bound to the current test-merge. The
   workflow deliberately has no cron or writable review event. If this exact
   scope already has a successful verifier and the caller needs a deliberate
   same-head re-review, use step 4 `begin-review` first and require a strictly
   newer verifier attempt. Do not rely on a direct comment to atomically
   invalidate the old success.

   If a base retarget leaves no verifier for the current exact
   head/base/test-merge scope, follow
   `create_verifier_run`: for a ready PR, convert it to draft and mark it ready
   again; for an already-draft PR, mark it ready. Require a new
   `ready_for_review` verifier for that exact scope before reconciling.
   Rerunning the old event is not valid retarget recovery.

   If the controller summary reports a base epoch, base retarget, or
   `request_clean_generation`, do not treat the code alone as permission to
   post. Read its concrete reason, lineage and linked request objects:

   - If a recoverable latest/current canonical request already exists and only
     lacks attributable clean, stay on the original PR and exact head. Wait for
     a qualifying Codex `+1` directly on that named request, then reconcile;
     creating another request would add an unnecessary physical boundary.
   - If the reason says that no suitable latest/current canonical generation
     exists and reports no unclosable historical unbound predecessor gap,
     dispatch step 4 once with `request_review=true`, require a qualifying
     direct `+1` on the generated request, and then reconcile.
   - If a historical gap exists but every ambiguous predecessor is explicitly
     bound to another full head, create a legitimate new head and run exactly
     one canonical generation there.
   - If the reason identifies an unclosable historical gap containing a
     provider-confirmed ordinary, edited, malformed, denied, deleted, or
     otherwise unbound predecessor, do not post another direct or controller request on that
     PR/head and do not rely on a commit-only reset. Open a replacement PR from the intended
     branch/commits, run one canonical producer there, validate it, and close
     the ambiguous PR.

   A later terminal clean is not request/base-lineage proof in these modes and
   must not be treated as a pass; findings remain blocking.

4. Use `begin-review` instead of step 3 only when the controller must coordinate
   a fresh request and newer verifier attempt. This command block is only for
   the recoverable original-PR branches above; do not run it against a PR with
   an unclosable historical unbound predecessor gap. Dispatch it without
   `--ref`:

   ```bash
   DISPATCHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
   gh workflow run codex-review-gate-controller.yml \
     --repo "github.com/$REPO" \
     -f operation=begin-review \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=true
   ```

   `request_review=true` is the default, but pass it explicitly in an agent
   run. `request_review=false` is an advanced best-effort path; if used, wait
   for that controller run to complete before posting a new direct request.

   Never overlap the direct and controller producers for the same head. Each
   provider-confirmed request starts a review generation, while terminal Codex text has no
   originating request ID. If a newer request appears before the previous
   generation is terminally closed, v2 intentionally preserves an unclosed
   lineage gap and keeps the verifier pending; evidence arriving outside the
   original predecessor-to-successor window cannot repair that ordering. If
   every ambiguous predecessor is canonically bound to another full head,
   create a legitimate new head and allow exactly one canonical generation.
   An unconfirmed default-`any` ordinary candidate is not a predecessor. If any
   provider-confirmed ordinary, edited, malformed, denied, deleted, or otherwise
   unbound predecessor remains, open a replacement PR from the intended branch/commits,
   run one canonical generation there, validate it, and close the ambiguous
   PR.

5. After every manual dispatch, wait for GitHub to index the run and list only
   runs created after `DISPATCHED_AT`:

   ```bash
   gh run list \
     --repo "github.com/$REPO" \
     --workflow codex-review-gate-controller.yml \
     --event workflow_dispatch \
     --created ">=$DISPATCHED_AT" \
     --limit 20 \
     --json databaseId,event,headBranch,headSha,status,conclusion,createdAt,url
   ```

   Identify the just-dispatched run from its time and exact PR/head summary.
   If concurrent candidates make the identity ambiguous, stop and inspect them;
   do not guess or dispatch again. Require `event=workflow_dispatch` and
   `headBranch=$DEFAULT_BRANCH`. Record its run ID, URL, and default-branch
   `headSha`. Reject a feature-ref run.

## Phase 4: reconcile the exact head and interpret the result

1. Refresh `CANARY_HEAD`. If it changed, stop and reread the summary plus the
   complete physical lineage; do not automatically start another generation on
   the same PR. Continue on the new head only when every ambiguous predecessor
   is explicitly bound to a different full head. An unconfirmed default-`any`
   ordinary candidate is not a predecessor. If a provider-confirmed ordinary,
   edited, malformed, denied, deleted, or otherwise unbound predecessor leaves
   an unclosable historical gap, use a replacement PR as described above.
2. Dispatch a final exact-head reconcile without `--ref`:

   ```bash
   DISPATCHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
   gh workflow run codex-review-gate-controller.yml \
     --repo "github.com/$REPO" \
     -f operation=reconcile \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=false
   ```

   When a direct request ID is available, add
   `-f request_comment_id="$REQUEST_COMMENT_ID"`. It is a location hint, not
   authority. Repeat the Phase 3 run readback and again prove
   `headBranch=$DEFAULT_BRANCH`.

3. Wait for the selected run to finish. Read its job summary and record the
   four outputs:

   ```text
   execution_health
   gate_outcome
   recovery_code
   retry_safe
   ```

   Follow `recovery_code` and the summary's concrete next action for every
   non-success result. Findings normally produce a healthy failing gate; an
   unhealthy execution is a recovery problem, not a finding verdict.
   `healthy/pending` is fail-closed and cannot authorize success. Only
   `wait_provider` is a pure wait; every other recovery code requires the
   named action before a later exact-head reconcile. When derivable,
   `findings_unresolved`,
   `findings_resolved`, `findings_historical`, and `findings_indeterminate`
   appear only in the summary and sticky diagnostic.

4. If the summary directs use of the larger reviewed profile, persist only the
   protected named repository profile:

   ```bash
   gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
     --repo "github.com/$REPO" \
     --body expanded
   ```

   Then refresh `CANARY_HEAD` and dispatch one scoped controller reconcile.
   Manual dispatch has no profile input. Do not add page, object, attempt,
   timeout, or other numeric inputs.

5. If `ubuntu-slim` is unavailable for this repository, select the only
   supported runner fallback:

   ```bash
   gh variable set CODEX_REVIEW_GATE_USE_UBUNTU_LATEST \
     --repo "github.com/$REPO" \
     --body true
   ```

   Do not add an arbitrary runner-label input or variable.

## Phase 5: prove the canary and activate protection

1. Re-read the pull request. Require it to remain open, non-draft, based on
   `DEFAULT_BRANCH`, and still at `CANARY_HEAD`.
2. Read the exact current test-merge SHA and the native CheckRun on the exact
   feature head:

   ```bash
   DEFAULT_BRANCH_URI="$(jq -rn --arg value "$DEFAULT_BRANCH" '$value | @uri')"
   DEFAULT_BRANCH_HEAD_SHA="$(gh api --hostname github.com \
     "repos/$REPO/branches/$DEFAULT_BRANCH_URI" \
     --jq '.commit.sha')"
   CANARY_TEST_MERGE_SHA="$(gh api --hostname github.com \
     "repos/$REPO/pulls/$CANARY_PR" \
     --jq '.merge_commit_sha')"
   test -n "$DEFAULT_BRANCH_HEAD_SHA"
   test -n "$CANARY_TEST_MERGE_SHA"
   gh api --hostname github.com --paginate --slurp \
     "repos/$REPO/commits/$CANARY_HEAD/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100" \
     --jq '[.[].check_runs[] | {id, status, conclusion, head_sha, app: .app.id, details_url}]'
   ```

   Require exactly one current canonical verifier CheckRun with
   `head_sha=$CANARY_HEAD`, GitHub Actions App ID `15368`, and
   `conclusion=success`. The canonical `pull_request` verifier executes on
   `refs/pull/N/merge`; inside the Action it strictly validates `GITHUB_REF`,
   `GITHUB_SHA`, the event PR head/base scope, and a fresh PR read whose
   test-merge matches the runtime SHA. Event validation is limited to head/base
   SHA, ref, and repository; an event `merge_commit_sha` may be missing or
   historical and is not a binding input.
   Require that run's exact `display_title` to equal
   `codex-review-gate-verifier/$CANARY_PR/$CANARY_TEST_MERGE_SHA`, and require
   its single `pull_requests` binding to contain the current feature head and
   `base.sha=$DEFAULT_BRANCH_HEAD_SHA`, with both nested repository IDs matching
   the current repository ID obtained from `GET repos/$REPO`. Bind the feature-head CheckRun to the
   strictly newer verifier attempt reported by the controller and require that
   attempt to be execution-bound to `CANARY_TEST_MERGE_SHA`. Also require the
   verifier summary to report `execution_health=healthy` and
   `gate_outcome=success`. A different current head, base or test-merge SHA
   invalidates the result.

3. Preview and apply activation:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --expected-legacy-inventory-sha256 \
     "${LEGACY_INVENTORY_SHA256}" \
     --activate \
     --canary-pr "$CANARY_PR" \
     --canary-head "$CANARY_HEAD"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --expected-legacy-inventory-sha256 \
     "${LEGACY_INVENTORY_SHA256}" \
     --apply \
     --activate \
     --canary-pr "$CANARY_PR" \
     --canary-head "$CANARY_HEAD"
   ```

4. The helper must re-read the canary lifecycle, base, head, test-merge SHA,
   exact feature-head verifier run/job/CheckRun, canonical `display_title`,
   sole PR head/base binding (including top-level `run.repository.id` and
   `run.head_repository.id` plus nested Actions-run repository IDs matching the
   current repository ID) and collision inventory, plus the exact
   default-branch workflow inventory, CODEOWNERS errors, and
   owner permission immediately before every active ruleset POST or PUT. After
   the write, read back the exact ruleset and the complete consumer security
   snapshot. Require active default-branch enforcement, exact
   context `codex/github-review-gate`, expected GitHub Actions source
   `integration_id: 15368`, strict up-to-date, Code Owner review, stale-review
   dismissal, the new-ruleset default of zero ordinary approvals without
   lowering any existing higher count, all conversations resolved, and
   non-fast-forward default-branch protection, and an explicitly empty
   `bypass_actors` array. Treat a missing or non-array value as incomplete, not
   as empty.
5. Only after step 4 proves the exact complete Active v2 ruleset, derive the
   sole admissible cleanup state from the complete pre-cleanup security
   snapshot. This read-only mode first requires the current legacy inventory
   to equal the original owner-approved digest. Its stdout is only one
   deterministic JSON object, so save and review it before any external write:

   ```bash
   POST_CLEANUP_PLAN="$(mktemp)"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --expected-legacy-inventory-sha256 \
     "${LEGACY_INVENTORY_SHA256}" \
     --derive-post-cleanup-plan > "$POST_CLEANUP_PLAN"
   jq . "$POST_CLEANUP_PLAN"
   EXPECTED_POST_CLEANUP_SECURITY_SHA256="$(jq -er \
     '.expected_post_cleanup_security_sha256 |
      select(test("^[0-9a-f]{64}$"))' \
     "$POST_CLEANUP_PLAN")"
   ```

   This legacy cleanup plan may remove only `codex/review-gate`. If that removes the last item
   from classic required-status policy, that empty policy and its `strict`
   field may disappear. If it empties a ruleset status rule, that rule may
   disappear; the whole dedicated legacy-only ruleset may disappear only when
   no other rule remains. Those are the only structural exceptions. Require
   exact preservation of repository/default-head identity, workflow and
   CODEOWNERS inventory, owner permission, every field and non-legacy check
   (including `strict` and `app_id`) in a surviving classic policy, and every
   retained ruleset's identity, conditions, bypass actors, and unrelated
   rules. Any other delta is not an authorised cleanup plan.
6. Execute only that reviewed plan with the applicable separately authorized,
   policy-specific executor. The source-only executor in the narrow source
   exception above must not be used by an ordinary consumer. Do not re-derive
   after any write. A cleanup or readback failure is not permission to disable
   or roll back v2: preserve Active v2, run only policy-specific read-only
   diagnostics, and report the exact remaining or indeterminate surface.
7. You may run the dedicated read-only post-cleanup closure for independent
   evidence or recovery diagnosis with the recorded ruleset name and expected
   state digest. It takes two complete security snapshots; both rounds must be
   identical, must equal the expected digest, must show both legacy surfaces
   clear, and must show the same exact complete v2 ruleset Active. Thus neither
   an unrelated-policy change nor a cross-surface swap can form a false clear
   snapshot:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --verify-post-cleanup \
     --expected-post-cleanup-security-sha256 \
     "${EXPECTED_POST_CLEANUP_SECURITY_SHA256}"
   ```

   An inconclusive result keeps v2 Active and requires read-only diagnostics;
   never disable or roll it back to make closure pass.
8. Close the canary without merging. Do not let `gh` delete the branch as part
   of the close operation. First prove the closed PR still names the recorded
   head repository, ref, and OID; then delete that remote ref with an atomic
   exact-OID lease:

   ```bash
   (
     set -euo pipefail
     trap 'printf "%s\n" "Canary cleanup did not prove completion. Do not issue an unconditional delete; inspect and report the exact PR/ref scope." >&2' ERR

     gh pr close "$CANARY_PR" --repo "github.com/$REPO"
     CANARY_CLOSED_STATE="$(gh api --hostname github.com \
       "repos/$REPO/pulls/$CANARY_PR")"
     jq -e \
       --arg repo "$CANARY_HEAD_REPO" \
       --arg ref "$CANARY_HEAD_REF" \
       --arg sha "$CANARY_HEAD" \
       '.state == "closed" and .merged_at == null and
        .head.repo.full_name == $repo and .head.ref == $ref and .head.sha == $sha' \
       <<< "$CANARY_CLOSED_STATE" > /dev/null

     CANARY_REMOTE="https://github.com/$CANARY_HEAD_REPO.git"
     REMOTE_CANARY_HEAD="$(git ls-remote --refs "$CANARY_REMOTE" \
       "refs/heads/$CANARY_HEAD_REF" |
       awk 'NR == 1 { print $1 } END { if (NR != 1) exit 1 }')"
     test "$REMOTE_CANARY_HEAD" = "$CANARY_HEAD"
     git push \
       --force-with-lease="refs/heads/$CANARY_HEAD_REF:$CANARY_HEAD" \
       "$CANARY_REMOTE" \
       ":refs/heads/$CANARY_HEAD_REF"
     POST_DELETE_REMOTE_CANARY="$(git ls-remote --refs "$CANARY_REMOTE" \
       "refs/heads/$CANARY_HEAD_REF")"
     test -z "$POST_DELETE_REMOTE_CANARY"
   )
   ```

   A missing or different remote OID, changed PR head identity, or failed lease
   is inconclusive. A mismatch detected before the leased push leaves the
   branch intact; a post-push read failure leaves deletion outcome unknown.
   Stop and report the observed scope; never retry with an unconditional ref
   deletion.

9. Report the migration PR, closed-unmerged canary PR, both canonical workflow
   paths, active ruleset ID, exact successful canary feature head and bound
   default-branch base/test-merge SHA and canonical run-name receipt, plus the
   verifier run URL, reviewed cleanup-plan digest, final two-round security
   closure and dual-surface legacy inventory readback, and any
   persistent profile or runner-fallback variables.

There is no scheduled recovery loop. If a bot event is missed or evidence
arrives only through a review/reaction, dispatch one exact-head `reconcile` for
that PR and follow its reported recovery action.
