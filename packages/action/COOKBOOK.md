# Codex Review Gate v2 Cookbook

Languages: [British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

This cookbook documents the v2 public boundary and pre-activation checks. It
does not authorise production activation: the controller and scheduled
dispatcher are locally gated, but publication admission and live activation
proof are still P0 prerequisites.

## Choose the correct entry point

For an ordinary repository, the target call is always the organisation-owned
trusted reusable workflow:

```yaml
jobs:
  codex-review-gate:
    uses: Joey-Tools/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v2
    with:
      pull-request: ${{ github.event.pull_request.number || github.event.issue.number || inputs.pull-request || '' }}
      controller-mode: ordinary
      observation-boundary: initial
```

The caller also grants only:

```yaml
permissions:
  contents: write
  id-token: write
  issues: write
  pull-requests: write
  statuses: write
```

`@v2` is the documented release alias. The release pipeline publishes it over
an immutable signed v2 commit, and the reusable workflow checks out the exact
selected workflow object. Do not substitute either of these forms:

```yaml
- uses: Joey-Tools/codex-review-gate-action@v2
- uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1
```

The first is only the plan adapter; the second is the frozen personal v1
archive. Neither is a v2 consumer gate.

## Pre-activation checklist

Keep the repository fail-closed until every item is proved:

1. The reviewed release contains the complete caller, closed controller inputs,
   durable scheduled dispatcher, and automatic effect protocol for all enabled
   event and scan paths.
2. The generated caller selects the organisation reusable workflow at `@v2`,
   not the composite Action or personal archive.
3. The three public-wait environments exist with exact 15-minute wait timers:
   `codex-review-gate-public-initial-15m`,
   `codex-review-gate-public-post-request-15m`, and
   `codex-review-gate-public-no-start-15m`.
4. A trusted Environment API preflight has read and validated those protection
   rules. Matching environment names are not sufficient.
5. A live canary proves that server time and observation boundaries reject an
   early environment release and cannot authorise a request or terminal write.
6. Controller-owned concurrency serialises effects for the same repository,
   PR, and review epoch.
7. The ruleset does not require `codex/github-review-gate` until all earlier
   checks pass.

The release package's `codex-review-gate-reconcile.yml` is a template and
contract fixture used to validate orchestration shape. It is not a hosted
central router and is not production activation evidence.

## Validate scheduled fan-out

The schedule route must remain one protected coordinator followed by a serial
matrix fan-out:

- only the coordinator receives `scan-all-open` and an empty pull-request;
- its output is parsed directly with
  `fromJSON(needs.schedule-dispatch.outputs.matrix)`;
- every enabled row passes the coordinator's pull-request number and raw
  `dispatch_binding`, never a caller selector or re-encoded object;
- the matrix uses `max-parallel: 1` and `fail-fast: false`;
- each scheduled leg rehydrates the durable reservation before acquiring a
  lease, then releases and acknowledges exactly that candidate; and
- an empty inventory emits one disabled sentinel, while an attempted candidate
  enters recovery instead of being emitted again.

Reject a caller that lists open pull requests itself, constructs rows from an
input PR number, converts the binding with `toJSON`, runs scheduled rows in
parallel, or omits the `matrix.enabled` step guards.

## Validate the selected major

Before enabling a generated caller, inspect only its callsite and selected
repository/ref:

```text
repository: Joey-Tools/codex-review-gate-action
workflow: .github/workflows/codex-review-gate.yml
release alias: v2
status context: codex/github-review-gate
```

Reject activation when a caller references `JoeyTeng`, `@v1`, a direct root
Action, a copied runtime file, or a locally invented controller mode.

The v2 repository may retain `src/core.mjs`, `src/gate.mjs`,
`decision-table.json`, and `producer-receipt.schema.json` because its history
contains the v1 archive. Those paths do not select a runtime. There must be no
`v1*` branch/tag selector in the v2 target, and the v2 controller has no code
path that falls back to the v1 reducer.

## Interpret an adapter run

The composite adapter accepts one trusted, controller-generated operation
input and returns files under `RUNNER_TEMP`. Use it only while implementing or
testing a controller.

A normal adapter result may include:

- a closed reducer `decision`;
- the canonical rich public v2 report (the compact reducer result stays internal);
- a status plan;
- a request reservation or retry-zero intent;
- an exact-201 binding plan.

It does not mean that a status, comment, sticky projection, or ledger record
exists on GitHub. Do not expose adapter plans to a later untrusted job, upload
them as an execution command, or translate a green step into gate success.

If an adapter attempts a non-read transport or reports that it performed a
write, treat the invocation as invalid. The trusted workflow controller, not
the adapter, owns durable reservation, pre-effect attempt recording, the one
remote effect, response binding, sticky projection, and final status.

## Manual evaluation

`evaluate-only` is a controller-owned manual route. It must not publish a
status or request a review. It is useful for validating a projected snapshot,
but a clean evaluation is not a remote gate result and cannot satisfy branch
protection.

Do not use `evaluate-only` to bypass the activation gate or manufacture a
success status. A manual caller must still be generated by the trusted
assembler once that assembler is supported.

## Diagnose common blocked outcomes

### `blocked-configuration`

Check the trusted workflow selection, required ruleset/source binding, GitHub
App binding, public-wait environments, and activation evidence. Do not retry
through the composite or fall back to v1.

### `blocked-input`

Check the PR lifecycle, exact base/head/merge-base/test-merge epoch, canonical
input schema, and controller-generated path ownership. PR-controlled checkout
files are not valid operation inputs.

### `inconclusive`

Check complete pagination, scope stability, final reread, evidence grammar,
request limits, and durable controller history. Preserve the outcome until a
new complete and stable observation is available; do not reinterpret it as
clean.

### `findings`

Treat the selected trustworthy finding as blocking negative evidence. Resolve
the finding through the provider-supported review flow, then let a later
controller observation rebuild the complete snapshot. Do not edit controller
state to erase it.

### `pending`

Follow `due-at` and `wakeup-hints` only through the generated orchestration.
They are scheduling advice, not evidence. Public routes require the configured
environment wait and a subsequent server-time-bound observation; a sleeping
shell step or immediate rerun is not equivalent.

### `skipped-unavailable`

This is a closed v2 decision for an implicitly selected route with a confirmed
no-start outcome. It does not authorise v1 fallback. An explicitly requested
route instead remains blocked when its required provider configuration is
unavailable.

## Request-effect recovery

Review-request publication is retry-zero. The controller persists a
reservation, intent, and pre-effect attempt before the one POST, then binds the
exact 201 response. If the POST result is ambiguous, do not rerun or reclaim
the effect. Preserve the ledger and investigate from its authoritative effect
identity.

Similarly, commit-status and sticky-comment effects are reserved in the
durable effect ledger before execution. A repeated invocation may reuse an
already bound response, but it must not replay an attempted, unbound identity.

## Status and branch-protection checks

Before making the gate required, prove in a live canary that:

- terminal policy targets the expected test-merge commit;
- the documented head sentinel is present when required;
- the latest exact context is `codex/github-review-gate`;
- remote effect receipts bind the expected repository, PR, epoch, and response;
- final reread remains stable through the terminal write;
- an early or missing public wait fails closed.

A generic `github-actions[bot]` creator, matching context text, composite
success, or runner-temp report path is insufficient on its own.

## Migrating from v1

Do not edit an existing personal `@v1` caller in place until v2 activation is
supported. Preserve the frozen v1 workflow while preparing a separately named
v2 generated caller and canary. After all v2 prerequisites pass, migrate the
required check to `codex/github-review-gate` under an explicit repository
rollout plan.

Never copy v1 `decision-table.json` settings into v2 controller inputs. The v1
table is legacy authority for policy major 1 only; v2 selection, evidence,
decisions, scheduling, and effect ledgers are closed under their own schemas.

For the trust and state model, see [DESIGN.md](DESIGN.md). For the public
interface, see [README.md](README.md).
