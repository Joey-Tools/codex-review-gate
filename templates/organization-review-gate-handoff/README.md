# Organization review-gate handoff manifest

`joey-tools-10-member-manifest.template.json` is the reviewed starting point
for the active Joey-Tools v2 cohort. It records the 2026-09-18 organization
identity, the exact ordered 10 active repository identities, the complete old
organization ruleset writable state, the canonical workflow byte identities,
and the eight exact active repository-local legacy cleanup transformations.
The old ruleset's fixed 11-ID selector intentionally still includes archived
`Joey-Tools/codex-waited-delivery`: it retains that repository's `deletion` and
`non_fast_forward` protection, but it does not make it an active v2 member.
`legacy_ruleset.legacy_only_repository` records that exception as its fixed
full identity: `slug`, numeric `id`, `node_id`, `default_branch`, and
`archived: true`. The old selector must contain the ordered ten active IDs plus
that one ID exactly once; an arbitrary eleventh ID, a duplicate, or an identity
that overlaps an active member is rejected. This prevents a superficially
valid selector from silently moving the archived repository's protection to an
unrelated repository.
The template uses `organization-review-gate-handoff-manifest/v3`; historical
v1 and v2 manifests must not be reused for this cutover. Version 3 binds the
activation timing and the one temporary scheduler boundary described below, so
an older manifest cannot silently omit either control.

The template is intentionally not executable as checked in. Replace every
`REPLACE_WITH_...` value with an API-read identity after the corresponding
repository migration and canary are complete. Do not replace placeholders with
guesses. The helper's strict manifest validator rejects the template until all
repository ruleset IDs, exact CODEOWNERS bytes/owner identities, open current-base
canary identities, exact head/test-merge receipts, native v2 CheckRun/run/job
identities, and temporary-bridge legacy commit-status IDs are complete. A
legacy CheckRun is not a substitute for the required commit status. The v1
commit-status API has no integration binding, and its writer-controlled
`target_url` is not provenance evidence; treat it only as temporary
compatibility/availability evidence. Its commit binding comes from querying
the exact manifest-bound head SHA in the statuses endpoint; individual status
items do not carry a `sha` field. The authoritative producer proof is the native
v2 CheckRun bound to GitHub Actions integration `15368`, together with the
closed workflow inventory and default-read Actions policy. After staging
the organization v2 ruleset, record its returned ID in
`v2_ruleset.id` before activation. Every activation snapshot also walks the
complete default-branch `.github/workflows` Git tree: the three canonical
files must have exact bytes, the bridge is the sole temporary v1 exception,
and no additional v1/v2 caller or reserved-status producer may remain. Each
direct workflow-directory entry must be a regular Git blob; nested trees and
other unsupported entry types make the inventory inconclusive. Each
repository must also expose a complete Actions policy with default workflow
permissions set to `read`; that policy is included in every cohort snapshot.

Version 3 also binds timing and the one scheduler that can create fresh
legacy-writer work during the organization handoff:

- `activation.legacy_evidence_stability_timeout_ms` is the bounded retry window
  for one repository's legacy-status proof. The template uses 900,000 ms.
- `activation.repository_evidence_timeout_ms` bounds every repository's complete
  activation evidence read, including its legacy proof and control-plane read.
  The template uses 1,200,000 ms.
- `activation.scheduler_snapshot_timeout_ms` bounds each scheduler state
  snapshot. The template uses 120,000 ms. The activation preflight and both
  scheduler snapshots surrounding the drain each use this bound independently.
- `activation.organization_evidence_timeout_ms` bounds the organization
  control-plane read in a coverage round. The template uses 120,000 ms.
- `activation.coverage_round_timeout_ms` caps one complete full-cohort coverage
  round. The template uses 9,000,000 ms. A successful round has the explicit
  8,340-second topology bound: 2,100 seconds for scheduler drain, two
  120-second scheduler snapshots, then `max(120, ceil(10 / 2) * 1,200)`
  seconds while the organization read and five two-repository evidence waves
  run in parallel. The remaining 660 seconds are intentional round slack.
- After the scheduler sequence, a branch failure retains the first observed
  error but waits for the sibling branch and every already-started repository
  worker to finish before returning. An early organization failure can therefore
  wait for the remaining bounded repository phase; this is intentional
  fail-closed draining.
- `activation.coverage_stability_timeout_ms` caps one two-round stable coverage
  pair. The template uses 18,005,000 ms, exactly two 9,000-second rounds plus
  the five-second stable-read interval.
- Every repository binds `legacy_writer_scan_timeout_ms`. The normal value is
  60,000 ms; `Joey-Tools/codex-private-workflows` alone uses 300,000 ms for its
  2,133-run historical writer inventory.
- `scheduler_quiescence` is `null` everywhere except
  `Joey-Tools/codex-private-workflows`. Its one descriptor binds workflow ID,
  path `.github/workflows/scheduled-sync-release.yml`, exact Git blob and
  SHA-256 identities, the required initial `active` state, and a 2,100,000 ms
  drain timeout. It is not a verifier or legacy bridge descriptor, and no
  other workflow or repository is permitted to opt into this mechanism.

The workflow YAML inventory, Actions workflow inventory, and local repository
ruleset inventory each have a hard 32-entry admission cap. Exceeding one is
inconclusive and fails closed rather than expanding a control-plane read without
bound. These caps do not claim a hard upper bound on HTTP pagination requests;
the separately enforced phase deadlines remain the wall-clock boundary for
paginated GitHub reads.

The reviewed deployment manifest may raise its soft limits only within the
validated maxima: 1,800 seconds per repository, 300 seconds per scheduler
snapshot, 600 seconds for organization evidence, 15,000 seconds per round, and
30,005 seconds per stable pair. Any raised values must still satisfy the
manifest topology formula; they are reviewed input, not ad hoc CLI overrides.

The private scheduler is the only workflow that is temporarily disabled. It
can start a repository sync which in turn starts the retained v1/v2 producers;
the verifier and temporary legacy bridge must remain enabled throughout the
handoff. The helper inventories every page of the scheduler's run history
without `status`, `head_sha`, event, or creation-time filters. After disable,
an already-started run is allowed to finish normally and is never cancelled.
The helper accepts the drain only after two complete, identical inventories
show terminal run states; otherwise it leaves the scheduler
`disabled_manually` and stops before organization activation.
These are upper capacity limits, not a promise that `activate` consumes the
whole duration or any kind of GitHub Actions-minutes-free operation. A normal
path ends when its actual reads complete. Pre-write and post-write stable
coverage apply both bounds: each constituent coverage round independently has
the one-round cap, and the complete pair has the two-round cap. Immediate
revalidation has only the one-round cap. The per-round bound prevents one
overlong read from consuming the pair budget and keeping the scheduler
`disabled_manually` longer than its own capacity. Every scheduler snapshot,
repository evidence read, and organization evidence read also has its own
deadline, so a single slow control-plane phase cannot silently consume the
whole round.

Before the initial stage, literal JSON `null` at `v2_ruleset.id` is the only
permitted incomplete manifest value. If `stage --apply` may have created the
rule but fails, it first attempts one read-only reconciliation; returned
`applied-recovered` plus `next_manifest_update` is verified success. If the
process is interrupted or remains unknown, do not replay the POST. Run the
read-only `--mode stage --recover-created-v2` entry without `--apply` or a plan
digest. It returns a manifest update only for one unique same-name rule whose
source and full writable state exactly equal canonical Disabled v2 while the
old rule remains at its exact before-state. Absent, multiple, Active or
drifted candidates fail closed. Hold an external organization-admin
policy-mutation freeze for the complete recovery read.

Before organization activation, use the explicit scheduler lifecycle in this
order: `quiesce-scheduler` preview/apply, a **fresh** `activate` preview/apply,
then `restore-scheduler` preview/apply after the successful dual-enforcement
readback. Each mutating invocation takes only the `plan_sha256` emitted by its
own immediately preceding preview:

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

`activate` refuses to use a pre-quiesce coverage snapshot. It reads the
manifest-bound scheduler in `disabled_manually` state, proves the scheduler's
drained execution epoch, and then establishes a new stable coverage snapshot.
If `quiesce-scheduler` or `activate` fails after disable, the deliberately
durable `disabled_manually` state is recovery evidence, not a signal to replay
a PUT. Read the reported `recovery_code`, determine whether dual enforcement
was reached, then take a new preview. Use `restore-scheduler` only after that
decision; it is also the explicit recovery operation when activation did not
proceed. An unknown disable/enable outcome must be reconciled by its exact
manifest-bound state before another mutation. The helper never restores the
scheduler automatically after a failed quiesce or activation.

Keep every manifest-bound canary open, non-draft, unmerged, and on the exact
current default-branch base through the Active organization-rule write and its
stable dual-enforcement readback. Only after that activation proof succeeds,
restore the scheduler, then close the canaries unmerged. `derive-cutover`,
`apply-repository-cleanup`, and
`verify` intentionally do not depend on live canary PR/run/status evidence
after this boundary; they continue to read each repository's live default
branch and do not require its head to remain equal to the historical canary
base. Their authority is the current control-plane/ruleset closure: exact
repository identity, complete regular-blob workflow inventory and bridge,
exact CODEOWNERS, default-read Actions policy with an explicit boolean
`can_approve_pull_request_reviews`, Active repository and organization v2
rules, and manifest-bound cleanup state.

Run every mutation as a preview first and pass its emitted `plan_sha256` back
to the matching `--apply` invocation. `derive-cutover` is always read-only and
emits the repository-level transformations for review. Execute them only with
`--mode apply-repository-cleanup`: each item is GET, exact-before comparison,
surface-specific mutation, then exact-after readback. A stable mixture of
before/after items is resumable; already-after items are no-ops and a fresh
preview includes only still-before items. After a mutation error or unknown
response, the executor first performs a narrow read-only reconciliation. Exact
after-state is complete; before-state, drift, or an unreadable result stops the
batch for a fresh reviewed preview. Never blindly replay the request or its old
digest.

Hold an external organization-admin policy-mutation freeze from the `stage`
preview through apply, readback, and any recovery. Establish an organization-
and repository-admin freeze again before the `quiesce-scheduler` preview and
hold it through the fresh `activate` preview/apply, stable post-write
dual-enforcement readback, and `restore-scheduler` readback. The scheduler
remains `disabled_manually` between the explicit quiesce and restore commands;
do not allow a separate scheduler enable/disable during that boundary. Start a
third freeze before the
`apply-repository-cleanup` preview and hold it continuously through cleanup
apply/readback, final `verify` preview/apply, and a separate final read-only
`verify` receipt capture and validation. During these freezes, do not change
any organization/repository ruleset, classic branch protection, condition,
required check, or bypass actor. During the third freeze, the restored
manifest-bound scheduler must remain `active`; no administrator may separately
enable or disable it. The helper validates the exact manifest-bound
bypass lists; it cannot
automatically discover or preserve an actor concurrently added outside that
snapshot. GitHub provides no documented conditional/CAS update for the
ruleset endpoint. Plan digests and adjacent rereads detect observed drift but
cannot make the final GET-to-PUT interval atomic.

`verify --apply` removes the whole legacy `required_status_checks` rule from
the old organization ruleset only after all repository actions read back at
their exact expected post-state. Each post-activation/cutover stable snapshot
also rereads the manifest-bound scheduler and requires its live Actions
workflow state to be `active`, then reads the legacy-only repository from
GitHub and requires its returned
`full_name`, `id`, `node_id`, `default_branch`, and `archived` flag to match the
manifest. The final apply performs the stable full-cohort read, an immediate
complete cohort revalidation, and then direct rereads of the old organization
ruleset, the legacy-only repository, and the manifest-bound scheduler as
`active` and unchanged from the stable snapshot immediately before its PUT. An
unreadable response, identity mismatch, or `archived: false` is
inconclusive and sends no cutover write.

If scheduler restoration was skipped or failed, `derive-cutover`,
`apply-repository-cleanup`, and `verify` fail closed before their next write
with `recovery_code=activation-scheduler-restore-required`. Run a fresh
`restore-scheduler` preview/apply, confirm its manifest-bound active readback,
then restart the blocked post-activation preview.

Do not use the `verify --apply` response to authorize bridge removal. Even
after its write/readback, the control plane may drift. While the third freeze
is still active, run `verify` again without `--apply` and save its **complete
JSON output**. It must have top-level
`schema_version: "organization-review-gate-handoff-output/v2"`,
`mode: "verify"`, `status: "final-verified"`, `applied: false`, and
`action: null`; contain a
`final_closure_receipt` with `schema_version: 2`; and publish
`final_closure_receipt_sha256`. The embedded receipt binds the organization,
manifest and final snapshot digests, legacy/v2 ruleset IDs and terminal states,
and two fixed, complete 10-member active identity lists in canonical UTF-8-byte
`full_name` order. `manifest_repositories` is derived only from the reviewed
manifest; `repositories` is the stable live observation. Each contains
`full_name`, `id`, `node_id`, and `default_branch`, and the two lists must be
canonically identical entry by entry before a schema-2 receipt is emitted or
admitted. The current rollout additionally rejects either list if any member
matches archived `Joey-Tools/codex-waited-delivery` by case-insensitive slug,
numeric ID, or node ID. That is a deliberate full-identity boundary: the slug
detects rename, transfer, or same-slug reuse, while ID/node ID bind the GitHub
object. The archive therefore cannot enter an active receipt list. The old
11-ID legacy selector is deliberately not an authorization source for bridge
removal. Its top-level `plan_sha256` binds the final read-only `verify` plan
(`mode`, manifest digest, snapshot digest, and `action: null`). The receipt
SHA-256 binds the canonical embedded receipt, not the file's formatting.

Bootstrap accepts historical final receipts only as the strict pair
`output/v1` plus receipt schema `1` plus 11 members, and current receipts only
as the strict pair `output/v2` plus receipt schema `2` plus 10 active members.
It rejects mixed versions. Schema-1 receipts retain their published exact JSON
shape and canonical digest for historical audit, but authorize no new bridge
removal. For schema 2, the consumer validates both lists and authorizes a
bridge removal only by looking up `origin` in the manifest-derived
`manifest_repositories` list; it never authorizes from the observed list or
the legacy selector.

Keep all temporary legacy bridge workflows installed until that read-only
verify reports the final two-snapshot closure: the new organization v2 rule is
active, every repository v2 policy and complete workflow inventory remains
exact, every repository-local legacy cleanup is complete, and the old
organization status rule is absent. If this read is inconclusive or finds
drift, keep the bridges, repair the control-plane closure, and rerun the final
read-only verify under the freeze. The freeze may end after the full output is
captured and validated. A known policy mutation before bridge-removal
preparation invalidates the old operational proof; obtain a fresh output under
a new freeze.

Bridge removal is a later, separate repository-PR phase. Pass the full verify
output to `bootstrap-codex-review-gate.mjs --remove-legacy-bridge` as
`--final-closure-receipt PATH`, plus the output's exact canonical receipt
digest as `--expected-final-closure-receipt-sha256 SHA256`. The bootstrap
parses the worktree's unambiguous GitHub `origin`, reads current repository
metadata from GitHub, and requires exact `full_name`, `id`, `node_id`, and
`default_branch` equality with one entry in the fixed 10-member
manifest-derived `manifest_repositories` cohort. The observed `repositories`
list is independently validated for exact equality but is not an authorization
source. `codex-waited-delivery` is intentionally absent and therefore cannot
authorize bridge removal. At the pre-rename boundary it reads `origin` before
and after the live metadata query, repeats the local object checks, then reads
`origin` once more immediately before the atomic bridge quarantine rename. An
observed same-name re-creation, repository transfer, default-branch drift,
unreadable metadata, or mismatch fails closed and leaves the bridge installed.
It also rejects an apply result, an extracted receipt object, a stale or changed
digest, and a receipt for another repository.
