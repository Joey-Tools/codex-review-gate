# Install Codex Review Gate v2

This guide is for a repository maintainer. The [agent runbook](agent.md)
describes the same installation as a deterministic execution checklist; it is
not a different installation mode. Both guides use the canonical assets under
`templates/codex-gated-repo/`.

The ordinary single-repository rollout has two pull requests:

1. one migration PR removes the v1 caller and installs both canonical v2
   workflows; and
2. after the migration merges, one separate harmless canary PR proves that the
   live default-branch workflow and ruleset work together.

The canary is closed without merging.

The controlled organization handoff has a fixed active ten-repository v2
cohort. Its old v1 organization ruleset retains the original eleven-repository
legacy selector. The narrow source-repository self-hosting exception is
separate from that cohort and is defined below. Read the relevant exceptional
section before changing either scope.

## What is installed

A complete installation has three required asset groups:

1. the canonical read-only verifier at
   `.github/workflows/codex-review-gate.yml` and protected-default-branch
   controller at `.github/workflows/codex-review-gate-controller.yml`;
2. the repository ruleset based on
   `templates/codex-gated-repo/rulesets/codex-review-gate.json`; and
3. the final effective `.github/CODEOWNERS`, whose two managed rules protect
   `/.github/workflows/` and `/.github/CODEOWNERS` with one explicitly named
   `CONTROL_PLANE_OWNER`.

The ruleset must require Code Owner review and dismiss stale approvals after a
push. Both workflows call the compatible floating major:

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

Do not replace this selector with a prerelease. The only exception is the
release operator's temporary RC admission bridge in
[`RELEASING.md`](../RELEASING.md), including its installed-consumer and fresh
fixture forms; neither is consumer installation.

Copy both canonical workflows unchanged. They own separate event and permission
boundaries that an Action step cannot define:

- the read-only verifier uses only `pull_request` activity types `opened`,
  `reopened`, `synchronize`, and `ready_for_review`; its native
  `codex/github-review-gate` CheckRun on the exact PR feature-head SHA is
  required;
- controller automatic wake-ups use only `issue_comment` activity types
  `created` and `edited`. It deliberately excludes `pull_request_review`:
  GitHub binds that event to the PR merge ref, while the controller holds
  narrow write authority. A Codex result carried only by a review or reaction
  therefore uses the protected default-branch manual `reconcile` path;
- before a runner is allocated, both the event sender and comment author must
  be the exact Codex bot, `chatgpt-codex-connector[bot]`, with GitHub type
  `Bot`;
- the only manual trigger is `workflow_dispatch`, and one run targets one pull
  request;
- manual dispatches must use the workflow from the repository's default
  branch;
- API-only work uses `ubuntu-slim` by default; the repository Actions variable
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` selects the sole supported
  fallback, `ubuntu-latest`;
- the verifier has read-only evidence permissions; the controller alone has
  narrow `pull-requests: write` and `actions: write` authority for requests
  and exact verifier reruns. It targets only PR conversation comments, for
  which GitHub accepts pull-request write authority through the issue-comment
  REST endpoints. Neither workflow has `issues: write`, `statuses: write`,
  `checks: write`, or `contents: write`.

By default, an ordinary human-authored `@codex review` request establishes a
new review generation only when its author currently has `write`, `maintain`,
or `admin` permission. A repository that intentionally accepts requests from
any commenter may set the protected Actions variable
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`; every other value maps to
the safer `write` policy. This is wrapper-owned protected configuration, not a
public Action input. It never weakens Codex finding authority: every qualifying
finding remains blocking regardless of request-author permission.

The consumer workflows have no cron, `repository_dispatch`,
`pull_request_target`, automatic `pull_request_review` writer, runtime GitHub
App, status bridge or ledger. Evidence is rebuilt by the selected verifier.

Reactions on a qualifying ordinary, unmarked `@codex review` request are read
only as provider-liveness evidence. An ordinary `+1` cannot independently
create head-bound clean evidence. An official Codex `eyes` reaction or
progress artifact at the same time as or later than candidate terminal clean
evidence vetoes success because review activity is still current. Reaction
changes do not themselves start a consumer job, so let a later qualifying bot
comment run the gate or dispatch a manual exact-head `reconcile`.
For predecessor-to-successor generation closure, liveness at the same timestamp
as the successor request is also ambiguous and keeps the predecessor open.
Once a second physical request boundary exists, an unbound terminal cannot
prove that it belongs to the newer request rather than an older flight. Without
a base epoch, provider terminal evidence may close only the first gap; every
later gap and the newer generation's clean authority require a qualifying `+1`
directly on the corresponding canonical request. With a base epoch, every gap
does. Physical boundaries and positive authority are separate: an edited,
malformed, wrong-author, denied, or stale-base request can remain a boundary
without gaining authority. A new head recovers an unclosed gap only when every
ambiguous predecessor is explicitly bound to a different full head. If any
predecessor is ordinary, deleted, or otherwise unbound, create a replacement
PR, run one canonical producer there, validate it, and close the ambiguous PR.
Explicitly commit-bound progress is scoped to that head. Every unbound progress
carrier remains in the current inventory because nearby request timestamps do
not prove its source. An edited terminal also contributes an unbound unknown-
activity interval from creation through terminal revision. Provider terminal
evidence can close the first gap only with a complete predecessor reaction
inventory and no current `eyes` or provider activity after that terminal
through the successor.

Choose one GitHub user as `CONTROL_PLANE_OWNER`. That account must have
`write`, `maintain`, or `admin` permission on the consumer repository. The
helper defaults to `@JoeyTeng`; pass a different user for every non-Joey
repository. The owner is deliberately explicit because GitHub's required-check
`integration_id: 15368` identifies the entire GitHub Actions App, not either
workflow. Exact-byte and complete-inventory checks, CODEOWNERS, Code Owner
review, stale dismissal, strict freshness, no bypass actors and canary
collision readback form the adopted compound boundary.

The manual `workflow_dispatch` interface is:

| Input | Meaning |
| --- | --- |
| `operation` | `begin-review` or `reconcile` |
| `pr_number` | One open pull request number |
| `expected_head_sha` | The exact pull request head the run may evaluate |
| `request_comment_id` | Optional evidence-location hint |
| `request_review` | Whether `begin-review` posts the request; defaults to `true` |

These values help the Action locate and validate work; they never supply a
verdict or limits profile. The controller Action step uses the exact underscore input names `github_token`,
`pr_number`, `expected_head_sha`, `operation`, `request_comment_id`,
and `request_review`. Both Action steps derive `limits_profile` only from
protected repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE`. Their only public outputs are
`execution_health`, `gate_outcome`, `recovery_code`, and `retry_safe`. Finding
counts, when available, are diagnostics in the job summary and sticky comment,
not Action outputs.

## Narrow source-repository self-hosting exception

This exception applies only when `Joey-Tools/codex-review-gate` migrates its
own default branch. It does not weaken the ordinary consumer path: the
importable ruleset and the bootstrap helper's default `full` profile remain
required for every ordinary consumer and every repository-level cohort
installation. Do not copy this profile into a general installation template.

First merge the source migration PR that installs the exact canonical v2
verifier and controller together with the exact temporary legacy bridge. Keep
the source's existing legacy rule active. Then stage the separate source-only
v2 rule remotely; `--ruleset-profile status-only` is valid only with `--repo`,
not with `--prepare-worktree`:

```bash
REPO="Joey-Tools/codex-review-gate"
CONTROL_PLANE_OWNER=@JoeyTeng
V2_RULESET_NAME="Must Pass Codex Review v2"
# Use the value recorded in the owner-approved legacy inventory snapshot.
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

When following the ordinary canary, activation, and cleanup-proof sections
below, carry `--ruleset-name "$V2_RULESET_NAME"`,
`--ruleset-profile status-only`, and `--legacy-bridge` through every later
remote invocation. Do not fall back to the default `full` profile for this
source exception.

The new rule contains only the strict, GitHub-Actions-bound
`codex/github-review-gate` requirement. It is a second rule: the existing
source rule continues to own deletion, non-fast-forward, pull-request, and
the associated CODEOWNERS protection. Once the source-specific rule is Active,
both the legacy v1 status and the new v2 CheckRun protect the source. Do not
remove or broaden any legacy protection during this stage; follow the separate
canary and owner-approved cleanup process before removing only the legacy
status requirement.

Do not use an organization schema-2 final-closure receipt to remove the
source's temporary bridge. That bridge needs a separately recorded,
source-local closure proof and its own authorization.

## Advanced controlled handoff for one active ten-repository v2 cohort

Use this path only for an explicitly approved active ten-repository v2 cohort
whose default branches are covered by one shared v1 organization ruleset. Its
original eleven-repository legacy selector remains separate. This is not a
general `allow-v1` installation mode. The ordinary path in the numbered
sections below, and the final state of every active cohort member, still reject
every v1 caller.

`Joey-Tools/codex-waited-delivery` is archived and legacy-only. It remains in
the original eleven-repository selector so the old rule retains its
`deletion` and `non_fast_forward` protection after cutover. It is not a member
of the active v2 cohort and receives no v2 installation, canary,
repository-level cleanup, final-closure receipt membership, or bridge removal.
The manifest must identify this one exception at
`legacy_ruleset.legacy_only_repository` with its exact `slug`, numeric `id`,
`node_id`, `default_branch`, and `archived: true`. The old selector may contain
only the ordered ten active IDs plus that identity's ID exactly once. An
unknown eleventh ID or any overlap with an active repository is a hard failure,
so retained archive protection cannot be redirected accidentally.

The handoff deliberately separates protection responsibilities:

- every active cohort repository receives the complete v2 repository ruleset,
  which keeps
  the strict up-to-date, Code Owner, stale-review, resolved-conversation and
  non-fast-forward requirements described in this guide;
- a new organization ruleset named `Must Pass Codex Review v2` requires only
  the strict, source-bound `codex/github-review-gate` check for the exact
  ten active members;
- the old organization ruleset retains its original eleven-repository selector
  (including the archived legacy-only repository) and remains Active with
  `deletion`, `non_fast_forward` and its sole `codex/review-gate` status rule
  throughout active-cohort installation, canary proof, v2 activation and
  repository-level v1 cleanup; and
- the old organization ruleset is never deleted. At the final cutover its
  entire legacy-only required-status rule is removed, while its identity,
  targets, enforcement, bypass actors, `deletion`, `non_fast_forward` and
  every other bound field stay unchanged.

The source of truth for this transaction is one reviewed JSON manifest with
schema `organization-review-gate-handoff-manifest/v3`. It binds the
organization identity, the exact old organization ruleset, the new ruleset
name and ID, exactly ten ordered active repository identities, and the exact
original eleven-repository legacy selector plus its fixed archived-only
repository identity; the three workflow blob and content hashes; the effective
CODEOWNERS identity; each complete Active repository v2 ruleset; and every
active repository-level legacy-cleanup before/after snapshot. Each canary entry binds an open, non-draft,
same-repository PR to its exact current head, base and test-merge SHAs; the v2
CheckRun plus its workflow run, attempt and job identities; and the latest
successful legacy commit-status ID. Version 3 additionally binds the
per-repository legacy-evidence window, the complete repository-evidence,
scheduler-snapshot, and organization-evidence phase capacities, one
full-cohort coverage-round capacity, the two-round coverage-stability capacity,
every repository's full legacy-writer scan budget, and exactly one private
scheduler descriptor. That descriptor is
limited to `Joey-Tools/codex-private-workflows` workflow
`.github/workflows/scheduled-sync-release.yml`; it binds its workflow ID,
source blob/SHA-256, required initial `active` state, and drain budget. Missing,
extra or reordered members, or any scheduler descriptor on another repository,
are hard failures.

The exact `activation` fields are
`legacy_evidence_stability_timeout_ms`, `repository_evidence_timeout_ms`,
`scheduler_snapshot_timeout_ms`, `organization_evidence_timeout_ms`,
`coverage_round_timeout_ms`, and `coverage_stability_timeout_ms`; they are
manifest-bound plan input, not ad hoc CLI overrides.

This is the current v2 handoff path. A previously issued v1 output with a
schema-1 receipt is historical eleven-member closure evidence only; do not use
it to install, stage, activate, clean up, or remove a bridge for this cohort.
Its published JSON shape and canonical receipt digest remain strictly validated
for historical audit, but schema 1 authorizes no new bridge removal.

Start from
`templates/organization-review-gate-handoff/joey-tools-10-member-manifest.template.json`
and follow the README beside it. Replace every explicit placeholder with live,
reviewed evidence; do not infer missing identities. Before `stage`, the only
permitted incomplete value is the literal JSON `null` at `v2_ruleset.id`,
because that organization ruleset does not exist yet. Every other placeholder
or incomplete value is rejected. After the successful `stage` readback,
replace that `null` with only the returned organization ruleset ID and review
the completed manifest again.

For each active cohort member, the migration PR installs the canonical v2
verifier and controller plus the one exact temporary bridge at
`.github/workflows/codex-review-gate-legacy-bridge.yml`:

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

`--legacy-bridge` admits only that fixed path with the canonical exact bytes;
it does not admit an arbitrary v1 workflow. Keep the flag on every
repository bootstrap staging and activation command while the bridge is
present. The cohort repository ruleset name is
exactly `Must Pass Codex Review v2`, not the ordinary installer default
`Must Pass Codex Review`. Pass that distinct name to every repository
bootstrap call with `--ruleset-name`.
Do not run this bootstrap path for the archived legacy-only repository.

The bridge has a closed writable event envelope: `pull_request_target` only
for `opened`, `reopened`, `synchronize`, and `ready_for_review`, plus
`issue_comment` only for `created`. It deliberately excludes
`pull_request_review`: GitHub binds that workflow to the PR merge ref, where
the compatibility publisher's `issues: write` authority is not a safe write
surface. Do not add a local review trigger. The temporary bridge remains a
compatibility status publisher; v2 manual reconcile cannot refresh its v1
status. Section 3 documents the separate exact-run recovery required while
dual protection remains active.

Reuse the ordinary guide only for canonical file preparation, control-plane
review and staging the complete repository v2 policy as **Disabled**. Do not
follow its legacy cleanup or canary-close steps. After the migration merges,
stage the distinct Disabled repository rule with `--legacy-bridge`; then
create a harmless open, non-draft canary, prove the exact-head/test-merge v2
CheckRun and latest successful `codex/review-gate` bridge commit status, and
activate that repository rule with the same distinct name and bridge profile.
Keep the canary open until the shared organization rule has been activated and
its dual-enforcement readback succeeds. Record its current bound evidence in
the manifest. Do not start organization activation until all ten active entries
meet those conditions.

The organization helper is preview-first. Every mutating apply must use the
exact `plan_sha256` emitted by its matching live preview. Because a failed
stage POST may need no-receipt recovery, hold an external organization-admin
policy-mutation freeze from the stage preview through its apply, readback, and
any recovery:

```bash
HANDOFF_MANIFEST=/absolute/path/to/reviewed-handoff-manifest.json

node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode plan

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

`stage` creates only the exact Disabled, v2-only organization ruleset. Bind
the returned `next_manifest_update.v2_ruleset.id` into the reviewed manifest,
then run `plan` again. When all ten active open, non-draft, current-base
canaries, canonical workflows, temporary bridges, Active repository v2
rulesets and still-uncleaned legacy surfaces match that manifest, preview and
activate the shared rule:

If the `stage --apply` POST fails after it may have reached GitHub, the helper
first attempts one read-only reconciliation. A returned `applied-recovered`
result and `next_manifest_update` are a verified success. If the process was
interrupted or reports an unknown outcome instead, do not rerun the POST. With
`v2_ruleset.id` still `null`, use the explicit read-only recovery entry:

```bash
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode stage \
  --recover-created-v2
```

This option cannot be combined with `--apply` or a plan digest. It returns a
`next_manifest_update` only when exactly one same-name organization ruleset
has the canonical Disabled v2 payload and the old organization rule is still
at its exact before-state. An absent candidate, multiple candidates, an
Active candidate or any payload/source drift fails closed. Recovery never
replays the POST. Hold an external organization-admin policy-mutation freeze
for the complete recovery read so the uniquely adopted object cannot change
during that boundary.

Before activation, quiesce the one manifest-bound private overlay scheduler.
This is a separate, preview-first state transition; it disables only
`Joey-Tools/codex-private-workflows` workflow
`.github/workflows/scheduled-sync-release.yml`. It does **not** disable the
v2 verifier or temporary legacy bridge. The scheduler's complete run inventory
is read without `status`, `head_sha`, event, or creation-time filters. A run
already started before disable is allowed to finish normally, never cancelled;
only two identical, complete terminal inventories prove the drain.

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

Only after `quiesce-scheduler` returns `applied-drained`, run the following
**fresh** activation preview and apply. Do not reuse any coverage read from
before quiesce:

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

After that command returns its successful dual-enforcement readback, explicitly
restore the scheduler with a new preview and its matching digest:

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

If quiesce or activation fails after the disable, the intentionally retained
`disabled_manually` state is recovery evidence. Read the command's
`recovery_code`, establish whether dual enforcement was reached, and use a
fresh preview; do not replay an uncertain PUT. `restore-scheduler` is the
explicit recovery operation only after that decision. If disable or enable has
an unknown outcome, reconcile the exact manifest-bound scheduler state first.
The helper never restores the scheduler automatically after a failed quiesce or
activation.

Before the matching quiesce preview, establish an external organization- and
repository-admin policy-mutation freeze and hold it through scheduler restore
readback. During that interval, no administrator may change organization or
repository rulesets, classic branch protection, conditions, required checks or
bypass actors, or separately enable/disable the bound scheduler. GitHub's
ruleset update endpoint has no
documented conditional/CAS update. The digest and immediate rereads detect
earlier or later drift, but they cannot make the final GET-to-PUT interval
atomic. The helper checks the exact manifest-bound bypass lists; it cannot
automatically discover or preserve an actor concurrently added outside that
snapshot.

Every post-activation and cutover stable snapshot also rereads the
manifest-bound scheduler and requires its live Actions workflow state to be
`active`, then reads the archived-only repository from GitHub and requires
exact `full_name`, `id`, `node_id`, `default_branch`, and `archived: true`
equality with the manifest. Immediately before the legacy-rule cutover `PUT`,
it rereads that identity alongside the old ruleset and rereads the exact
manifest-bound scheduler as `active` and unchanged from the stable snapshot.
An unreadable result,
same-slug replacement, identity/default-branch drift, or an archive flag that
is no longer true is inconclusive and produces no cutover write; it does not
add the archived repository to v2, the receipt, or bridge-removal scope. If
restoration was skipped or failed, `derive-cutover`, `apply-repository-cleanup`,
and `verify` fail closed with
`recovery_code=activation-scheduler-restore-required`; run a fresh
`restore-scheduler` preview/apply, confirm its active readback, then restart
the blocked preview.

The successful activation readback is the double-protection handoff point:
all ten active members have the complete repository v2 policy, the shared
v2-only organization rule is Active, and the old organization v1 rule is still
Active with its original eleven-repository selector. Only after the helper
reports that post-write dual-enforcement proof **and** the explicit scheduler
restore succeeds may each active canary be closed without merging. Never close
one before `activate` completes and the scheduler is restored. The later
`derive-cutover`, `apply-repository-cleanup`, and `verify` modes use
post-activation active-cohort snapshots and do not require closed canaries to
be reopened. They also do not require the current default-branch head to remain
equal to the historical canary base. The canary receipt is activation-bound
evidence; after activation the helper reads each active repository's live
default branch and proves the current control-plane/ruleset closure instead:
exact repository identity, a complete regular-blob workflow inventory with the
three canonical files, the separately manifest-bound scheduler, and no extra
producer, exact CODEOWNERS, default-read
Actions policy with an explicit boolean `can_approve_pull_request_reviews`,
Active repository and organization v2 rules, the temporary bridge, current
cleanup state, and the separately manifest-bound scheduler's live `active`
state.

Next derive the repository-level cleanup read-only:

```bash
HANDOFF_CUTOVER_PLAN="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode derive-cutover > "$HANDOFF_CUTOVER_PLAN"
jq . "$HANDOFF_CUTOVER_PLAN"
```

Review the emitted `external_repository_actions`; they may remove only
`codex/review-gate` and must preserve every non-legacy check, strictness
setting, repository ruleset identity, condition, bypass actor, `deletion`,
`non_fast_forward` and unrelated rule bound by the manifest. Do not execute
the raw actions manually. Apply them through the controlled executor while the
external organization/repository-admin policy-and-target-identity freeze
remains continuously in force from this cleanup preview through the cleanup
apply and readback, the later `verify` preview/apply, and its final stable
readback. During this third freeze, the restored scheduler must remain
`active`; no administrator may separately enable or disable it:

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

This is an operational freeze, not a continuous repository or API lock. In
addition to the policy fields above, from this cleanup preview through the
final read-only `verify`, operators must prevent every cohort repository from
being renamed, transferred, deleted, having its default branch changed, or
being replaced or re-created at its original slug. GitHub's cleanup mutation
APIs provide no repository-ID conditional/CAS write, so the freeze covers the
final repository-metadata-read-to-write gap.

Before every cleanup surface read—including initial classification, normal
readback, and error reconciliation—the executor reads GitHub repository
metadata and requires exact manifest-bound `full_name`, `id`, `node_id`, and
`default_branch`. If the item still needs a write, it repeats that identity
check immediately before mutation, then requires exact
`expected_before` and `expected_after` policy snapshots around the
surface-specific write. `id` and `node_id` bind the repository object,
`full_name` binds its expected route and exposes rename, transfer, or slug
reuse, and `default_branch` binds the branch selector; the snapshots protect
the selected policy content. Unrelated metadata churn is not treated as a
change to either property. Any unreadable or mismatched identity stops the
batch at that observation: a pre-mutation mismatch emits no write for the
current action, and no later mutation runs. A stable mixture of before- and
after-state items is a safe resume point: already-after items are no-ops and
only still-before items enter the new plan. If a mutation returns an error or
its result is unknown, the executor first performs a narrow read-only
reconciliation. It treats exact after-state as completed; before-state, drift,
or an unreadable result stops the batch. Then run a fresh preview under the
freeze, review the live state, and never blindly replay the old mutation or old
plan digest.

Only after all repository cleanup surfaces match their exact `expected_after`
snapshots may the old organization status rule be removed:

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

`verify --apply` is the only helper mode that changes the old organization
ruleset. It removes the whole legacy-only required-status rule, not the old
ruleset. Its `applied-final-verified` response is not the bridge-removal
authorization: the organization or repository control plane can still drift
after that write/readback boundary. Continue the external policy-mutation
freeze begun before repository cleanup through the separate final read-only
`verify`, its stable two-snapshot readback, and validation of the saved output.
That read-only result must have top-level
`schema_version: "organization-review-gate-handoff-output/v2"`,
`mode: "verify"`, `status: "final-verified"`, `applied: false`, and
`action: null`. It also embeds
`final_closure_receipt` schema version 2, binding the organization, reviewed
manifest digest, final snapshot digest, legacy/v2 ruleset IDs and states, and
the fixed, complete ten-repository active v2 cohort twice: schema-2
`manifest_repositories` is the canonical identity list derived from the
reviewed manifest, while `repositories` is the stable observed identity list.
Both list `full_name`, `id`, `node_id`, and `default_branch` in canonical
UTF-8-byte `full_name` order and must match exactly entry by entry. It admits
neither a subset nor an expanded active cohort. For this rollout, either list
is rejected if it contains archived `Joey-Tools/codex-waited-delivery` by
case-insensitive slug, numeric ID, or node ID; the archive cannot enter an
active receipt list. The separate old selector remains the original eleven
repositories, but it is not admitted to the receipt or bridge removal. Its
top-level `plan_sha256` must exactly bind the final read-only `verify` plan
(`mode`, manifest digest, snapshot digest, and `action: null`);
`final_closure_receipt_sha256` binds the canonical embedded receipt. Preserve
the **complete verify JSON output** at
`HANDOFF_FINAL_VERIFY`; do not save only the embedded receipt.

The third freeze may end after that complete output has been captured and
validated. If the read-only verify is inconclusive, any bound policy differs,
or a known organization/repository policy mutation occurs after capture but
before bridge removal is prepared, keep every bridge, resolve the drift, and
produce a fresh final read-only verify output under a new freeze. Never use the
`verify --apply` response or an older receipt as a substitute.

Every ordinary authoritative success boundary reads one complete snapshot,
waits five seconds, and reads it again. If selected evidence or policy differs,
the pair restarts. Activation uses the manifest-bound capacity contract instead
of a generic 60-second cap: 900 seconds for one repository's legacy evidence,
1,200 seconds for each complete repository-evidence read, 120 seconds for each
scheduler snapshot (including the activation preflight), and 120 seconds for
the organization-evidence read. One full-cohort coverage round has a 9,000-second
cap. Its successful topology is explicitly bounded at 8,340 seconds:
`2,100 + 2 * 120 + max(120, ceil(10 / 2) * 1,200)`. The scheduler drain and its
two state snapshots finish first; organization evidence then runs in parallel
with five two-repository evidence waves. The 660 seconds left in the round cap
are intentional slack. A stable pair has an 18,005-second cap: two rounds plus
the five-second interval. Pre-write and post-write stable coverage use both
bounds: every individual coverage round has the round cap, and the complete
pair has the pair cap. Immediate revalidation uses only the round cap. This
prevents one overlong round from consuming the pair budget and prolonging the
scheduler's `disabled_manually` state. Every scheduler snapshot, repository
evidence read, and organization read also has an independently enforced
deadline.

After scheduler evidence completes, the organization and repository branches
run concurrently. If either branch fails, the helper retains the first observed
error but waits for the sibling branch and already-started repository workers
to finish before returning. An early organization failure can therefore wait
for the remaining bounded repository phase; this is intentional fail-closed
draining.

The workflow YAML inventory, Actions workflow inventory, and local repository
ruleset inventory each have a hard 32-entry admission cap. An excess is
inconclusive and fails closed. This does not claim that a paginated GitHub API
endpoint has a fixed number of HTTP requests; the phase deadline is its
wall-clock boundary. A reviewed deployment manifest may raise soft limits only
within 1,800 seconds per repository, 300 seconds per scheduler snapshot, 600
seconds for organization evidence, 15,000 seconds per round, and 30,005
seconds per stable pair, while still satisfying the topology formula. These are
upper capacity limits rather than total `activate` wall-clock or GitHub
Actions-minutes-free promises: normal execution ends when actual reads finish.
None permits partial pagination or a changed execution epoch. When one expires
or evidence changes, the result is inconclusive and no next write is allowed;
read its `recovery_code` and start a fresh relevant preview.

After that closure, open a separate PR in every active cohort member to remove
the canonical bridge. Do not prepare one for the archived legacy-only
repository:

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

Despite its option name, `--final-closure-receipt` takes the complete final
read-only verify JSON file. The bootstrap validates the terminal top-level
fields, recomputes the canonical embedded receipt digest, compares the explicit
expected SHA-256, parses the worktree's unambiguous GitHub `origin`, and reads
the current repository metadata from GitHub. It requires exact equality of
`full_name`, `id`, `node_id`, and `default_branch` with one entry in the fixed
ten-member manifest-derived `manifest_repositories` cohort; the separate
observed `repositories` list is checked for equality but is not an
authorization source. The archived legacy-only repository is deliberately
absent, so it cannot authorize bridge removal. At the pre-rename boundary, it
reads `origin` before and after the live-metadata query, repeats the local
object checks, then reads `origin` once more immediately before the atomic
bridge quarantine rename. After that rename and before unlink, it
repeats the complete `origin` -> live metadata identity/default-branch ->
`origin` check and then revalidates the quarantined file's admitted object
identity and canonical content. If the remote binding recheck fails, it
attempts to restore that same admitted bridge at the canonical path with
no-clobber hard-link creation. An occupied destination or failed restoration
verification fails closed, never overwrites the occupant, and reports no
removal success. Thus an observed same-name re-creation, repository transfer,
default-branch drift, unreadable metadata, or other mismatch cannot authorize
unlink; a receipt for another cohort or repository cannot authorize removal.
These are point-in-time remote binding and local identity/content checks, not a
continuous lock.
Do not edit the receipt or retarget `origin` to bypass this proof.

If the bridge is already absent, the bridge-removal component is an idempotent
no-op. An existing non-canonical bridge is rejected rather than deleted. The
command as a whole is also the canonical local installer: with `--apply` it
would repair drifted verifier/controller bytes or the managed CODEOWNERS block
even when there is no bridge to remove. Start from a clean worktree and verify
those three surfaces before applying. If the dry run proposes anything besides
bridge removal, stop and resolve or separately review that drift instead of
describing the PR as bridge-only. After the PRs merge, rerun ordinary
validation without `--legacy-bridge`; every repository must satisfy the normal
final no-v1 contract.

## 1. Create and merge the migration PR

Before changing the consumer worktree, perform a read-only preflight:

```bash
REPO=OWNER/REPO
DEFAULT_BRANCH="$(gh api --hostname github.com \
  "repos/$REPO" \
  --jq '.default_branch')"
DEFAULT_WORKFLOW_PERMISSIONS="$(gh api --hostname github.com \
  "repos/$REPO/actions/permissions/workflow" \
  --jq '.default_workflow_permissions')"
test -n "$DEFAULT_BRANCH"
test "$DEFAULT_WORKFLOW_PERMISSIONS" = read
```

Stop if the permissions read is missing, fails, or is not `read`. Changing that
repository setting is not implicit installation authority. Obtain separate
authorisation to set default workflow permissions to read-only, read the
endpoint back, and repeat the preflight before continuing.

Use a clean checkout of `Joey-Tools/codex-review-gate` as `SOURCE_ROOT` and a
clean worktree of the consumer repository as `TARGET_ROOT`:

```bash
CONTROL_PLANE_OWNER=@JoeyTeng
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

The helper revalidates the target workflow parents at explicit checkpoints.
This is not an operation-bound filesystem sandbox: a hostile same-UID process
can still race path-based operations between checkpoints. Use a worktree whose
parent directories are not being concurrently modified by an untrusted
process, and do not bypass a reported safety failure with a manual copy.

The first command previews the change. The second copies both canonical
workflows byte for byte and merges a final managed block into
`.github/CODEOWNERS` without removing unrelated entries. If another workflow
still calls v1, inspect the paths reported by the helper and remove or
deactivate those callers in this same migration PR. One PR may remove v1,
install v2, and install the CODEOWNERS control plane.

If the repository currently uses `CODEOWNERS` at the repository root or under
`docs/`, the helper stops rather than creating `.github/CODEOWNERS` and
silently shadowing that policy. Move or merge all existing entries into
`.github/CODEOWNERS` in the same migration PR, then rerun the helper.

Review the consumer diff and run that repository's normal validation, but do
not request approval until the canonical inventory snapshot below is ready.
Then obtain an independent approval from `CONTROL_PLANE_OWNER` before merging
the migration PR. This first approval is a manual trust-bootstrap gate: pull
requests use CODEOWNERS from the base branch, where the new rules are not yet
present, and the new ruleset is not active yet. Immediately before merge,
verify that the owner is not the PR author, that the owner's latest review is
`APPROVED` for the current full head SHA, and that the head has not changed
after that read. Future PRs that change the workflow or CODEOWNERS are enforced
by GitHub and require the same owner to approve the final head; stale approvals
are dismissed after a push. Do not manually reconstruct the workflow from
this guide, and do not activate the required check while the v2 workflow exists
only on a feature branch.

This migration PR is a manual trust bootstrap, not its own v2 canary. After it
merges, any pull request that was already open needs a fresh verifier for its
current head/base/test-merge scope before v2 can become required: push a new
head, reopen it, or use the documented draft-to-ready transition. A controller
`reconcile` can rerun an existing exact verifier, but deliberately cannot
create one from an arbitrary pre-installation PR.

### Canonical legacy inventory generator

Use the tracked executable helper at
`$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh`. It accepts exactly
three arguments—repository, expected default branch, and output path—and owns
the fail-fast schema validation, canonical sorting, cleanup, and digest output.
Both calls below use this same reviewed executable; do not reconstruct it from
this guide.

Before requesting owner approval, execute the generator, print the digest, and
record both the canonical JSON and printed SHA-256 in the approval snapshot:

```bash
APPROVAL_INVENTORY_DIR="$(mktemp -d)"
APPROVAL_INVENTORY="$APPROVAL_INVENTORY_DIR/legacy-inventory.json"
LEGACY_INVENTORY_SHA256="$("$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
  "$REPO" "$DEFAULT_BRANCH" "$APPROVAL_INVENTORY")"
LEGACY_INVENTORY_SHA256="${LEGACY_INVENTORY_SHA256#LEGACY_INVENTORY_SHA256=}"
printf 'LEGACY_INVENTORY_SHA256=%s\n' "$LEGACY_INVENTORY_SHA256"
```

It binds the exact repository slug, numeric repository ID, opaque node ID, and
default branch; every matching active/inherited
ruleset's ID, name, source, enforcement, target, conditions, complete
`bypass_actors`, and complete `rules`; the complete matching effective
`required_status_checks` rule with all parameters; and the complete classic
parent required-status object, including `strict` and every check's producer
`app_id`, or explicit `null`. The shell helper and runtime use the same Node
canonicalizer, so approval and enforcement hash identical bytes. Before
hashing, it sorts semantically unordered
bypass actors, required checks, classic contexts/checks, and condition
`include`/`exclude` sets. Even a repository with no legacy requirement has a
digest because the canonical empty inventory remains bound to the repository
and default branch. An incomplete API response or schema is inconclusive, and
any digest drift fails closed rather than being treated as absence. A successful
empty or JSON `null` classic response is inconclusive; only an explicitly
recognised absence response becomes canonical `null`.

Keep every legacy requirement active until this migration merges, so later
failure remains fail closed. Preserve `MIGRATION_HEAD` and the owner-approved
snapshot, then supply its recorded digest externally as
`LEGACY_INVENTORY_SHA256`; the transaction has no default for it. The same
digest is also the cross-process baseline for every remote staging and
activation preview/apply below. It must remain identical through the Disabled
stage, canary, activation write, and exact Active readback; a new helper
process does not establish a new baseline.

The entire final gate and merge is one fail-fast transaction. It refreshes the
legacy inventory, default branch, PR base/head/state, authenticated actor, and
complete owner-review inventory before its sole mutation. Use one
repository-approved merge method:

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
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    process.stdout.write(crypto.createHash("sha256")
      .update(fs.readFileSync(process.argv[1])).digest("hex"));' \
    "$LEGACY_INVENTORY")"
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

Every precondition command is before the synchronous merge mutation; any
API, `jq`, `test`, pagination, parse, actor, base, head, state, or review
failure exits and the trap cleans every temporary file. The REST endpoint
either merges immediately or fails (including 405/409); it cannot enqueue the
PR. Do not use `gh pr merge`, auto-merge, a merge queue, or an admin bypass.
GitHub still has no atomic compare-and-swap over review state and head, so the
hard actor check requires the trusted owner to perform this direct merge
immediately after the fresh review readback. A head-only reread is insufficient.

After that immediate post-merge default/base/head/lifecycle readback succeeds,
keep every inventoried legacy requirement active. Stage a separate v2 ruleset
as Disabled, run the canary while the legacy gate continues to block merges,
then activate v2 and read the exact complete Active policy back. Only after
that Active readback may you perform a separately authorised cleanup that
removes the legacy requirements and reads both ruleset and classic surfaces
back. This overlap may
temporarily require both gates; it never permits an interval with neither gate.

Afterward, read the PR back as merged, refresh a clean checkout of the default
branch, compare both installed workflows byte for byte with their canonical
templates again, and re-read the final effective CODEOWNERS block and explicit
owner.

## 2. Stage the ruleset as Disabled

After the migration is present on the default branch, preview and apply remote
staging:

```bash
V2_RULESET_NAME="Must Pass Codex Review"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --apply
```

Alternatively, import
`templates/codex-gated-repo/rulesets/codex-review-gate.json` through
**Settings -> Rules -> Rulesets -> New ruleset -> Import a ruleset**.

Before continuing, verify that the staged ruleset:

- remains **Disabled**; a newly created ruleset targets only the default
  branch. When the helper updates an existing same-name branch ruleset whose
  include/exclude conditions cover more refs, it preserves those broader
  targets; inspect them and confirm every additional target is intended;
- requires `codex/github-review-gate` from expected source **GitHub Actions**
  (`integration_id: 15368`), not “Any source”;
- requires the branch to be up to date;
- requires Code Owner review and dismisses stale approvals; a new ruleset uses
  zero ordinary approvals, while the helper preserves any existing higher
  approval count;
- requires all review conversations to be resolved; and
- blocks non-fast-forward updates to the default branch; and
- has no bypass actors.

Every preview and apply compares the complete canonical dual-surface inventory
with the same owner-approved digest. API/schema incompleteness and any drift in
repository, default branch, ruleset policy, or classic producer binding are
inconclusive and fail closed.

The helper inventories the legacy `codex/review-gate` context in both effective
repository rulesets and classic branch protection required-status contexts.
Keep those active legacy requirements unchanged throughout Disabled staging,
the canary, and v2 activation. The helper permits this fail-closed overlap and
never edits classic protection or a separately managed legacy ruleset. If an
active legacy or incomplete ruleset already uses the selected v2 ruleset name,
the helper refuses every write; set `V2_RULESET_NAME` to a distinct name before
staging, and pass that same variable to staging, activation, and the final
probe. An unreadable or malformed legacy inventory, or any change that makes
the full canonical inventory differ from the owner-approved digest, is
inconclusive, not absence. Do not remove any legacy requirement in this phase.

## 3. Create and exercise the separate canary PR

Create a temporary branch from the merged default branch, make one harmless
reviewable change, and open a non-draft PR. Record its pull request number and
full current head SHA. Also bind the same-repository head ref that may later be
deleted; do not infer it from a branch name after the canary has run:

```bash
CANARY_HEAD="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.sha')"
CANARY_HEAD_REPO="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.repo.full_name')"
CANARY_HEAD_REF="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.ref')"
test "${#CANARY_HEAD}" -eq 40
test "$CANARY_HEAD_REPO" = "$REPO"
test -n "$CANARY_HEAD_REF"
```

Normally, request the review directly on the PR:

```text
@codex review
```

Do not add prose to the request. GitHub may persist this one-line direct
request with exactly one terminal LF or CRLF; those two storage forms are
equivalent to exact `@codex review`. Do not accept or emit any other
whitespace, visible text, or hidden comment.

This is the preferred path because it does not spend Actions minutes merely to
create the request. A later qualifying `created` or `edited` Codex bot comment
wakes the controller, which establishes a strictly newer full verifier attempt.
If the provider result arrives only as a review or reaction, or another
recovery is needed, run a manual reconcile.

### Dual-protection legacy-status recovery

Manual v2 `reconcile` only refreshes `codex/github-review-gate`; it never
writes `codex/review-gate`. While both contexts remain required, a review- or
reaction-only result can therefore need a separate v1 recovery. First use the
REST API to bind one complete current scope. `GET repos/$REPO` must still
return `full_name=$REPO` and a positive `id`; bind that ID as
`REPOSITORY_ID`, its `default_branch` as `DEFAULT_BRANCH`, and
`DEFAULT_BRANCH_HEAD_SHA` from the corresponding
`GET repos/$REPO/branches/$DEFAULT_BRANCH` response. The fresh
`GET repos/$REPO/pulls/$CANARY_PR` response must be open, non-draft, and
same-repository, with its head repository/ref/SHA equal to `$REPO`,
`CANARY_HEAD_REF`, and `CANARY_HEAD` and its base repository/ref/SHA equal to
`$REPO`, `DEFAULT_BRANCH`, and `DEFAULT_BRANCH_HEAD_SHA`.

Resolve the current bridge with
`GET repos/$REPO/actions/workflows/codex-review-gate-legacy-bridge.yml`, bind
its positive `LEGACY_WORKFLOW_ID`, and verify it again with
`GET repos/$REPO/actions/workflows/$LEGACY_WORKFLOW_ID`. Require the same ID,
exact path `.github/workflows/codex-review-gate-legacy-bridge.yml`, and
`state=active`; the display name is diagnostic, not identity. Read
`GET repos/$REPO/contents/.github/workflows/codex-review-gate-legacy-bridge.yml?ref=$DEFAULT_BRANCH_HEAD_SHA`,
require `type=file` and the exact path, decode its base64 content, and compare
the bytes exactly with
`$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-legacy-bridge.yml`.
Missing, truncated, undecodable, or different content is inconclusive.

List runs from
`GET repos/$REPO/actions/workflows/$LEGACY_WORKFLOW_ID/runs` with
`event=pull_request_target`, `head_sha=$CANARY_HEAD`,
`exclude_pull_requests=false`, and `per_page=100`. Follow every pagination
link. This must be a complete paginated workflow-run inventory: every page
has the same nonnegative `total_count`, every non-final page is full, and the
flattened run count equals `total_count`. Reject a malformed run, any duplicate
run ID across pages, or a result that reaches GitHub's documented 1,000-result
filtered-search ceiling; none of those conditions proves an empty set. Then
immediately reread page 1 with the identical query and require its canonical
JSON, including `total_count` and ordered runs, to equal the captured first
page. A changed pagination horizon invalidates the whole read; restart from
the scope binding instead of mixing pages from different horizons.

From that full stable inventory, a run is eligible only when its API
`created_at` proves that it is still inside GitHub's documented 30-day rerun
window, it is completed, and its REST object has all of the following: the
bound positive `workflow_id` and positive
`run_attempt`; `repository.full_name` and `head_repository.full_name` equal to
`$REPO` and their IDs equal `REPOSITORY_ID`; `event=pull_request_target`;
`head_sha` equal to `CANARY_HEAD`; and exactly one `pull_requests` entry whose
number, head/base ref and SHA, and nested head/base repository IDs equal the
complete bound PR scope. The embedded Actions-run repository objects are
minimal `{id,name,url}` references and may omit `full_name`; their positive ID
must equal `REPOSITORY_ID`, rather than treating a missing name as a match. A
matching nonterminal run is pending, not evidence of zero candidates.
In the run object, `DEFAULT_BRANCH_HEAD_SHA` is bound only by
`pull_requests[0].base.sha`; never compare the top-level `run.head_sha` to the
default-branch SHA. For `path`, accept the bare canonical path, GitHub's
documented `<canonical-path>@<DEFAULT_BRANCH>` form, or the equivalent
`<canonical-path>@refs/heads/<DEFAULT_BRANCH>` form. Parse a suffixed form by
removing the known canonical-path-plus-`@` prefix and treating the entire
nonempty remainder as the ref; require that ref to equal either
`$DEFAULT_BRANCH` or `refs/heads/$DEFAULT_BRANCH`, and reject every other path
or ref. The bare form is valid only because the independent PR base
repository/ref/SHA, feature-head `head_sha`, active workflow identity, and
exact bridge-byte checks supply the missing ref binding.

These repository, branch, PR, workflow, canonical-byte, and stable
paginated-inventory values are the **recovery binding set** (the complete state
that selection and both sides of the write must revalidate).

Classify the complete eligible set by cardinality. Exactly one candidate may
proceed; set `LEGACY_RUN_ID` and `LEGACY_RUN_ATTEMPT` from its `id` and
`run_attempt`. More than one is inconclusive even if one is newer: stop rather
than choosing the latest. Only cardinality zero after a complete stable read
permits the draft-to-ready fallback below. Missing fields, a pagination cap,
duplicate IDs, horizon drift, or unreadable scope is inconclusive, never zero.

Immediately before the write, repeat the repository, default-branch head, PR,
active workflow, exact bridge bytes, complete run pagination, duplicate-ID
check, and page-1 horizon reread. Require the same recovery binding set and
exactly one candidate with the same `LEGACY_RUN_ID` and `LEGACY_RUN_ATTEMPT`. Also
completely paginate and horizon-stabilize
`GET repos/$REPO/commits/$CANARY_HEAD/statuses?per_page=100`, reject duplicate
status IDs, and record every pre-POST status ID plus the current first
reverse-chronological exact-context `codex/review-gate` status. This is the
final pre-POST recovery binding-set read.

Re-run that exact pre-existing bridge run, never a different v1 workflow.
Before the write, set `LEGACY_RERUN_RECEIPT` to an operator-retained,
transaction-specific path that does not exist. Keep that exact path; never
select a new path to retry the mutation. The no-clobber response-file creation prevents
this block from silently overwriting an earlier receipt:

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

GitHub re-runs preserve the original run's `GITHUB_SHA` and `GITHUB_REF`; that
is why the selected run must bind the exact feature head and its embedded PR
entry must separately bind the current default-branch repository/ref/SHA.
`--include` puts the HTTP status line first in the retained response, and the
fixed API-version header prevents API-version negotiation from changing this
request. The parser accepts the status tokens emitted for HTTP/1.1, HTTP/2,
and HTTP/3, extracts the second field, and requires exactly `201`. Retain even
a partial or empty receipt as evidence of an inconclusive attempt; it can never
prove success. A nonzero `gh` exit, missing or malformed first line, non-`201`
status, or any other transport uncertainty is inconclusive: preserve the
receipt and never submit the POST again. Submit the POST once.

After the POST, poll the exact run ID to a terminal state, then revalidate the
same recovery binding set, including the stable full run enumeration. Require
the repository, default branch/ref/SHA, PR head/base scope, active workflow
ID/path/state, canonical bridge bytes, and sole eligible run ID to be
unchanged. The run must now have `run_attempt` exactly
`LEGACY_RUN_ATTEMPT + 1`, `status=completed`, and `conclusion=success`. Finally,
completely paginate
`GET repos/$REPO/commits/$CANARY_HEAD/statuses?per_page=100`, reject duplicate
status IDs, stabilize its page-1 horizon in the same way, and require the first
reverse-chronological status with exact context `codex/review-gate` to have an
ID absent from the complete pre-POST inventory, `state=success`,
`creator.login=github-actions[bot]`, and `creator.type=Bot` on the still-current
`CANARY_HEAD`. An old success is not rerun evidence. A timeout, unchanged or
jumped attempt, changed scope, unstable/incomplete inventory, or nonunique
candidate is inconclusive: do not submit the POST again.

Only when the complete stable eligible set has cardinality zero (including
when all otherwise matching runs are outside GitHub's rerun window), convert
the PR to draft and mark it ready again to create a fresh
`pull_request_target` lifecycle run. Rebind the complete recovery binding set
and restart this selection procedure; do not reuse the earlier zero result. Do not add
`workflow_dispatch`, `pull_request_review`, `pull_request_review_comment`,
cron, or a new status writer to recover v1.

GitHub records the verifier run/job/CheckRun against the exact PR feature-head
SHA, not its test-merge SHA. The canonical `pull_request` verifier still
executes on `refs/pull/N/merge`; inside the Action it strictly checks
`GITHUB_REF`, `GITHUB_SHA`, the event PR head/base scope, and a fresh PR read
whose test-merge matches the runtime SHA. Its protected top-level `run-name`
also makes GitHub expose the exact
`codex-review-gate-verifier/<PR>/<current test-merge SHA>` as `display_title`;
the run's sole PR binding must carry the current feature head and
default-branch base SHA. A successful feature-head CheckRun is therefore
execution-bound to the exact current test-merge.

Event validation is limited to the PR head/base SHA, ref, and repository. Its
`merge_commit_sha` may be missing or historical and is deliberately not a
binding input.

There is deliberately no cron or writable review event. The verifier starts on
`opened`, `reopened`, `synchronize`, and `ready_for_review`; controller and
verifier have separate per-PR concurrency namespaces. Before a deliberate
same-head re-review, run `begin-review` so the new request is read back and a
strictly newer verifier attempt becomes observable. A direct comment alone
does not atomically invalidate an older success.

If a base retarget leaves no verifier for the current exact
head/base/test-merge scope, follow
`create_verifier_run`: for a ready PR, convert it to draft and mark it ready
again; for an already-draft PR, mark it ready. Verify that a new
`ready_for_review` verifier exists for the current exact head/base/test-merge scope, then
reconcile. Rerunning the old verifier is not valid retarget recovery.

After a base retarget or a detected base force-push epoch, always use
`begin-review` with `request_review=true`, then reconcile after Codex places a
qualifying `+1` directly on that canonical request. GitHub terminal clean
payloads do not identify the request/base snapshot that produced them, so in
this recovery mode a later terminal clean by itself deliberately remains
pending. Findings still block immediately.

Use `begin-review` when request creation and the newer verifier attempt must be
coordinated. For example:

```bash
gh workflow run codex-review-gate-controller.yml \
  --repo "github.com/$REPO" \
  -f operation=begin-review \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=true
```

Do not add `--ref`. Omitting it selects the default-branch workflow. After
dispatch, locate the new run and read it back:

```bash
gh run list \
  --repo "github.com/$REPO" \
  --workflow codex-review-gate-controller.yml \
  --event workflow_dispatch \
  --limit 10 \
  --json databaseId,event,headBranch,headSha,status,conclusion,url
```

Require the selected run's `event` to be `workflow_dispatch` and `headBranch`
to equal the repository's current default branch. A feature-branch run is
unsupported; do not use its result.

Before accepting the canary, reconcile its exact current head even if an
automatic bot-comment run already completed:

```bash
gh workflow run codex-review-gate-controller.yml \
  --repo "github.com/$REPO" \
  -f operation=reconcile \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=false
```

If the direct request comment ID was recorded, it may be supplied as the
optional `request_comment_id` input. It is only a hint; the Action still checks
the pull request and all relevant newer evidence.

The completed run reports execution health separately from the gate outcome.
Follow its `recovery_code` and summary next action in every non-success case.
A finding is normally a healthy gate failure, while an unhealthy execution
requires recovery or a retry; do not treat the two cases as equivalent.
`healthy/pending` is also fail-closed: it means the run safely cannot authorize
success yet. Only `recovery_code=wait_provider` is a pure wait; every other
code requires the concrete action named by the summary before a later
exact-head reconcile.

For an unusually large PR, set the reviewed protected Actions variable only
when the summary reports `use_expanded_limits`:

```bash
gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
  --repo "github.com/$REPO" \
  --body expanded
```

Then reread the exact head and run one scoped controller reconcile. Manual
dispatch has no limits-profile or numeric override. Only the named profiles
are supported.

Finally, re-read the PR, verifier attempt and exact feature-head CheckRun.
Require
all of the following:

- the PR head is still `FULL_HEAD_SHA`;
- the PR base and test-merge SHA are unchanged;
- the controller established a strictly newer verifier attempt and its unique
  canonical `codex/github-review-gate` CheckRun is `success` on that exact
  feature-head SHA;
- that verifier run is bound to the unchanged current test-merge by its
  merge-ref environment, event head/base scope (not event `merge_commit_sha`),
  and fresh PR read;
- the CheckRun expected source is GitHub Actions; and
- the run summary reports `execution_health=healthy` and
  `gate_outcome=success`.

If the head changes, stop and reread the summary plus the complete physical
lineage; never accept success from an older commit or automatically start a
same-PR generation. Continue on the new head only when every ambiguous
predecessor is explicitly bound to a different full head. An unclosable
ordinary, edited, malformed, denied, deleted, or otherwise unbound predecessor
requires a replacement PR.

## 4. Activate and close the canary

Only after the exact-head canary passes, preview and activate the ruleset:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --apply \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
```

Immediately before every ruleset write, including Disabled staging, the helper
re-reads the exact default-branch workflow inventory, CODEOWNERS errors, and
the named owner's repository permission. Before an active write it also
re-reads the canary lifecycle, base/head/test-merge SHA, exact verifier
run/job/CheckRun, exact canonical `display_title`, sole PR head/base binding,
including top-level `run.repository.id` and `run.head_repository.id` plus the
nested Actions-run repository IDs matching the current repository ID, and
collision inventory. After a write it reads the exact
ruleset and the complete consumer security snapshot back.
Use the recorded `V2_RULESET_NAME` in every staging, activation, and final
probe command. Confirm active enforcement, the same expected GitHub Actions source, strict
up-to-date, Code Owner review with stale approval dismissal, the new-ruleset
default of zero ordinary approvals without lowering an existing higher count,
conversation resolution, non-fast-forward default-branch protection, and an
explicitly empty `bypass_actors` array.

Only after that exact Active readback, derive the sole admissible cleanup state
from the complete pre-cleanup security snapshot. This read-only command first
requires the current legacy inventory to equal the original owner-approved
digest. Its stdout is one deterministic JSON object:

```bash
POST_CLEANUP_PLAN="$(mktemp)"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
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

Review the plan before authorising cleanup. It may remove only
`codex/review-gate`. If that removes the final item from classic
required-status policy, that empty policy and its `strict` field may disappear.
An emptied ruleset status rule may disappear, and the whole dedicated
legacy-only ruleset may disappear only if no other rule remains. Those are the
only structural exceptions. Repository/default-head identity, workflow and
CODEOWNERS inventory, owner permission, every field and non-legacy check
including `strict` and `app_id` in a surviving classic policy, and every
retained ruleset's identity, conditions, bypass actors, and unrelated rules
must remain exact.

Execute only that reviewed plan as the separately authorised legacy cleanup,
then perform the read-only post-cleanup closure with the same selected name and
recorded expected digest. It reads two complete security snapshots and
requires both rounds to be identical, equal the expected digest, clear on both
legacy surfaces, and bound to the same exact complete Active v2 policy:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --verify-post-cleanup \
  --expected-post-cleanup-security-sha256 \
  "${EXPECTED_POST_CLEANUP_SECURITY_SHA256}"
```

Do not re-derive after cleanup. Any cleanup/readback/verification failure or
inconclusive result leaves v2 Active. Preserve it, run only read-only
diagnostics, and report the exact remaining or indeterminate state; never
disable or roll back v2 to manufacture closure.

Then close the canary without merging it. Do not use `--delete-branch` on the
close command. Prove that the closed-unmerged PR still carries the recorded
head repository, ref, and OID, then use Git's exact-OID lease so deletion is
atomic with the final remote-ref comparison:

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

If the PR identity, remote OID, or lease does not match, stop and report it.
A mismatch before the leased push leaves the branch intact; a post-push read
failure leaves deletion outcome unknown. Never replace the leased deletion
with an unconditional delete.

Installation is complete when the default branch contains both canonical `@v2`
workflows, the active ruleset has the expected source and protections, both
legacy surfaces read back without `codex/review-gate`, and the closed-unmerged
canary records the exact successful native CheckRun on its current feature-head
SHA, plus the canonical run-name receipt and PR binding for its unchanged
current default-branch base and test-merge.
