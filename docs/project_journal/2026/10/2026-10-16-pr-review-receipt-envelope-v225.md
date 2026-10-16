---
id: 20261016-pr-review-receipt-envelope-v225
title: Pull Request Review Receipt Envelope Compatibility and v2.2.5
status: active
created: 2026-10-16
updated: 2026-10-16
branch: codex/pr-review-receipt-envelope
pr:
supersedes: []
superseded_by:
---

# Pull Request Review Receipt Envelope Compatibility and v2.2.5

## Evidence and Cause

- In [codex-review-workflows #140](https://github.com/Joey-Tools/codex-review-workflows/pull/140),
  the [failed verifier](https://github.com/Joey-Tools/codex-review-workflows/actions/runs/38956515022/job/117162549871)
  used released Action `f8405eb64d923a386969dd36fe0e637e698378af` and reported
  `unrecognized Codex terminal pull-request-review format` despite both review
  threads being resolved and a newer exact-head clean issue comment.
- Historical [review 5552636020](https://github.com/Joey-Tools/codex-review-workflows/pull/140#pullrequestreview-5552636020)
  has the known leading `<!-- codex-review-receipt:v1 -->` envelope before its
  native inline-parent review heading. Version 2.2.4 unwrapped that envelope
  for issue comments only. The two PR-review parser entry points rejected it
  before historical scoping, leaving blocking malformed evidence.
- [Source PR #123](https://github.com/Joey-Tools/codex-review-gate/pull/123)
  independently reproduced the same runtime failure at exact head
  `5985c6a680fcfabd1f8850247d7a59308542b1a9`: its current-head clean comment,
  twenty successful ordinary CI checks and six resolved threads could not
  clear the [required gate](https://github.com/Joey-Tools/codex-review-gate/actions/runs/38966895385/job/117198455239).
  This is separate from the installer-only YAML parser changes in #125/#123.

## Decision and Boundary

- Reuse the existing strict known-envelope decoder in the PR-review artifact
  parser and native inline-parent closed-grammar validator. Enable it only
  for v2 runtime callers; shared legacy callers retain their default behavior.
- Accept exactly one known leading marker and required blank separator after
  existing line-ending normalization. Do not strip arbitrary HTML or accept
  unknown, malformed, duplicate, misplaced or marker-only envelopes.
- Keep original carrier bytes and metadata, Bot/App provenance, review state,
  short/full commit binding, request ordering, complete stable snapshots and
  all unresolved-thread checks. A resolved historical review is not clean
  authority for the current head. PR-level summaries remain diagnostic-only.
- Select patch `2.2.5`, previous version `2.2.4`, from source baseline
  `445816a83180122d458b9e9b085c6ac0f03fc80d`. The publication target baseline
  is `JoeyTeng/codex-review-gate-action` master at
  `f8405eb64d923a386969dd36fe0e637e698378af`; schema 4, Node 24, signer and
  publisher controls remain unchanged. No consumer workflow, permissions,
  events, rulesets or policy overrides change.
- Source delivery and release intent share one focused PR. Protected source
  merge starts the existing publisher; only the privileged production stage
  requires human Environment approval. A stable signed release advances
  floating `v2`; installed consumers need no selector update or new Marketplace
  registration. Runtime publication is required to fix existing consumers.

## Validation

- Node `v24.15.0`: both new core-parser regressions failed before the runtime
  edits and passed afterward. The five new v2 integration registrations pass;
  they cover historical resolved/unresolved parent cases, current parent
  identity/state admission, malformed markers and native-commit mismatch.
- `node --test --test-concurrency=1 test/core.test.mjs
  test/v2-action.test.mjs test/v2-workflow-contract.test.mjs
  test/workflow-security-contract.test.mjs test/ci-test-shard.test.mjs`:
  all 209 tests passed. The complete `test/v2-gate-runtime.test.mjs` run passed
  all 339 tests, including pre-existing snapshot, request and thread guards.
- Retained legacy gate-runner, evidence-budget and producer-receipt suites
  passed all 314 tests under the same Node24 runtime, preserving legacy parser
  defaults and its separate provenance/receipt behavior.
- Three deterministic release-contract tests passed for schema-v2 historical
  candidates, schema-v3 Node24/alias publication and schema-v4 optional-token
  publication. Publisher controls and their tests are unchanged.
- Exact staged Git-blob inventory matches all 18 regular payload files,
  950,488 bytes and subtree `fc5dda0eea8511cf8b1a26c0844519e997c7d697`.
  Unrelated manifest controls match the frozen baseline. The unchanged
  publisher's `readReleaseManifest` accepts the v2.2.5 intent.
- `npm run check`, explicit final test-file syntax checks, project-journal
  validation and `git diff --check` passed. Local validation does not claim
  remote-review, source-merge or production-publication success.

## Remaining Publication Boundary

- Require exact-head remote Codex review, all required CI and normal merge
  policy; no local review or bypass is added. If an external gate cannot pass,
  report the blocker rather than deploy candidate approval logic.
- Verify the new immutable full tag, signed floating `v2`, Release assets and
  provenance after the existing protected publisher completes. Then reconcile
  only the explicitly assigned blocked PRs using their admitted contracts;
  continue source #123 and the HDR installation without rescanning consumers.
