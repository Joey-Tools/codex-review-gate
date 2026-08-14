# Codex Review Gate v2

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

Codex Review Gate v2 is a trusted reusable GitHub workflow that reduces a
complete Codex provider-evidence snapshot, controls review-request and status
effects, and publishes the `codex/github-review-gate` commit status.

The public v2 release repository is
[`Joey-Tools/codex-review-gate-action`](https://github.com/Joey-Tools/codex-review-gate-action).
The personal [`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action)
repository is a frozen v1 archive and is not a v2 source.

> [!CAUTION]
> Production activation is not yet supported. The production controller-input
> assembler, durable scheduled dispatcher, and automatic effect chain are
> implemented and locally gated, but publication admission and live activation
> proof remain P0 prerequisites. Until the environment-wait preflight, required
> live canary, exact-SHA consumer rollout, and ruleset switch are complete, do
> not make `codex/github-review-gate` a required check. Missing or unverified
> activation evidence fails closed.

## Supported public boundary

Ordinary consumers call the trusted reusable workflow:

```yaml
jobs:
  codex-review-gate:
    uses: Joey-Tools/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v2
    with:
      pull-request: ${{ github.event.pull_request.number || github.event.issue.number || inputs.pull-request || '' }}
      controller-mode: ordinary
      observation-boundary: initial
```

`@v2` is the documented floating release alias. The release pipeline resolves
and publishes an immutable signed v2 commit, while the called workflow checks
out the exact selected workflow object through `job.workflow_repository` and
`job.workflow_sha`. Consumers delegate compatible v2 upgrades to that release
alias; they do not copy runtime files or select the composite Action directly.

The example is an interface specimen, not an activation recipe. A complete
production caller is the reviewed reconciliation graph, activated only after
publication by replacing every reusable call with the same admitted immutable
release SHA and satisfying [Repository activation](#repository-activation).
The release package's `.github/workflows/codex-review-gate-reconcile.yml` is a
template/contract fixture for that orchestration. It is not a central router
and must not be copied as proof that production activation is safe.

### Permissions

The caller supplies this permission ceiling:

```yaml
permissions:
  contents: write
  id-token: write
  issues: write
  pull-requests: write
  statuses: write
```

A called workflow cannot elevate the caller token. `id-token: write` and
`contents: write` are confined to the API-only controller jobs so each protected
Git-ledger record can carry exact workflow provenance and advance the dedicated
ledger ref. The trusted controller owns all mutation ordering and never checks
out or executes pull-request code.

## The composite Action is plan-only

`action.yml` is a low-level adapter for trusted controller implementations. It
can read one complete snapshot and produce closed v2 plans, but it deliberately
does not post comments, write commit statuses, persist effect ledgers, perform
public waits, or complete the gate.

Do not use this as a consumer gate:

```yaml
- uses: Joey-Tools/codex-review-gate-action@v2
```

Even an exact-SHA composite invocation remains plan-only. Treat its outputs as
untrusted-to-execute plans until a trusted controller validates, persists, and
performs them in the required order. A successful composite step is never a
successful review gate and must not be registered as a required status check.

The adapter inputs are intentionally controller-oriented:

| Input | Description |
| --- | --- |
| `github-token` | Token used only for complete read transport. |
| `pull-request` | Canonical positive pull-request number. |
| `operation` | `prepare-request`, `bind-request`, or `evaluate-only`. |
| `status-target-mode` | Required, with no default: `head` or `test-merge-with-head-sentinel`. `head` can publish only a non-success sentinel; clean/skipped terminal publication is suppressed. |
| `operation-input-path` | Controller-generated canonical JSON under `RUNNER_TEMP`; checkout and PR-controlled paths are rejected. |

Its outputs are runner-temp paths to the canonical rich public v2 report and
effect plans. The compact reducer result remains controller-internal:
`decision`, `result-path`, `report-path`, `status-plan-path`,
`reservation-path`, `intent-path`, and `binding-receipt-path`. They are not
receipts proving that any remote effect occurred.

## Reusable workflow inputs and outputs

The public `workflow_call` boundary accepts:

| Input | Default | Description |
| --- | --- | --- |
| `pull-request` | empty | Pull-request number; empty is reserved for a controller-owned scan. |
| `selection-policy` | none | Required closed repository selection policy. |
| `controller-mode` | `ordinary` | Closed route selected by the trusted workflow family. Consumers must not invent modes. |
| `observation-boundary` | `initial` | Closed scheduler observation boundary; it is never provider evidence. |

It reports controller-owned outputs such as `decision`, `report-path`,
`status-plan-path`, request reservation/binding paths, sticky and effect-ledger
receipt paths, `due-at`, and `wakeup-hints`. Paths refer to the called job's
`RUNNER_TEMP`; they are controller evidence, not a cross-job artifact API.
Only the controller's exact remote-effect receipts and final status establish
that an effect was performed.

## Scheduled scan and dispatch

The reconciliation schedule selects `scan-all-open` only for the trusted
coordinator. That coordinator builds or resumes the protected candidate
inventory, persists one active dispatch reservation before projection, and
publishes only a canonical GitHub matrix. It never uses the diagnostic
all-open-PR listing as dispatch authority.

The fan-out is deliberately serial (`max-parallel: 1`, `fail-fast: false`).
Each enabled row carries the controller-produced pull-request number and the
original canonical `dispatch_binding`; a row cannot rebuild, replace, or select
its own candidate. The scheduled leg rehydrates that binding from the durable
ledger before lease acquisition, performs the ordinary closed controller
protocol, releases the lease without a refund, and durably acknowledges the
candidate. A crash exposes either the same active row or a closed recovery
state; it never silently redispatches an attempted candidate. An empty cycle
uses one disabled sentinel row so no pull-request command is prepared.

## What v2 decides

The reducer's closed decisions are:

- `not-selected`
- `pending`
- `clean`
- `findings`
- `inconclusive`
- `skipped-unavailable`
- `blocked-configuration`
- `blocked-input`

Positive completion requires a complete and stable snapshot, a current review
epoch, compatible server enforcement, and provider evidence admitted by the
closed v2 authority. Trustworthy findings remain negative evidence even when
another inventory is incomplete. Missing configuration, unstable scope,
incomplete pagination, malformed evidence, or unproved activation never turns
into clean.

The controller targets the test-merge commit and uses a head sentinel where
required. Commit statuses are effects planned by the reducer/scheduler and
performed only by the trusted controller after durable reservation. The
Joey-Tools reusable workflow always supplies
`test-merge-with-head-sentinel`; consumers cannot select this production
value through variables. The public plan adapter retains `head` only for the
closed non-success/suppressed compatibility contract described above. The
request path is retry-zero: intent and attempt state are persisted before the
single POST, and an ambiguous attempt is not replayed.

## Repository activation

Activation remains blocked until all of the following are independently
reviewed and proven:

1. The reviewed release contains the closed command assembler, durable
   scheduled dispatcher, and automatic effect protocol for every supported
   event and scan route, and the admitted release tree matches those bytes.
2. The repository has the three named public-wait environments required by the
   v2 workflow family, each with an exact 15-minute wait-timer rule:
   `codex-review-gate-public-initial-15m`,
   `codex-review-gate-public-post-request-15m`, and
   `codex-review-gate-public-no-start-15m`.
3. A trusted Environment API preflight proves those rules, and a live canary
   proves that early release cannot authorize a request or terminal effect.
4. The generated caller uses the organisation `@v2` reusable workflow, the
   documented permission ceiling, and controller-owned concurrency.
5. The repository ruleset requires the exact
   `codex/github-review-gate` context only after successful canary evidence.

An environment name alone does not configure or prove a wait timer. A copied
fixture, a green composite step, or an observed status with a generic
`github-actions[bot]` creator is not activation proof.

## v1 archive boundary

The release subtree intentionally retains v1 implementation files,
`decision-table.json`, and `producer-receipt.schema.json` so the transferred
history and frozen v1 contract remain inspectable. They are legacy,
major-isolated artefacts:

- `decision-table.json` remains the authoritative v1 policy table only.
- `src/core.mjs`, `src/gate.mjs`, and producer receipt v1 are not v2 runtime
  entry points.
- v2 has no selector, compatibility fallback, or downgrade path to v1.
- the v2 target repository must contain no `v1*` branch or tag selector.
- a v2 configuration or evidence failure stays blocked/inconclusive; it never
  invokes the legacy reducer.

Existing personal-repository v1 consumers remain on their frozen archive.
Migration means installing the organisation v2 reusable workflow after its
activation gate closes; changing a personal `@v1` reference to an organisation
composite reference is not a valid migration.

## Package map

- `.github/workflows/codex-review-gate.yml`: trusted public v2 controller entry.
- `.github/workflows/codex-review-gate-reconcile.yml`: orchestration template
  and contract fixture, not a central router.
- `action.yml`: plan-only composite adapter.
- `src/v2/workflow-controller.mjs`: trusted effect-ordering controller runtime.
- `src/v2/action.mjs`: composite plan adapter.
- `src/v2/transport.mjs`, `projector.mjs`, `reducer.mjs`, `scheduler.mjs`, and
  related modules: closed v2 evidence and planning pipeline.
- `src/core.mjs`, `src/gate.mjs`, `decision-table.json`, and
  `producer-receipt.schema.json`: retained legacy v1 archive.
- [DESIGN.md](DESIGN.md): trust, state, and effect-ordering design.
- [COOKBOOK.md](COOKBOOK.md): pre-activation validation and recovery recipes.

## Feedback and development

Report public package issues at
[`Joey-Tools/codex-review-gate-action`](https://github.com/Joey-Tools/codex-review-gate-action/issues).
Canonical development and release automation live in
[`Joey-Tools/codex-review-gate`](https://github.com/Joey-Tools/codex-review-gate).
