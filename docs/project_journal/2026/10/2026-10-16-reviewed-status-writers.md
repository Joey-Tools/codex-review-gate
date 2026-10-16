---
id: 20261016-reviewed-status-writers
title: Reviewed Unrelated Commit-Status Writers During Installation
status: completed
created: 2026-10-16
updated: 2026-10-16
branch: wip/reviewed-status-writers
pr: https://github.com/Joey-Tools/codex-review-gate/pull/123
supersedes: []
superseded_by:
---

# Reviewed Unrelated Commit-Status Writers During Installation

## Evidence and Decision

- The canonical HDR-streaming installation preview rejects
  `.github/workflows/transport-evidence-gate.yml` and
  `.github/workflows/transport-process-acceptance-gate.yml` solely for their
  legitimate `statuses: write` permissions. These workflows produce unrelated
  transport statuses and must not lose that production authority merely to
  install the Codex gate. Joey authorised an installer compatibility fix.
- Keep default denial and add repeatable explicit
  `--reviewed-status-writer PATH@SHA256` declarations. Each unique noncanonical
  workflow must match the reviewed UTF-8 content digest and have exactly
  `statuses: write` among the policy's relevant write permissions.
- PR review identified a gap in workflow-only binding: an unprotected script
  can change after workflow review and execute with the same write token.
  Joey approved isolating the two HDR transport publishers rather than
  extending CODEOWNERS across product code or creating a common publishing
  service. Require read-only workflow permissions and explicit job-level
  status authority only on self-contained inline Bash publishers on literal
  `ubuntu-slim`. Privileged jobs cannot import actions, checkout, artifacts,
  repository scripts, containers or executable configuration. PR-executing
  jobs must not inherit status-write authority.
- The owner reviews the exact inline code and its data flow: SHA/context from
  trusted metadata, terminal state from GitHub job results, no execution of
  PR-produced text or mutable/unprotected downloaded code. Structural profile
  checks prevent implicit executable dependency entry points; they do not
  attempt to prove arbitrary shell semantics.
- A digest binds reviewed content, not arbitrary script behavior. This is an
  explicit trust decision under the existing canonical CODEOWNERS and
  independent exact-head approval contract, not a claim that static parsing
  proves a workflow cannot publish a colliding context. GitHub Actions App
  integration id 15368 is still shared by all Actions producers.
- Gate callers, reserved native job names, malformed/opaque permission
  declarations, and every other relevant write permission remain rejected.
  No-op declarations, missing/changed files, duplicate/canonical paths, and
  invalid digests fail closed. Do not auto-learn or silently renew declarations.
- Repeat the reviewed declarations at every local and full-profile remote
  phase. Existing complete workflow fingerprints and cleanup security digests
  bind the retained content; local mutation checkpoints and remote pre/post
  write reads revalidate it. Keep diagnostic declarations on stderr so JSON
  plan outputs remain machine-readable.
- A second review finding exposed a lifecycle dead end: initial bridge
  installation accepted declarations that later bridge cleanup could not
  accept. Reject `--legacy-bridge` plus reviewed writers before installation;
  keep the historical proof contracts frozen rather than extending their
  authority. Frozen organization handoff/bridge-removal and source-only proof
  contracts remain unchanged and do not admit this exception. No runtime action bytes,
  release manifest, required context, events or consumer workflow templates
  change; a runtime release is not required for this installer-only fix.

## Validation

- Node v24.15.0: `npm run check` passed. After the P1/P2 repairs, all 75
  selected policy, CI-sharding, workflow-security, v2-workflow and required-CI
  contract tests passed. The four focused CLI regressions also passed
  (79 total), including actual local preparation, unchanged-file preservation,
  no-op revalidation, invalid UTF-8 rejection, remote staging/activation,
  content drift before a ruleset write, matching-digest self-hosted denial,
  and bridge-plus-declaration rejection.
- The six policy test registrations include split read-only test jobs with
  isolated pending/final publishers and rejection of mutable/local actions,
  checkout/dependency imports, interpreter environment injection, opaque
  fields and writer permissions hidden by irregular indentation or quoted/
  sequence job headers. Bootstrap registration remains 169; required CI
  matrix/sharding contracts are unchanged by the repairs.
- The original HDR-streaming preview with unchanged transport workflows
  passed the initial digest-only policy, but the P1 review showed why that
  result was insufficient: executable dependencies were not bound. That
  preview is not acceptance evidence for the isolated-publisher policy.
  No consumer assets or production settings were applied during source
  validation.
- After the approved privilege split, the actual two HDR workflow files pass
  the isolated-writer validator and the canonical preparation dry-run.
  This verifies the real consumer shape, not only synthetic fixtures. The
  preview still performs no asset application or production settings write.
- An earlier broad historical replay was incomplete: one bootstrap shard
  completed, other shards were interrupted, and an unrelated organization
  handoff simulation exhausted its local time budget. No full-suite pass is
  claimed. The subsequently corrected CI test inventory and documentation
  contracts are included in the 75 passing final targeted checks.
- Joey narrowed the migration budget to HDR-streaming only. Previously
  migrated repositories are skipped, without renewed online inventories,
  reinstallations, canaries or historical cohort replay. Existing required CI
  is not weakened; focused source regression is separate from rollout budget.

## Follow-up Boundary

- Land the independently reviewed source fix, then resume HDR-streaming's
  floating `@v2` installation together with the approved transport privilege
  separation. Preserve transport contexts, preflight checks, result mapping
  and protected definition sets; do not remove legitimate status producers.
- The separate HDR policy cleanup removes only CODEOWNERS-specific static
  assertions; transport runtime/definition and skip-list guards remain.
