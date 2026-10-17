---
id: 20261017-scoped-installer-signal-scan
title: Scoped Installer Signal Scan
status: completed
created: 2026-10-17
updated: 2026-10-17
branch: wip/scoped-installer-signal-scan
pr:
supersedes: []
superseded_by:
---

# Scoped Installer Signal Scan

## Summary
- The ordinary current-v2 installation boundary keeps canonical verifier/controller workflows, managed CODEOWNERS coverage, the required ruleset, and the repository-wide default-workflow-permissions read-only preflight strict while treating unrelated workflow-local write permissions as operator-trust warnings.
- The installer uses a best-effort source-text keyword scan to block explicit additional Codex gate callers and explicit uses of the reserved `codex/github-review-gate` signal. Potential gate collisions that the scan cannot resolve are warnings; unrelated keywords and contexts are ignored. The scan does not execute workflows, prove full data flow, prevent a malicious same-name forgery, or establish a unique producer.

## Current State
- The ordinary install does not require unrelated status, check, action, or contents publishers to be removed or isolated. Fragmented text, literal concatenations, and simple local-variable forms are scanned where possible; only potential gate collisions the keyword scan cannot resolve are warnings. Unrelated workflow-local write permissions remain operator-trust warnings. This policy does not relax the repository-wide default-workflow-permissions read-only preflight.
- `--reviewed-status-writer` remains an optional compatibility path for the older exact-digest and isolated-publisher check. It is not required for ordinary current-v2 installation; its stricter checks apply only when explicitly supplied.
- The historical organization handoff, bridge-removal, and source-only proof contracts remain frozen and strict. The prior `2026-10-16-reviewed-status-writers` note records its then-current decision and is not rewritten as though the policy had always been this way.
- HDR-streaming PR #363 restored `.github/workflows/transport-evidence-gate.yml` and `.github/workflows/transport-process-acceptance-gate.yml`; these unrelated transport status producers are left unchanged by ordinary gate installation.

## Decision and Reason
- Ordinary installation should not require refactoring unrelated transport, build, or release publishers. Joey accepted the shared GitHub Actions App and operator-trust boundary instead of an exhaustive unique-producer proof.
- Scan common literal fragments within bounded local segments, without executing scripts or resolving full data flow. Keep potential unresolved collisions as warnings, and never let the warning-output cap suppress a definite signal match.
- Restore the HDR transport files to their installation base; the removed isolation requirement must not leave incidental runner, publishing, or lint-policy changes behind.

## Next Steps
- Existing consumers need no Action runtime upgrade or floating-tag move for this installer-only change. The remaining HDR deployment and exact-head approval belong to its installation workstream.

## Validation
- Node.js 24.15.0: all 170 bootstrap tests passed across four disjoint partitions (43/43/42/42). All 93 scanner, reviewed-writer, canonical workflow, security, YAML, and CI-shard contract tests passed; all 254 historical organization-handoff tests passed.
- `npm run check`, CI `actionlint`, `git diff --check`, and source project-journal validation passed. Synthetic Git fixtures disable signing only in their test-process environment; the landing commit remains signed.
- The actual HDR worktree passed an ordinary installer dry-run without reviewed-writer declarations: verifier, controller, and CODEOWNERS were all no-ops; unrelated write permissions produced warnings. No API call or `--apply` was used.
- HDR's 86 focused Python tests passed on available Python 3.14.7; configured Python 3.12 was unavailable. Ruff and all seven workflows' actionlint checks passed. Both transport workflows, both corresponding test files, and the lint configuration match base `e4494ead9b29d00203395981346a09a4029fc395` byte-for-byte.
- The focused HDR journal passed trusted parser/semantic validation. Its whole-repository journal validation remains blocked by a pre-existing legacy entry over 1 MiB; no unrelated history was changed. No hardware suite, live status POST, or rollout canary was run.

## Evidence
- `docs/project_journal/2026/10/2026-10-16-reviewed-status-writers.md`
- HDR-streaming PR #363 transport workflow restoration: `.github/workflows/transport-evidence-gate.yml` and `.github/workflows/transport-process-acceptance-gate.yml`.
