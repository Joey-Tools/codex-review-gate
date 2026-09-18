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

Keep every manifest-bound canary open, non-draft, unmerged, and on the exact
current default-branch base through the Active organization-rule write and its
stable dual-enforcement readback. Only after that activation proof succeeds,
close the canaries unmerged. `derive-cutover` and `verify` intentionally do not
depend on live canary PR/run/status evidence after this boundary; they continue
to require the exact repository/default-branch identities, complete closed
workflow inventory and bridge, Active repository and organization v2 rules,
and manifest-bound repository cleanup state.

Run every mutation as a preview first and pass its emitted `plan_sha256` back
to the matching `--apply` invocation. `derive-cutover` is always read-only and
emits repository-level actions for separate, explicit execution; the helper
never writes those repository endpoints. `verify --apply` removes the whole
legacy `required_status_checks` rule from the old organization ruleset only
after all nine external actions read back at their exact expected post-state.
The final apply performs the stable full-cohort read, an immediate complete
cohort revalidation, and then a final direct read of the old organization
ruleset before its PUT. GitHub does not provide a documented conditional/CAS
update for this endpoint, so this is not transactionally atomic: maintain an
external organization-admin policy-mutation freeze for the entire final apply.
Post-write exact readback detects drift, but cannot reconstruct a write that
raced during the final request interval.

Keep all temporary legacy bridge workflows installed until `verify` reports
the final two-snapshot closure: the new organization v2 rule is active, every
repository v2 policy and complete workflow inventory remains exact, every
repository-local legacy cleanup is complete, and the old organization status
rule is absent. Bridge removal is a later, separate repository-PR phase.
