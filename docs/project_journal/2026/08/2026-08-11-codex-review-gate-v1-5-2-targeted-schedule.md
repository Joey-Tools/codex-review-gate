---
id: 20260811-codex-review-gate-v1-5-2-targeted-schedule
title: Codex Review Gate v1.5.2 targeted scheduling
status: active
created: 2026-08-11
updated: 2026-08-11
branch: codex/targeted-scheduled-scan
pr:
supersedes: []
superseded_by:
---

# Codex Review Gate v1.5.2 targeted scheduling

## Summary
- Version 1.5.2 is a compatible v1.x release that lets the packaged reusable workflow recognise the closed `workflow_dispatch` marker `codex_review_gate_trigger=scheduled-target-v1` as schedule-equivalent for auto-retry gating.
- The reusable workflow forwards `vars.CODEX_REVIEW_GATE_AUTO_RETRY` through the fixed `CODEX_REVIEW_GATE_AUTO_RETRY` environment binding. The marker remains caller event-payload protocol; neither value becomes a composite Action input.
- An exact `scheduled-target-v1` dispatch admits only an identical event-input/`PR_NUMBER` pair in canonical safe positive decimal form, so the caller's per-PR concurrency key and the runtime target cannot name the same PR through different strings. Ordinary manual, direct-composite, and GHES recovery retain the existing canonical `PR_NUMBER`-only route.
- Producer protocol major 1, receipt schema v1, decision policy 1.4, and release provenance schema v2 remain unchanged. Version 1.5.1 remains the first admitted reusable-workflow release.

## Frozen Release Boundary
- The canonical source remains `JoeyTeng/codex-review-gate:master`; `packages/action` remains the complete subtree source for `JoeyTeng/codex-review-gate-action:master`.
- Root and Action package versions, release-provenance generation, release tests, and bilingual release instructions target release `1.5.2` and tags `v1.5.2`, `v1.5`, and `v1`.
- The reviewed packaged reusable workflow raw SHA-256 is `c4b5c4eb61c8ae586357b44fffc951e751e7478685b56d299cb45ad391c659fb`.
- The immutable `v1.5.2` tag must never move. The `v1.5` and `v1` signed annotated aliases move together only after immutable release and provenance verification.

## Canary Boundary
- The existing source-root workflow exposes only its pull-request input and native global schedule. It cannot send the new marker without first changing that interface; pre-activating such a change before the aliases advance would let v1.5.1 misinterpret the dispatch.
- Immediately after the alias transaction, run an ordinary live GitHub.com canary through the existing source-root caller selecting `@v1`.
- After that canary passes, the downstream consumer branch that adds the marker must run a targeted-dispatch canary against one exact pull request. It may enable per-PR scheduling only after that canary and its intended auto-retry policy pass admission.

## Release Transaction
1. Merge the reviewed source PR and require the merge commit to be the exact source `master` tip.
2. Run the Action subtree sync for that exact source commit, require success, and prove the source `packages/action` tree equals the Action repository root tree.
3. Create and verify signed annotated local tags `v1.5.2`, `v1.5`, and `v1`, all peeling directly to the verified Action commit.
4. Generate and validate the provenance-v2 asset for the frozen source/action refs and signed tag objects.
5. Publish and verify the immutable `v1.5.2` release and exact provenance asset before moving either compatibility alias.
6. Move `v1.5` and `v1` in one atomic push using the persisted exact remote tag-object leases, then re-read and verify both aliases.
7. Run the ordinary source-root `@v1` canary, then the downstream targeted-dispatch canary before consumer scheduling activation.

## Local Validation
- `npm run check` and the complete `npm test -- --test-reporter=dot` suite pass after the canonical PR-number repair.
- Focused targeted-dispatch regressions reject leading-zero, signed, exponent, whitespace, unsafe-integer, non-string, and event/environment-mismatch inputs before any GitHub access; ordinary manual regressions preserve the canonical `PR_NUMBER` fallback.
- `node --check scripts/generate-action-release-provenance.mjs` and `node --check test/release-provenance.test.mjs` pass.
- `npm run test:release-provenance` passes all 51 tests.
- Project-journal validation and repository-wide `git diff --check` pass.
- A fresh SHA-256 read of the packaged reusable workflow matches the frozen release digest.

## Pending
- Repeat exact-secret admission and fixed-range formal review for the repaired source head, then merge the source PR.
- Complete subtree sync, signed-tag creation, immutable release publication, provenance-asset verification, and atomic alias movement.
- Record exact source/action commit and tree OIDs, tag-object OIDs, release asset digest, sync run, and both canary runs after the transaction completes.

## Evidence
- Packaged reusable workflow: `packages/action/.github/workflows/codex-review-gate.yml`
- Runtime and security tests: `test/gate-runner.test.mjs`, `test/workflow-security-contract.test.mjs`
- Release provenance: `scripts/generate-action-release-provenance.mjs`, `test/release-provenance.test.mjs`
- Release procedure: `docs/RELEASING.md`, `docs/RELEASING.zh-CN.md`
- Action package metadata: `package.json`, `packages/action/package.json`

## Generative AI Disclosure

This workstream was implemented with OpenAI Codex assistance.
