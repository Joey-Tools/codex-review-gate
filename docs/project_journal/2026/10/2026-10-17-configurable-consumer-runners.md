---
id: 20261017-configurable-consumer-runners
title: Configurable Consumer Runners
status: completed
created: 2026-10-17
updated: 2026-10-17
branch: codex/configurable-consumer-runners
pr:
supersedes: []
superseded_by:
---

# Configurable Consumer Runners

## Decision and Scope

- Joey requested self-hosted runner support for both the canonical verifier
  and controller, and restoration of the existing runner selector in HDR's
  unrelated transport process status publishers. Do not impose a hosted-only
  installation requirement where an operator explicitly selects a trusted
  self-hosted pool.
- Both canonical workflows use the Org/repository Actions variable
  `CODEX_REVIEW_GATE_RUNNER_LABELS` as a JSON runner label or nonempty label
  array. Explicit configuration takes precedence over the existing
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST` fallback; the unconfigured default
  remains `ubuntu-slim`. No runtime runner discovery or registration occurs.
- Keep the event filters, permissions, commit binding, concurrency and
  pass/block semantics unchanged. A consumer workflow update is required to
  use the new selector; changing the floating Action tag alone cannot update
  a caller's `runs-on` expression.
- Keep an exact closed predecessor path for the previously installed runner
  expression. Do not normalize arbitrary workflow drift or extend historical
  organization-handoff and legacy-bridge proof authority.

## Reviewed Status Writers

- Retain exact UTF-8 workflow digests, independent owner review, read-only
  workflow permissions and explicit job-level `statuses: write` only on
  self-contained inline publishers. No actions, checkout, artifacts, repository
  scripts, containers or inherited executable configuration enter those jobs.
- Admit only the supported literal label forms and the narrowly parsed
  `fromJSON(vars.NAME || '<literal JSON>')` selector. Do not use PR/event,
  `inputs`, `needs` or `matrix` values to route privileged jobs.
- Runner host security is an operator prerequisite. Workflow hashes bind
  selector bytes, not current Actions-variable values, runner label mappings
  or host state. Separate jobs do not establish host/process isolation;
  token-bearing self-hosted pools must be trusted and isolated from residual
  PR-controlled processes.

## Delivery Boundary

- This change affects installer code, canonical caller workflows and guides,
  not the published Action payload. It does not need a runtime version bump,
  release or floating `@v2` mutation.
- HDR is the only consumer installation in scope. Preserve its transport
  contexts, actual India test runner, protected definitions and unrelated
  branch protections. Do not reuse an approval or bootstrap exception for an
  earlier installation head after updating that head.

## Validation

- Node 24.15.0: 58 focused runner/workflow/security contracts, all 170
  bootstrap cases, all 254 organization-governance cases and 23 CI/sharding/
  lexer tests pass across partitioned runs and targeted reruns (505 distinct
  selected tests). The new bootstrap test is included in the closed 170-test
  inventory; the existing four-way sharding now covers 43/43/42/42 cases.
- Initial full runs exposed stale assertions for the old hosted-only runner
  rule and historical-error precedence. Update the negative cases to reject
  untrusted event routing, and isolate runner versus permission differences
  when asserting historical policy rejection. Do not weaken frozen identities
  or accept a current workflow as historical proof.
- Three existing temporary-repository fixtures inherited the workstation's
  global signing configuration. Their targeted reruns set process-local
  `commit.gpgsign=false` only for synthetic fixtures; actual source/consumer
  landing commits still require signatures. No user Git or GPG configuration
  is changed by the fixture workaround.
- `npm run check`, source workflow actionlint, journal validation and
  `git diff --check` pass. The published Action payload and release manifest
  are unchanged. No live self-hosted Actions canary or production settings
  mutation is part of the local validation.
- The actual HDR files pass canonical preparation and no-op readback with
  their exact workflow digests, both canonical workflows match the templates,
  and all four inline publishers pass `bash -n` and ShellCheck. All 87 focused
  HDR tests and repository-configured workflow lint pass.
