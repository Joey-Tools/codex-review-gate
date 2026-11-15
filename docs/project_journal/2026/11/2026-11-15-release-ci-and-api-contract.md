---
id: 20261115-release-ci-api-contract
title: Focus Release CI And Replay Native API Identity
status: completed
created: 2026-11-15
updated: 2026-11-15
branch: wip/ci-release-intent-lite
pr:
supersedes: []
superseded_by:
---

# Focus Release CI And Replay Native API Identity

## Decision And Scope

- Keep this follow-up small: three new routing tests and a real GraphQL
  identity projection replayed in the existing native-completion success test.
  Its source is PR 150's official summary, queried read-only on 2026-11-15.
  Preserve the string BigInt and Bot identities; the scenario owns body, URL
  and clock. Existing tests retain their null/editor and negative cases.
- Pure version/manifest/journal PRs use two release-intent jobs after successful
  full master-push CI for their exact base. Reuse existing publisher plan and
  candidate verification. Other paths, package metadata changes, unavailable
  base evidence and unsupported intent shapes retain full CI. Master pushes
  and dispatches always run the full matrices.
- Keep current-head remote review, required state-machine checks, independent
  publisher validation and human production approval. Summary event routing
  remains an observation item. The Action payload/version is unchanged.

## Validation

- Node.js 24.15.0: all 65 selected CI/workflow tests and 18 existing native
  regressions pass, with no failures, cancellations or skips. `npm run check`,
  selector syntax, diff checks and journal validation pass.
- Read-only native GraphQL execution succeeds and its selected identity fields
  exactly match the fixture. No new network-dependent CI test is introduced.
- Replay release PR 152 (`470d3ff..6e736ee`) with its actual master-base CI:
  release-only selection, exact release plan, candidate construction and
  verification pass. No-change and non-PR selections retain full CI. This is
  historical replay, not a newly published release or a live fast-path PR run.
