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
  explicit, snapshot-bound actions which preserve their other rules. Only after
  their readback and a full cohort pre-cutover snapshot may the old organization
  ruleset be updated.
- The sole old-rule cutover mutation is a `PUT` to the existing ruleset ID that
  removes its `codex/review-gate` required-status rule. It never deletes the
  ruleset. Two complete, stable cohort snapshots must show that every member is
  covered by v2 and that all old non-v1 policy is unchanged.
- Removal of each temporary bridge is a later, separate PR phase. It returns
  consumers to the ordinary no-v1-caller installation contract after the
  global cutover is closed.

## Current State

- Source implementation is on `codex/organization-v2-handoff`, based on
  `dff68c8279a659b79479cd4fc6876eecbb715fc2`.
- No organization ruleset, repository ruleset, consumer default branch, or
  consumer pull request has been mutated by this workstream yet.
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
  derive/verify snapshots deliberately omit the closed canary lifecycle while
  retaining every canonical control-plane and policy check.
- Before the old organization-rule `PUT`, the helper repeats the complete
  cohort revalidation and then reads the old rule's writable identity directly
  adjacent to the write. GitHub's ruleset update endpoint has no conditional
  compare-and-swap contract, so the final apply requires an external
  administrator policy-mutation freeze. Readback proves the response and
  subsequent state but cannot reconstruct an external update overwritten in
  the final GET-to-PUT interval.
- A partial activation remains fail closed: the old v1 rule stays active and
  the new v2 rule is not used as evidence to remove v1. The transaction does
  not automatically delete or weaken either rule.
- The organization handoff manifest is evidence for a bounded API transaction,
  not a durable decision ledger. GitHub remains the authority; each recovery
  reruns the full readback before continuing.

## Next Steps

1. Finish the exact bridge and organization-handoff implementation with unit
   coverage and operator-facing installation guidance.
2. Run local validation, journal validation, fixed-head review, and create the
   source PR.
3. After the source change lands, create the 11 migration PRs and stage the
   new organization v2 rule without removing v1.
4. Collect each exact canary proof, activate v2 organization protection, remove
   the bound repository-level legacy contexts, and perform the one old-rule
   v1-status removal with double-read verification.

## Evidence

- Stable release: `https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.0.0`
- Old organization ruleset: `Joey-Tools` ruleset `16590367`, read through
  `GET /orgs/Joey-Tools/rulesets/16590367` on 2026-09-18.
- Prior v2 decisions and implementation ledger:
  `docs/project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md`.
