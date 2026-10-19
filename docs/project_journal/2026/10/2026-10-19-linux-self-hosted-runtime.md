---
id: 20261019-linux-self-hosted-runtime
title: Linux Self-Hosted Runtime Support
status: completed
created: 2026-10-19
updated: 2026-10-19
branch: wip/linux-self-hosted-runtime
pr:
supersedes: []
superseded_by:
---

# Linux Self-Hosted Runtime Support

## Evidence And Cause

- HDR-streaming installation PR [#363](https://github.com/Joey-Project/HDR-streaming/pull/363)
  ran the canonical verifier at head `bdd0b67d0ae5b9ea8dd49dfdc64c4d41be8cabca`
  on Linux self-hosted runner `hdr-streaming-linux-03`. Job `117941899152` in
  run `39216630279` loaded published Action commit
  `c1d5fc87c73beef9882add0294cb582b54003fbd` and returned
  `unhealthy/not_applicable`, `recovery_code=unsupported_target`,
  `retry_safe=false`: `Action v2 supports GitHub-hosted Linux runners only`.
  It did not read findings or review threads. This was a runtime target
  rejection, not an unresolved finding, review-format failure or Node startup
  problem.
- The configurable runner workflows and installation guides already allow
  operator-selected self-hosted labels. The shared runtime target classifier
  still retained the older hosted-only restriction, creating an inconsistent
  supported boundary. Installer PR #128 does not remove that runtime check.

## Decision And Boundary

- Accept Linux runners with either known `RUNNER_ENVIRONMENT` value,
  `github-hosted` or `self-hosted`, through the shared verifier/controller
  classifier. Missing or unknown environment values and unsupported operating
  systems remain fail closed. This change does not add Windows or macOS
  runtime support.
- Joey explicitly chose configuration-based trust: selecting self-hosted
  through a workflow or applicable Org/repository runner variable means the
  deployment operator accepts that host. Do not add a trust flag, runner
  allowlist, host-registration API, attestation process or additional approval.
  This is an operator trust assumption, not proof of host integrity or
  isolation. A host receiving the controller's token must be trusted; separate
  jobs do not establish isolation from previous work on a persistent host.
- Preserve GitHub.com, same-repository/default-base/open-ready PR admission,
  exact head/base/test-merge binding, provider identity, complete finding and
  conversation handling, permissions, request budgets and all other target
  restrictions. No workflow event, runner-label default, token authority,
  repository protection, runtime App or background polling is introduced.
- Keep this source compatibility fix separate from the later release-intent
  PR and its privileged publisher approval. Existing `@v2` consumers receive
  the runtime correction only after the new patch payload is published; the
  workflow-label variable itself does not update Action code.

## Validation

- Node.js `v24.15.0`: all 1,033 selected tests passed without failures,
  cancellations or skips: 342 complete v2 runtime tests, 77 Action/workflow/
  security/CI contracts, and 614 core, legacy runner, evidence-budget,
  receipt/provenance, workflow-parser and installer-signal tests. The 77-test
  contract group was rerun after the documentation froze; repeated runs and
  overlapping focused tests are not added to the unique total.
- `npm run check`, project-journal validation and `git diff --check` passed.
  Commands used bounded logs and deadlines. The complete repository/bootstrap
  and release-pipeline suites were not run locally; remote Node.js 20/24 CI
  remains an independent delivery gate. No local formal review was run under
  the remote-only route.
- Production publication and a live self-hosted verifier rerun are separate
  from source fixture tests and are not claimed by this source entry.

## Next Steps

- Publish the separately authorized patch through the existing release-intent
  and staged source publisher. Human `marketplace-production` approval remains
  mandatory. Verify immutable release assets, signatures and the signed
  floating `v2` alias independently; do not duplicate an initial push-triggered
  publisher run or blindly repeat an ambiguous mutation.
- Return to the assigned HDR installation's exact-head review/CI and bootstrap
  boundary after publication. Do not reuse its older head's approval or
  exception, change its runner selection, remove legacy requirements or alter
  unrelated transport/protection policy as part of this source fix.

## Evidence

- [Observed unsupported-target job](https://github.com/Joey-Project/HDR-streaming/actions/runs/39216630279/job/117941899152).
- [Configured runner workflow decision](2026-10-17-configurable-consumer-runners.md).
- [Publication contract](../../../RELEASING.md).
