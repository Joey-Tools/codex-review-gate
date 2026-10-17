---
id: 20261017-scoped-installer-signal-scan
title: Scoped Installer Signal Scan
status: completed
created: 2026-10-17
updated: 2026-10-17
branch: wip/scoped-installer-signal-scan
pr: https://github.com/Joey-Tools/codex-review-gate/pull/128
supersedes: []
superseded_by:
---

# Scoped Installer Signal Scan

## Summary
- The ordinary current-v2 installation boundary keeps canonical verifier/controller workflows, managed CODEOWNERS coverage, the required ruleset, and the repository-wide default-workflow-permissions read-only preflight strict while treating unrelated workflow-local write permissions as operator-trust warnings.
- The installer uses a best-effort source-text keyword scan to block explicit additional Codex gate callers and explicit uses of the reserved `codex/github-review-gate` signal. Potential gate collisions that the scan cannot resolve are warnings; unrelated keywords and contexts do not block installation. Plain-text references may produce nonblocking notices. The scan does not execute workflows, prove full data flow, prevent a malicious same-name forgery, or establish a unique producer.

## Current State
- The ordinary install does not require unrelated status, check, action, or contents publishers to be removed or isolated. Fragmented text, literal concatenations, and simple local-variable forms are scanned where possible; only potential gate collisions the keyword scan cannot resolve are warnings. Unrelated workflow-local write permissions remain operator-trust warnings. This policy does not relax the repository-wide default-workflow-permissions read-only preflight.
- `--reviewed-status-writer` remains an optional compatibility path for the older exact-digest and isolated-publisher check. It is not required for ordinary current-v2 installation; its stricter checks apply only when explicitly supplied.
- The historical organization handoff, bridge-removal, and source-only proof contracts remain frozen and strict. The prior `2026-10-16-reviewed-status-writers` note records its then-current decision and is not rewritten as though the policy had always been this way.
- HDR-streaming PR #363 restored `.github/workflows/transport-evidence-gate.yml` and `.github/workflows/transport-process-acceptance-gate.yml`; these unrelated transport status producers are left unchanged by ordinary gate installation.

## Decision and Reason
- Ordinary installation should not require refactoring unrelated transport, build, or release publishers. Joey accepted the shared GitHub Actions App and operator-trust boundary instead of an exhaustive unique-producer proof.
- Scan common literal fragments within bounded local segments, without executing scripts or resolving full data flow. Keep potential unresolved collisions as warnings, and never let the warning-output cap suppress a definite signal match.
- PR review exposed a missed simple YAML anchor prefix and an overbroad exact-token fallback. Recognize anchored literal callers and actual job-name fields, including simple quoted keys, observed indentation, and bounded folded values. Keep plain references in output, queries, root/step names, and artifact labels nonblocking; retain definite context/check-name publishing fields and explicit CheckRun API payload matches. This remains a heuristic, not full YAML interpretation or general alias/data-flow resolution.
- A later review identified three more explicit forms: a caller referenced through a previously declared scalar alias, an anchor prefix on a reserved job/context value, and a direct JSON CheckRun publication payload. Cover these bounded literal forms consistently rather than adding a general YAML or command interpreter. Unresolved or complex aliases remain warnings, and ordinary text or read-only references remain nonblocking; the scanner still does not prove a unique publisher.
- Scalar-alias handling is limited to previously declared simple literals in the current document, with at most 32 names and 512 characters per value; document boundaries reset that state. Literal JSON publication matching requires one explicit curl POST with a matching `/check-runs` name or `/statuses/<sha>` context payload. Explicit backslash continuations are joined under a bounded local-command budget, not across job, step, or document boundaries. It does not associate independent commands or resolve arbitrary payload variables/files. These limits preserve the approved best-effort boundary instead of claiming exhaustive alias or shell interpretation.
- Role evidence matters for both directions of the heuristic: recognize simple quoted job IDs in flow mappings, but do not classify a `with.uses` input as an executable selector. Only clear job/step selectors block as callers; uncertain positions warn rather than upgrading data references into collision proof.
- Handle direct flow-map properties independently of their order or unrelated nested permission values. A quote-aware local map/list reader is capped at 2048 characters and depth 8; incomplete or over-budget structures warn. Inspect only direct job `name`/`uses` and step `uses`, skipping nested input data. This fixes common literal forms without claiming general YAML interpretation. Literal curl status-context publication and the documented `gh api --raw-field` spelling receive the same bounded treatment as their existing CheckRun and short-flag forms.
- Keep policy selection explicit at post-cleanup closures. Bridge-free consumer derive/verify must not inherit the ordinary warning-only default; every repeated closure read uses strict inventory validation. Existing apply/source-proof paths already require the bridge profile, and the shared explicit policy fixes that invariant for them too. Preserve existing digest/content/isolation-validated reviewed-writer exceptions where the full consumer cleanup profile admits them; source/organization proof restrictions remain unchanged. The ordinary staging/activation default is intentionally warning-only and must not leak into evidence used to remove or verify removal of legacy protections.
- Align the root Chinese README and packaged READMEs/security guidance with the ordinary operator-trust boundary. The existing release manifest describes its historical exact source commit; documentation corrections do not rewrite that released payload, change executable runtime behavior, or authorize a release or alias move.
- Restore the HDR transport files to their installation base; the removed isolation requirement must not leave incidental runner, publishing, or lint-policy changes behind.

## Next Steps
- Existing consumers need no Action runtime upgrade or floating-tag move for this installer-only change. The remaining HDR deployment and exact-head approval belong to its installation workstream.

## Validation
- Node.js 24.15.0: all 170 bootstrap tests passed across four disjoint partitions (43/43/42/42). All 105 scanner, reviewed-writer, canonical workflow, security, YAML, and CI-shard contract tests passed, including 24 scanner unit tests; all 254 historical organization-handoff tests passed.
- Scanner and CLI fixtures cover continued curl CheckRun/status publications, quoted and nested flow jobs, later step selectors, real job/step selectors versus `with.uses` input data, the `gh api --raw-field` spelling and implicit POST, and strict bridge-free cleanup derive/verify rejection without mutation. Bounds and incomplete flow structures retain warning-only behavior.
- `npm run check`, CI `actionlint`, `git diff --check`, and source project-journal validation passed. Synthetic Git fixtures disable signing only in their test-process environment; the landing commit remains signed.
- The actual HDR worktree passed an ordinary installer dry-run without reviewed-writer declarations: verifier, controller, and CODEOWNERS were all no-ops; unrelated write permissions produced warnings. No API call or `--apply` was used.
- HDR's 86 focused Python tests passed on available Python 3.14.7; configured Python 3.12 was unavailable. Ruff and all seven workflows' actionlint checks passed. Both transport workflows, both corresponding test files, and the lint configuration match base `e4494ead9b29d00203395981346a09a4029fc395` byte-for-byte.
- The focused HDR journal passed trusted parser/semantic validation. Its whole-repository journal validation remains blocked by a pre-existing legacy entry over 1 MiB; no unrelated history was changed. No hardware suite, live status POST, or rollout canary was run.

## Evidence
- `docs/project_journal/2026/10/2026-10-16-reviewed-status-writers.md`
- HDR-streaming PR #363 transport workflow restoration: `.github/workflows/transport-evidence-gate.yml` and `.github/workflows/transport-process-acceptance-gate.yml`.
