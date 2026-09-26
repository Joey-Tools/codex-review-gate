# Historical organization review-gate handoff manifest

> **Historical archive — do not execute or instantiate this template.** It
> records the completed 2026-09-18 handoff, including historical writes and
> activation steps. The only current executable route for this cohort's
> bridge-removal authorization is the independent
> [`organization-review-gate-post-cutover-audit`](../organization-review-gate-post-cutover-audit/README.md)
> protocol. It produces the sole receipt that the current consumer admits.

`joey-tools-10-member-manifest.template.json` records the reviewed historical
handoff boundary for the active Joey-Tools v2 cohort. It captures the 2026-09-18
organization identity, the exact ordered 10 active repository identities, the
complete old organization ruleset writable state, the canonical workflow byte
identities, and the eight exact active repository-local legacy cleanup
transformations.
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
v1 and v2 manifests were not safe substitutes for that completed cutover.
Version 3 recorded its activation timing and the one temporary scheduler
boundary, so an older manifest could not silently omit either control.

## Current executable route

This v3 template is historical-handoff evidence, not a form to backfill after
the cutover. Do not replace any `REPLACE_WITH_...` value, including when a
later API read appears to match the old shape. If its contemporaneous canary,
scheduler, legacy-status, or cleanup evidence was never retained, it cannot be
reconstructed from a later observation. Use the independent
[`organization-review-gate-post-cutover-audit`](../organization-review-gate-post-cutover-audit/README.md)
protocol instead. It creates fresh v2 canaries for the fixed active cohort and
emits a new receipt whose scope is current-state proof rather than a claim
about the historical handoff.

## Archived protocol details

The remainder of this file, including its command transcript, is preserved
only to explain the completed rollout. It is not a present-day runbook: do not
run its `stage`, `quiesce-scheduler`, `activate`, `restore-scheduler`,
`apply-repository-cleanup`, or `verify --apply` commands. Statements using
imperative language below describe the historical protocol and its safety
requirements; they do not direct a new mutation of the already cut-over
cohort.

The historical helper's strict manifest validator rejected the template until
all repository ruleset IDs, exact CODEOWNERS bytes/owner identities, open
current-base canary identities, exact head/test-merge receipts, native v2
CheckRun/run/job identities, and temporary-bridge legacy commit-status IDs
were complete. A legacy CheckRun is not a substitute for the required commit
status. The v1
commit-status API has no integration binding, and its writer-controlled
`target_url` is not provenance evidence; treat it only as temporary
compatibility/availability evidence. Its commit binding comes from querying
the exact manifest-bound head SHA in the statuses endpoint; individual status
items do not carry a `sha` field. The authoritative producer proof is the native
v2 CheckRun bound to GitHub Actions integration `15368`, together with the
closed workflow inventory and default-read Actions policy. During historical
staging, the rollout recorded the organization v2 ruleset's returned ID in
`v2_ruleset.id` before activation. Every historical activation snapshot walked the
complete default-branch `.github/workflows` Git tree: the three canonical
files had exact bytes, the bridge was the sole temporary v1 exception, and no
additional v1/v2 caller or reserved-status producer could remain. Each direct
workflow-directory entry had to be a regular Git blob; nested trees and other
unsupported entry types made the inventory inconclusive. Each repository also
exposed a complete Actions policy with default workflow permissions set to
`read`; that policy was included in every cohort snapshot.

### Ruleset-detail visibility and materialized policy

Every historical manifest-bound ruleset detail read used a credential that
GitHub recognized as having write access to that exact ruleset: both organization
rulesets, all ten repository v2 rulesets, and every repository-local cleanup
surface. GitHub intentionally omits `bypass_actors` from a detail response for
an identity without that access. An omitted property is redacted evidence, not
an empty list; `null` or any non-array value is malformed. On that condition,
the historical protocol stopped without a receipt, changed to an eligible
credential, and restarted the read-only preview under the applicable freeze.
It never inferred an empty bypass list from a redacted response.

The ten checked-in repository-v2 snapshots also explicitly bind GitHub's
currently materialized pull-request and status parameters. They are frozen
observed policy values, not permissive reader defaults: a different, missing,
or additional parameter is drift and fails closed. In particular, the template
records the full merge-method set, empty reviewer and dismissal-actor lists,
the enabled unattributed-change approval, and
`do_not_enforce_on_create: false`. GitHub documents the unattributed-change
approval as enabled by default; the other fields are intentionally recorded as
the exact current readback rather than generalized as defaults.

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

At the historical initial stage, literal JSON `null` at `v2_ruleset.id` was the
only permitted incomplete manifest value. If `stage --apply` may have created
the rule but failed, it first attempted one read-only reconciliation; returned
`applied-recovered` plus `next_manifest_update` was verified success. If the
process was interrupted or remained unknown, the protocol did not replay the
POST. It used the read-only `--mode stage --recover-created-v2` entry without
`--apply` or a plan digest. That entry returned a manifest update only for one
unique same-name rule whose
source and full writable state exactly equalled canonical Disabled v2 while
the old rule remained at its exact before-state. Absent, multiple, Active or
drifted candidates failed closed. The historical recovery read held an external
organization-admin policy-mutation freeze for its complete duration.

For the completed organization activation, the scheduler lifecycle was:
`quiesce-scheduler` preview/apply, a **fresh** `activate` preview/apply, then
`restore-scheduler` preview/apply after the successful dual-enforcement
readback. Each historical mutating invocation took only the `plan_sha256`
emitted by its own immediately preceding preview. The following is an archival
command transcript, not a command sequence to run:

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

The historical `activate` step refused to use a pre-quiesce coverage snapshot.
It read the manifest-bound scheduler in `disabled_manually` state, proved the
scheduler's drained execution epoch, and then established a new stable coverage
snapshot. If `quiesce-scheduler` or `activate` failed after disable, the
deliberately durable `disabled_manually` state was recovery evidence, not a
signal to replay a PUT. The recovery path read the reported `recovery_code`,
determined whether dual enforcement had been reached, then took a new preview.
It used `restore-scheduler` only after that decision; it was also the explicit
recovery operation when activation did not proceed. An unknown disable/enable
outcome had to be reconciled by its exact manifest-bound state before another
mutation. The helper never restored the scheduler automatically after a failed
quiesce or activation.

The completed rollout kept every manifest-bound canary open, non-draft,
unmerged, and on the exact current default-branch base through the Active
organization-rule write and its stable dual-enforcement readback. Only after
that activation proof succeeded did it restore the scheduler and close the
canaries unmerged. Its `derive-cutover`, `apply-repository-cleanup`, and
`verify` phases intentionally did not depend on live canary PR/run/status
evidence after this boundary; they continued to read each repository's live
default branch and did not require its head to remain equal to the historical
canary base. Their authority was the current control-plane/ruleset closure:
exact
repository identity, complete regular-blob workflow inventory and bridge,
exact CODEOWNERS, default-read Actions policy with an explicit boolean
`can_approve_pull_request_reviews`, Active repository and organization v2
rules, and manifest-bound cleanup state.

The completed rollout ran every mutation as a preview first and passed its
emitted `plan_sha256` only to the matching `--apply` invocation.
`derive-cutover` was read-only and emitted the repository-level
transformations for review. The historical executor performed them only with
`--mode apply-repository-cleanup`: each item was GET, exact-before comparison,
surface-specific mutation, then exact-after readback. A stable mixture of
before/after items was resumable; already-after items were no-ops and a fresh
preview included only still-before items. After a mutation error or unknown
response, the executor first performed a narrow read-only reconciliation.
Exact after-state was complete; before-state, drift, or an unreadable result
stopped the batch for a fresh reviewed preview. It never blindly replayed the
request or its old digest.

The completed rollout held an external organization-admin policy-mutation
freeze from the `stage` preview through apply, readback, and any recovery. It
established an organization- and repository-admin freeze again before the
`quiesce-scheduler` preview and held it through the fresh `activate`
preview/apply, stable post-write dual-enforcement readback, and
`restore-scheduler` readback. The scheduler remained `disabled_manually`
between the explicit quiesce and restore commands; the historical protocol did
not allow a separate scheduler enable/disable during that boundary. It started
a third freeze before the `apply-repository-cleanup` preview and held it
continuously through cleanup apply/readback, final `verify` preview/apply, and
a separate final read-only `verify` receipt capture and validation. During
those freezes, the protocol did not change any organization/repository
ruleset, classic branch protection, condition, required check, or bypass
actor. During the third freeze, the restored manifest-bound scheduler remained
`active`; no administrator separately enabled or disabled it. The helper
validated the exact manifest-bound
bypass lists; it cannot
automatically discover or preserve an actor concurrently added outside that
snapshot. GitHub provides no documented conditional/CAS update for the
ruleset endpoint. Plan digests and adjacent rereads detect observed drift but
cannot make the final GET-to-PUT interval atomic.

`verify --apply` historically removed the whole legacy `required_status_checks`
rule from the old organization ruleset only after all repository actions read
back at their exact expected post-state. Each post-activation/cutover stable
snapshot also reread the manifest-bound scheduler and required its live Actions
workflow state to be `active`, then read the legacy-only repository from GitHub
and required its returned `full_name`, `id`, `node_id`, `default_branch`, and
`archived` flag to match the manifest. The final apply performed the stable
full-cohort read, an immediate complete cohort revalidation, and then direct
rereads of the old organization ruleset, the legacy-only repository, and the
manifest-bound scheduler as `active` and unchanged from the stable snapshot
immediately before its PUT. An unreadable response, identity mismatch, or
`archived: false` was inconclusive and sent no cutover write.

In the historical process, if scheduler restoration was skipped or failed,
`derive-cutover`, `apply-repository-cleanup`, and `verify` failed closed before
their next write with `recovery_code=activation-scheduler-restore-required`.
The recovery sequence took a fresh `restore-scheduler` preview/apply,
confirmed its manifest-bound active readback, then restarted the blocked
post-activation preview.

The historical `verify --apply` response was not bridge-removal authority.
Even after its write/readback, the control plane could drift. While the third
freeze was still active, the rollout ran `verify` again without `--apply` and
saved its **complete JSON output**. That output had top-level
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

Bootstrap retains the strict historical parsing distinction between `output/v1`
with receipt schema `1` plus 11 members and `output/v2` with receipt schema
`2` plus 10 active members; it rejects mixed versions. Both historical output
versions retain their published exact JSON shape and canonical digest for audit
only. Neither authorizes a new bridge removal: the current consumer rejects
this template's output before any local or GitHub mutation.

The historical protocol retained all temporary legacy bridge workflows until
that read-only verify reported the final two-snapshot closure: the new
organization v2 rule was active, every repository v2 policy and complete
workflow inventory remained exact, every repository-local legacy cleanup was
complete, and the old organization status rule was absent. An inconclusive or
drifting read retained the bridges, repaired the control-plane closure, and
reran the final read-only verify under the freeze. The freeze could end after
the full output was captured and validated. A known policy mutation before
bridge-removal preparation invalidated the old operational proof and required
a fresh output under a new freeze.

Historical handoff output is not a bridge-removal authority. Do not pass this
template's `organization-review-gate-handoff-output/v2` verify output to
`bootstrap-codex-review-gate.mjs --remove-legacy-bridge`; the consumer now
rejects it before any local or GitHub mutation. After a completed cutover, use
the separate [post-cutover fresh-audit template](../organization-review-gate-post-cutover-audit/README.md)
to create the only admitted proof. That proof rebinds current organization
policy and receipt-bound canary evidence at each consumer deletion boundary.
