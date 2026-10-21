---
id: 20261021-publisher-discovered-test-sharding
title: Automatically Discovered Publisher Test Shards
status: completed
created: 2026-10-21
updated: 2026-10-21
branch: wip/publisher-discovered-test-sharding
pr:
supersedes: []
superseded_by:
---

# Automatically Discovered Publisher Test Shards

## Cause And Scope

- The v2.2.8 publisher's original
  [core validation job](https://github.com/Joey-Tools/codex-review-gate/actions/runs/39562043752/job/119095797458)
  was cancelled by its 14-minute job deadline. The official CheckRun annotation
  explicitly reports `The job has exceeded the maximum execution time of 14m0s`.
  The publication jobs were skipped; this was not a partially completed publish.
- Its frozen source/control is `1bfdd6f9394d00dd42e4f35d8873035909c95260`.
  The classifier still required an exact 14-file inventory, but source had 17
  test files. The three additions were `reviewed-status-writers.test.mjs`,
  `workflow-gate-signals.test.mjs` and `workflow-yaml.test.mjs`. That mismatch
  disabled the four bootstrap shards and moved the entire bootstrap suite
  into the serial legacy core cell. Merely updating the classifier would
  still omit the new files from the explicit modern core command.
- Joey requested automatic glob discovery and sharding instead of maintaining
  a hardcoded complete inventory. This is a separate publisher-control repair:
  no Action runtime, package version, release manifest, consumer, protection,
  approval or signer changes belong to it.

## Decisions And Reasons

- Keep the existing four internal bootstrap shards and four internal Release
  shards. File-only sharding cannot divide either large single-file suite.
- Recursively discover the other frozen-source `test/**/*.test.mjs` files,
  sort deterministically and distribute them across four core-file shards.
  New ordinary files automatically participate without disabling sharding or
  being omitted from an explicit list. Preserve argv-safe paths, propagate
  discovery failures and avoid implicit discovery when the core list is empty.
- Preserve the sealed bootstrap-shard capability boundary for retained-source
  recovery. Only genuinely pre-capability sources use the legacy serial
  discovery path, in core shard 1 once, with the Release suite disabled; the
  four Release cells retain their existing coverage. Additional test files
  alone no longer cause fallback.
- Retain existing runners, timeouts, `fail-fast: false`, independently built
  candidates, complete matrix dependency and human `marketplace-production`
  approval. Parallelise complete coverage instead of reducing tests or merely
  increasing the job deadline.
- The user had already started attempt 2 of the original publisher. This
  repair does not cancel or duplicate it. Ordinary reruns use their original
  workflow, so applying a later control repair to the original intent must
  follow the separately checked exact-source recovery/admission contract.
- That user-triggered attempt subsequently passed its legacy core cell in
  12 minutes 15 seconds. After Joey approved production, publication and public
  verification both succeeded. The verifier reported `verified/complete`,
  `recovery_code=none`, exact source `1bfdd6f9394d00dd42e4f35d8873035909c95260`
  and tag `v2.2.8`. Independent metadata and provenance reads confirm immutable
  Release `419345792`, all three assets and valid signed `v2.2.8`/`v2` tags
  peeling to `e258b4a750528a8437393a0e31b208455cec5413`.
  This timing-dependent successful retry does not fix the classifier defect;
  no recovery dispatch or new Action version is needed for this control repair.

## Validation

- Local Node v24.15.0 ran the workflow's actual discovered-core command in all
  four native file shards across the current 15 ordinary test files. All four
  passed; the complete parallel run took approximately 211 seconds.
- Four selected publisher tests passed: executable workflow-discovery fixtures,
  staged ABI and credential boundaries, schema-v2 Node20 candidate compatibility
  and schema-v3 Node24 publication compatibility. This is selected coverage,
  not a claim that a new full local bootstrap or Release suite was executed.
- The executable fixtures run real Bash and temporary Node modules. They prove
  inclusion of the three previously omitted files and a new nested path with
  spaces, exactly-once four-shard coverage, deterministic repeats, two files
  across four shards, empty/missing-heavy rejection, legacy classification and
  propagation of a failed discovery pipeline.
- The first full core run caught generated fixture import text being counted
  by the existing source-only registration guard. Representing that generated
  text in fragments corrected the fixture without weakening the guard or
  changing top-level test registrations. The final registration suite passed
  all 16 tests, and the complete four-core-shard rerun passed.
- `npm run check`, all seven source-validation shell blocks through `bash -n`
  and ShellCheck 0.11.0, journal validation and whitespace checks passed. The
  shell validation models the observed GitHub runner's `bash -e` invocation.
- The implementation worker used GPT-6 Luna Max; the parent owned the docs,
  final validation and delivery. Formal local review was not run. Current-head
  GitHub Codex review and required CI remain separate PR acceptance evidence.
- No new publisher execution is claimed for this control-only repair. The
  independently verified original v2.2.8 publication is recorded above.

## Publication Boundary

- The frozen v2.2.8 intent, Action payload and original admission remain
  unchanged. A control-only merge does not create another release intent or
  automatically trigger a new initial publisher.
- Check the original publisher's current state before any recovery action.
  Retain mandatory human approval and independent verification of immutable
  Release assets, provenance, signatures and floating `v2`.
