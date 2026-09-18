# Organization review-gate handoff manifest

`joey-tools-11-member-manifest.template.json` is the reviewed starting point
for the fixed Joey-Tools cohort selected by organization ruleset `16590367`.
It records the 2026-09-18 organization identity, the exact ordered 11
repository identities, the complete old organization ruleset writable state,
the canonical workflow byte identities, and the nine exact repository-local
legacy cleanup transformations.

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

Keep every manifest-bound canary open, non-draft, unmerged, and on the exact
current default-branch base through the Active organization-rule write and its
stable dual-enforcement readback. Only after that activation proof succeeds,
close the canaries unmerged. `derive-cutover`, `apply-repository-cleanup`, and
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
and repository-admin freeze again for `activate`, from preview through stable
post-write readback. Start it a third time before the
`apply-repository-cleanup` preview and hold it continuously through cleanup
apply/readback, final `verify` preview/apply, and a separate final read-only
`verify` receipt capture and validation. During these freezes, do not change
any organization/repository ruleset, classic branch protection, condition,
required check, or bypass actor. The helper validates the exact manifest-bound
bypass lists; it cannot
automatically discover or preserve an actor concurrently added outside that
snapshot. GitHub provides no documented conditional/CAS update for the
ruleset endpoint. Plan digests and adjacent rereads detect observed drift but
cannot make the final GET-to-PUT interval atomic.

`verify --apply` removes the whole legacy `required_status_checks` rule from
the old organization ruleset only after all repository actions read back at
their exact expected post-state. The final apply performs the stable
full-cohort read, an immediate complete cohort revalidation, and then a final
direct read of the old organization ruleset before its PUT.

Do not use the `verify --apply` response to authorize bridge removal. Even
after its write/readback, the control plane may drift. While the third freeze
is still active, run `verify` again without `--apply` and save its **complete
JSON output**. It must have top-level
`schema_version: "organization-review-gate-handoff-output/v1"`,
`mode: "verify"`, `status: "final-verified"`, `applied: false`, and
`action: null`; contain a
`final_closure_receipt` with `schema_version: 1`; and publish
`final_closure_receipt_sha256`. The embedded receipt binds the organization,
manifest and final snapshot digests, legacy/v2 ruleset IDs and terminal states,
and the fixed, complete eleven repository identities in canonical UTF-8-byte
`full_name` order. It cannot contain a subset or expanded cohort. Its top-level
`plan_sha256` binds the final read-only `verify` plan (`mode`, manifest digest,
snapshot digest, and `action: null`). The receipt SHA-256 binds the canonical
embedded receipt, not the file's formatting.

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
`default_branch` equality with one entry in the fixed eleven-member receipt
cohort. At the pre-rename boundary it reads `origin` before and after the live
metadata query, repeats the local object checks, then reads `origin` once more
immediately before the atomic bridge quarantine rename. An observed same-name
re-creation, repository transfer, default-branch drift, unreadable metadata,
or mismatch fails closed and leaves the bridge installed. It also rejects an
apply result, an extracted receipt object, a stale or changed digest, and a
receipt for another repository.
