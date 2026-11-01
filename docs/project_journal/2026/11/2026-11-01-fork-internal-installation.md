---
id: 20261101-fork-internal-installation
title: Fork-Owned Internal Pull Request Support
status: completed
created: 2026-11-01
updated: 2026-11-01
branch: wip/fork-internal-review
pr:
supersedes: []
superseded_by:
---

# Fork-Owned Internal Pull Request Support

## Decisions and Reasons

- Joey explicitly requested support for an operator-maintained fork with PRs
  entirely inside that fork. This does not authorise external fork PR support.
- Remove only the repository-level `fork: true` installation rejection. Being
  a fork does not change which repository owns the protected workflows or the
  head/base commits. Keep boolean fork metadata validation and all exact
  repository ID/full-name joins; do not use upstream parent/source identities
  as alternate targets or inherit upstream configuration.
- Keep default-branch/native-stack eligibility, exact current head/base/test-
  merge binding, provider evidence, controller launch and POST/rerun safeguards.
  An external head or base still fails closed before request or rerun writes.
- No workflow event, permission, secret input, trust flag, App or ruleset change
  is needed. Existing canonical consumers obtain the runtime change through
  the separately published floating `@v2` release. Operators configure Actions,
  Codex review and any existing request-secret/variable settings in their fork.
- This narrowly updates the installation part of earlier broad fork exclusions,
  including the historical v2 grilling and stacked-support journals. Their
  past delivery records are unchanged; cross-repository PR exclusions remain.

## Current State

- The source change, offline verifier/controller regressions and current
  English/Chinese support/installation documentation cover fork-owned internal
  PRs without expanding the external-PR trust boundary.
- The packaged English/Chinese README and DESIGN support boundaries also
  distinguish a fork-owned installation from an external fork PR; historical
  release/grilling journals remain unmodified evidence of their older scope.
- A separate release intent and human-approved publisher remain required;
  this source implementation does not itself bump a version or publish tags.
- Mocked API tests demonstrate runtime behaviour, not a live fork deployment
  or provider entitlement. No new consumer installation or live canary is
  claimed by this source change.

## Validation

- Node.js 24.15.0: the unchanged 15-file core CI selection passes 1315/1315
  tests with zero failures, cancellations or skips. The five new fork callbacks
  also pass separately, covering ordinary/native-stack verifiers, manual and
  provider reconciliation, manual/automatic requests, diagnostic completion,
  foreign head/base ID/name rejection and invalid boolean fork metadata.
- The initial red run fails at the existing installation rejection, as expected.
  The first post-change run exposed two test-fixture mistakes: the provider
  trigger lacked its existing empty expected-head contract, and a foreign base
  full name is rejected earlier as inconsistent API metadata. Both fixtures
  now assert the unchanged exact ingress/metadata boundaries, not weaker runtime
  acceptance. Failed and successful bounded logs remain host-local.
- Syntax, project-journal and whitespace checks pass. No shell script or inline
  workflow shell changed. Local mocked API results do not replace current-head
  remote Codex review, complete Node.js 20/24 CI or a live fork canary.

## Next Steps

- Publish the reviewed implementation through the separate patch release
  intent and independently verify the immutable release and signed `@v2`.
