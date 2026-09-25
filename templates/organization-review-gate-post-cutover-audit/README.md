# Post-cutover fresh v2 audit

This directory defines a new, independent closure path for the already-cut-over
Joey-Tools v2 cohort. It does **not** recreate the 2026-09-18 organization
handoff or make a missing historical handoff record true after the fact.

Use it only when the active policy state is already v2-only but the historical
`organization-review-gate-handoff-manifest/v3` cannot be completed from
contemporaneous, reviewed evidence. Never fill that v3 template's old canary,
legacy-status, scheduler, or cleanup placeholders from a later observation.
Keep the historical template and any historical receipt as audit material; use
this new manifest for new evidence.

## Scope and protocol names

The checked-in starting point is
`joey-tools-10-member-manifest.template.json`. Its fixed contract is:

```text
manifest schema: organization-review-gate-post-cutover-audit-manifest/v1
audit kind:      fresh-v2-canary
mode:            post-cutover-audit
output schema:   organization-review-gate-post-cutover-audit-output/v1
receipt schema:  organization-review-gate-post-cutover-audit-receipt/v1
freshness cutoff: 2026-09-24T23:38:00Z
```

The helper's complete output is the only receipt carrier. A successful
read-only output has `status: "fresh-v2-canaries-verified"`, `applied: false`,
and `action: null`, and carries `post_cutover_audit_receipt` plus
`post_cutover_audit_receipt_sha256`. The implementation is authoritative for
the exact output validation and digest calculation. Preserve the full JSON
output, not only the embedded receipt.

The fixed active cohort has exactly these ten repositories, in template order:

1. `Joey-Tools/codex-apple-notes-toolkit`
2. `Joey-Tools/codex-debug-triage`
3. `Joey-Tools/codex-personal-sync`
4. `Joey-Tools/codex-private-workflows`
5. `Joey-Tools/codex-project-journal`
6. `Joey-Tools/codex-review-workflows`
7. `Joey-Tools/codex-rollout-backup`
8. `Joey-Tools/codex-toolbox`
9. `Joey-Tools/codex-workflow-hygiene`
10. `Joey-Tools/codex-session-retrospective-history`

This is an immutable authorization cohort, not a count-only or selector-only
constraint. For every listed entry, the checked-in JSON template's exact
`slug`, numeric `id`, `node_id`, and `default_branch` form one fixed identity
tuple. The producer canonically compares the complete ten-member identity set
before it makes any GitHub audit read or mints a receipt. Replacing one member
with another `Joey-Tools` repository—even if all organization-ruleset selectors,
workflow snapshots, and canary fields remain self-consistent—fails closed and
cannot authorize bridge removal.

`Joey-Tools/codex-waited-delivery` is the one fixed historical archived,
legacy-only repository. Its exact slug, numeric ID, node ID, `master` default
branch, and `archived: true` state are immutable audit inputs: another
archived repository cannot replace it. It remains bound in
`legacy_ruleset.legacy_only_repository` because the old organization rule
still protects its deletion/non-fast-forward policy. It is not an active
canary or bridge-removal member, although the consumable receipt records this
identity to preserve that exclusion. Do not create a migration, canary,
cleanup, or removal PR for it.

`Joey-Tools/codex-review-gate` is source-local and outside this cohort. Its
temporary bridge requires its own source-local closure proof; this receipt can
never authorize source bridge removal.

## What the manifest binds

The manifest records current, not reconstructed, facts:

- organization identity, the v2 organization ruleset's current expected
  policy, and the old ruleset's current **after** policy with no v1 required
  status;
- the exact ten active repository identities;
- each active repository's deployed frozen verifier, controller, and legacy
  bridge bytes, current CODEOWNERS descriptor, and v2 repository-ruleset
  identity/policy; and
- one new canary's exact PR, head, base, test-merge, v2 CheckRun, workflow run,
  job, workflow-ID, and run-attempt identities for each repository; and
- that PR's exact GitHub UTC `created_at` timestamp for each repository.

It deliberately contains no legacy commit-status evidence, legacy-writer scan,
scheduler history, activation history, or repository-cleanup history. Those
facts either belong to the historical handoff record or are irrelevant to this
new post-cutover question.

The known organization and repository v2 ruleset IDs/policies are already
filled from current readback. Replace only an explicit `REPLACE_WITH_...`
placeholder with a current authoritative read. In particular, obtain current
CODEOWNERS descriptors and all fresh canary evidence; never guess a hash, ID,
SHA, or timestamp. A ruleset-detail credential must disclose `bypass_actors`;
an omitted field is redaction, not proof that the list is empty.

## Fresh canary procedure

For each of the ten active repositories, create a **new**, same-repository,
open, non-draft PR from its then-current default branch. Make one harmless,
reviewable non-control-plane change. Its exact GitHub UTC PR `created_at` must
be strictly later than the fixed freshness cutoff `2026-09-24T23:38:00Z`.
The helper reads that live value, validates it against the manifest and cutoff,
and binds it into the receipt. The old September canary PRs are rejected even
if all other IDs are self-consistent or their old check is green: their runs
resolved an earlier floating `@v2` action target and their review history is
not a new single generation.

Use exactly one review-request producer for a canary head. Normally that is a
single exact `@codex review` request, followed by the normal controller
reconciliation if the summary calls for it. Bind the native
`codex/github-review-gate` CheckRun to the exact current feature head and its
current test merge, plus the unique workflow run, job, workflow ID, and run
attempt. Findings, ambiguous provider evidence, a stale base, an edited or
extra request generation, an incomplete API read, or a changed head/base/test
merge are inconclusive; repair the named condition or use a new replacement PR
instead of treating historical evidence as current.

The deployed cohort uses the frozen v3 consumer workflow profile intentionally.
This audit accepts that deployed profile and proves it as it actually runs; it
does not silently rewrite consumers to the evolving ordinary-install template.
The later bridge-removal PRs are the normalization point: they update the
workflow/CODEOWNERS control plane as needed and are full reviewed changes, not
deletion-only edits.

For `codex-private-workflows`, coordinate a quiet default-branch window before
and during its canary evidence and the final read. Its independent scheduled
private-overlay sync can open and auto-merge a sync PR, which can move
`master`. This post-cutover manifest intentionally does not recast scheduler
history as audit evidence; a changed base simply invalidates the affected
canary observation and must be retried from a newly bound scope.

After all ten canaries pass, take two complete stable snapshots. Each must
cover the full fixed cohort and the current ruleset/workflow/CODEOWNERS/canary
bindings. The two snapshots must agree exactly under the helper's canonical
comparison; a changed or unreadable item restarts or fails the audit rather
than being treated as absence. Only then does the helper emit the post-cutover
receipt.

Keep the new canaries open until the two-snapshot audit is complete. Close each
one unmerged afterwards. Closing an old or new canary does not itself prove
v2; the preserved complete output and its digest do.

## Human operator command shape

Prepare and review the instantiated manifest, then run the new read-only
mode. Do not substitute an old handoff mode or a reconstructed v3 manifest.

```bash
POST_CUTOVER_MANIFEST=/absolute/path/to/reviewed-post-cutover-audit.json
POST_CUTOVER_OUTPUT=/absolute/path/to/post-cutover-audit-output.json

node scripts/organization-review-gate-handoff.mjs \
  --manifest "$POST_CUTOVER_MANIFEST" \
  --mode post-cutover-audit > "$POST_CUTOVER_OUTPUT"
```

Read and validate the complete output before using its exact
`post_cutover_audit_receipt_sha256`. If it is inconclusive, keep all bridges
installed, correct only the reported live condition, and repeat with a fresh
audited scope. Do not replay a receipt after a known control-plane change.

## Agent execution boundary

An agent must first prove the selected worktree/repository is one exact active
member, collect every fresh canary field from GitHub, and stop on any mismatch.
It must not create a canary for the archived repository or source repository,
and it must not use an old canary or an old v3 placeholder as a shortcut.

After the receipt succeeds, prepare one separate bridge-removal PR per active
cohort member with the existing receipt flags:

```bash
node scripts/bootstrap-codex-review-gate.mjs \
  --prepare-worktree "$TARGET_ROOT" \
  --remove-legacy-bridge \
  --final-closure-receipt "$POST_CUTOVER_OUTPUT" \
  --expected-final-closure-receipt-sha256 \
  "$POST_CUTOVER_AUDIT_RECEIPT_SHA256" \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
```

The bootstrap boundary admits the receipt only for the bound active member.
It does not authorize a source-local bridge, `codex-waited-delivery`, a subset,
or a replacement repository. Treat each resulting PR as a normal
control-plane change: obtain the required reviews, pass the v2 gate, and merge
only after its current exact head is clean.

The consumer independently enforces the same fixed ten-member identity cohort
from the receipt's `full_name`, numeric `id`, `node_id`, and `default_branch`;
a digest-valid receipt with a substituted but otherwise self-consistent cohort
is not authority. For this post-cutover receipt format only, it also re-reads
the receipt-bound organization identity plus the exact legacy and v2 ruleset
details at proof admission and before every local mutation/removal-quarantine
boundary. Each detail must retain its ID, organization source, branch target,
and the receipt's SHA-256 of its complete writable policy. An unreadable
detail, restored `codex/review-gate`, or any legacy/v2 policy drift leaves the
bridge installed. The receipt does not carry a replayable repository-local
ruleset-policy snapshot, so the consumer does not invent an unbound complete
repository-policy hash comparison. It does re-read the target default branch's
classic required-status and effective-ruleset surfaces and requires that neither
still requires `codex/review-gate`; the separate origin/live-repository
identity/default-branch rebind continues to select the exact repository object.
These are point-in-time checks at the listed boundaries, not a claim of a
continuous remote lock. Historical handoff-v2 proofs remain identity-only
compatible because they contain no writable-policy fingerprints.
