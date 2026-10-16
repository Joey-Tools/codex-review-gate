---
id: 20261016-reviewed-status-writers
title: Reviewed Unrelated Commit-Status Writers During Installation
status: completed
created: 2026-10-16
updated: 2026-10-16
branch: wip/reviewed-status-writers
pr:
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
  `statuses: write` among the policy's relevant write permissions. The owner
  reviews the file, its invoked code and its non-gate status contexts.
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
- Frozen organization handoff/bridge-removal and source-only proof contracts
  remain unchanged and do not admit this exception. No runtime action bytes,
  release manifest, required context, events or consumer workflow templates
  change; a runtime release is not required for this installer-only fix.

## Validation

- Node v24.15.0: `npm run check` passed. All 75 selected policy, CI-sharding,
  workflow-security, v2-workflow and required-CI contract tests passed. The four
  focused CLI regressions also passed, including actual local preparation,
  unchanged-file preservation, no-op revalidation, invalid UTF-8 rejection,
  remote staging/activation, and content drift before a ruleset write.
- The real HDR-streaming preparation dry-run accepts its two unchanged
  transport workflows with the frozen declarations. No consumer assets or
  production settings were applied during source validation.
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
  floating `@v2` installation without changing its transport permissions.
- The separate HDR policy cleanup removes only CODEOWNERS-specific static
  assertions; transport runtime/definition and skip-list guards remain.
