---
id: 20260813-7bf930a-action-v2-release-pipeline
title: Action v2 Release Pipeline
status: superseded
created: 2026-08-13
updated: 2026-08-25
branch: codex/v2-release-pipeline
pr:
supersedes: [20260518-9a806cf-release-automation]
superseded_by: 20260825-019ff4f8-action-v2-grilling-plan
---

# Action v2 Release Pipeline

> Superseded on 2026-08-26 by
> `20260825-019ff4f8-action-v2-grilling-plan`. This entry preserves historical
> pre-confirmation implementation context only; its runtime, publisher,
> Marketplace, dependency, and recovery details are not design authority.

## Summary

- On 2026-08-24 Joey adopted a replacement v2 runtime, installation and
  publisher contract after revisiting the earlier pre-activation design.
- Canonical source remains `Joey-Tools/codex-review-gate`; releases continue in
  the existing Marketplace repository `JoeyTeng/codex-review-gate-action` so
  current v1 consumers and the Marketplace listing are not split across two
  action identities.
- This pre-confirmation workstream is superseded. No v2 release, Marketplace
  update, target write, consumer installation, or production canary was
  recorded before supersession.

## Adopted Runtime Contract

- Consumers copy one canonical local workflow and invoke
  `JoeyTeng/codex-review-gate-action@v2` inside it. A bare Action step is not a
  complete installation because runner-free filters, permissions, dispatch and
  status identity live in the workflow envelope.
- The canonical events are `issue_comment.created` and single-PR
  `repository_dispatch` with exact type `codex-review-gate`. The closed client
  payload requires one positive JSON-integer PR number and accepts only optional
  operation/request-review fields. GitHub loads this manual route from the
  default branch; callers cannot select a feature workflow ref. There is no cron
  and no writable `pull_request_review` automatic job. This avoids
  private-repository no-op minutes and keeps the mutation/event surface small.
- For `issue_comment`, workflow admission and the Action both require exact
  provider sender/author `chatgpt-codex-connector[bot]`, GitHub type `Bot`;
  manual dispatch uses its separately validated closed payload.
- Runtime is API-only, never executes PR code, and prefers `ubuntu-slim` for
  lightweight jobs where GitHub offers that runner.
- Normal operation posts the exact canonical hidden-marker body—`@codex review`
  plus version 2 JSON containing the full current head—directly to start the
  provider without consuming a runner, then dispatches `reconcile`. A bare
  `@codex review` may start the provider but cannot supply a passing
  reaction-only basis because it is not bound to the exact head.
- `begin-review` always writes pending. Its default `request_review=true` form
  creates one fresh canonical request for the current head even when an older
  same-head request exists. Its advanced `false` form creates no request; the
  agent must wait for pending and then post a fresh canonical marker before
  reconcile. An older request or `+1` cannot complete the new review epoch.
- Both operations target one PR. Every reconciliation fully rebuilds authority
  from GitHub; there is no durable ledger, runtime GitHub App or central router.
  The sticky uses exact marker line `<!-- codex-review-gate:v2:diagnostic -->`
  followed by hidden canonical JSON; visible text and JSON carry reason,
  recovery code, next action and all three counts. It is best effort and never
  authoritative.
- Terminal-clean text and qualifying `+1` are equivalent. Provider short SHAs
  are accepted only when they resolve unambiguously to the relevant current
  head. The unique latest canonical request revision defines the current review
  epoch: greatest `updated_at` wins; same-second unedited requests use greatest
  numeric server comment ID; a tied edited request makes the epoch ambiguous
  pending. Reaction clean comes only from the latest request, and every clean
  signal must be strictly later than its revision. Same-or-later `eyes` vetoes
  selected clean, and same-or-later progress vetoes terminal clean. Findings do
  not use the epoch cutoff: any qualifying same-head finding remains blocking.
- Commit statuses persist by SHA and have no PR identity. A same-head re-review,
  SHA rewind/reuse, or same-head base retarget must first use `begin-review` to
  replace an old success with pending and establish a fresh request epoch.
  Duplicate open PRs sharing one head SHA overwrite the same context and are
  unsupported. This is the accepted boundary of omitting a writable
  `pull_request` reset job.
- Reconciliation uses REST only. It does not query GraphQL or inline review
  comments, and inline threads, conversation resolution and conversation
  content do not enter the reducer, counts or fingerprint. The ruleset's
  must-resolve-all-conversations requirement is their sole authority.
- Only a clean candidate enters the A/B stability gate: two complete,
  independent, fully paginated snapshots five seconds apart with an unchanged
  head and non-inline evidence fingerprint. A complete failure or ordinary
  pending result terminates immediately; transient intra-snapshot drift is
  discarded and retried. The shared default 60-second stability cap ends in
  healthy pending, never success.
- The public report separates `execution-health` from `gate-outcome`, carries a
  closed `recovery-code`, and reports unresolved, resolved and total finding
  counts in outputs, the sticky diagnostic and the Actions summary. Initial v2
  fixes `resolved` at zero and reports `unresolved == total` as the complete
  finding count carried by current-head non-inline payloads.
- Large repositories may select a persistent expanded soft-limit profile.
  Temporary per-dispatch numeric overrides are deliberately deferred. GitHub's
  PR-commit endpoint is capped at 250 commits, so `pr.commits > 250` uses a
  fully paginated exact `base_sha...head_sha` Compare inventory. The runtime
  validates totals, exact base/final head, stable merge metadata, unique commit
  SHAs and pagination Links. `V2_MAX_PAGES` applies independently to each
  paginated collection, while `V2_MAX_OBJECTS` accumulates across the complete
  snapshot; exhaustion returns healthy pending with
  `raise-soft-limits-and-reconcile` before the stability wait. This revision
  supports exceptional large PRs through reviewed persistent limit increases
  without permitting a truncated inventory or false pass.
- The runtime hardening revision binds PR metadata to both `base.repo.id` and
  `base.repo.full_name`, accepts only canonical positive-decimal PR input, and
  treats pagination as evidence: every generic collection uses `per_page=100`,
  probes a full page with no next Link, and rejects malformed Links. Compare
  accepts GitHub's exact numeric-repository canonical path only for the bound
  base repository. This guards against input/concurrency aliases and a
  false-pass from partial or redirected inventory.
- The 60-second stability budget is one monotonic deadline across snapshot API
  reads and sleeps, ending before status/report closeout. If required report or
  output persistence fails after a soft-limit pending result, final health is
  unhealthy and the runtime best-effort writes an `error` status only after
  refetching the authoritative current open PR head. These drift protections
  prevent a closeout timeout and avoid misleading recovery status on an old
  head.
- The supplied ruleset template requires `codex/github-review-gate`, branch up
  to date and all conversations resolved. Human-readable and agent-executable
  installation guides are separate views of the same installation.
- Default-branch `repository_dispatch` proves the status-writing consumer code
  provenance but does not make a plain commit-status context repository-wide
  exclusive. Another same-repository workflow can write under the GitHub
  Actions identity. The supported boundary treats same-repository writers as
  trusted and uses fork PRs for untrusted contributors; v2 does not introduce a
  dedicated runtime App solely to narrow that producer identity.

## Adopted Release Contract

- A committed deterministic `release-manifest.json` expresses release intent.
  SemVer determines prerelease/stable behaviour and the floating major; there
  is no `publish_v2` switch or dispatch version override.
- A source `master` manifest change starts the release workflow. The workflow
  separates the frozen release-intent/source SHA from the current reviewed
  publisher-control SHA. Manual recovery binds the exact source SHA and reads
  its manifest/tree/control inventory, while execution must use current
  default-branch controls and prove no release input or publisher-control drift.
  A docs-only master advance is retryable and must reproduce byte-identical
  plan, candidate and provenance bytes.
- Unprivileged stages are `plan`, independent `build_a` and `build_b`, then
  `assemble_candidate`. Each build seals its candidate before independently
  running `npm run check` and the complete Node test suite in a detached
  frozen-source worktree. This prevents data-plane test code from mutating the
  uploaded candidate while a failed test still blocks assembly. Both builds
  must produce byte-identical payload/tree evidence. Candidate creation also
  extracts the actual archive and compares its path/type/mode/digest inventory
  with the frozen Git-tree inventory rather than trusting the requested archive
  command. Candidate artifacts are short-lived transport only, contain no
  secret and are not a ledger or authority.
- Only `publish` binds the source repository's `marketplace-production`
  Environment. Approval is requested after every unprivileged check passes.
  Waiting consumes no runner minutes, has GitHub's 30-day maximum, exposes no
  Environment secret and performs no target write.
- The privileged job imports the pinned GPG signing subkey into a temporary
  keyring and mints a repository-scoped installation token just in time from
  `JoeyTeng/codex-review-gate-action-publisher`. Neither credential crosses a
  job or enters an artifact. Every third-party Action used by the privileged
  release workflow is pinned to a reviewed immutable commit SHA; floating tags
  are not accepted in this secret-bearing control plane.
- Publication creates one signed, single-parent wrapper commit over the
  byte-verified action tree and ordinarily fast-forwards target `master`. The
  raw subtree split remains evidence rather than the published commit.
- A signed annotated immutable full-version tag is pushed and exactly reread
  before a draft Release is assembled. Assets include provenance and detached
  signatures. Refs, signatures, asset digests and Release metadata are reread
  before immutable publication.
- A stable release then advances the signed annotated floating major alias
  (initially `v2`) with an exact lease and performs an alias reread. Prereleases
  never move the floating alias, and floating aliases do not receive Releases.
- Workflow concurrency is repository-wide with `cancel-in-progress: false`.
  A newer pending run may replace an older pending run, but automation cannot
  interrupt an active non-transactional sequence after some remote writes have
  occurred.
- Publication preflight blocks a stale or superseded frozen source before its
  first target write, and strict nearest-intent planning remains authoritative.
  The narrow recovery exception begins only after the exact immutable tag and
  release commit already exist and their signatures/content verify, proving an
  earlier approved run crossed the irreversible boundary. After a later release
  intent exists, completion may use only a rerun of that original workflow run
  while its exact candidate artifact remains available; a new manual dispatch
  may not reconstruct the older candidate across the intent boundary. That
  rerun may complete only missing GitHub Release/assets for the exact version;
  it may not rewrite master/tag or move a floating alias backwards. Once the
  original run/artifact window is gone, recovery is an incident/manual action
  or a higher-version forward repair, not a claim of full automatic recovery.
  Already complete or later-superseded releases reconcile as read-only no-ops.
- Target rules use the exact names `publisher-master-update`,
  `master-integrity`, and `publisher-version-tags`. The tag ruleset includes
  `refs/tags/v*` with no exclusions and gives only Publisher App ID `4700530`
  an `always` bypass. Although that App can technically bypass protection on a
  v1 tag, the publisher must fail closed before its first target write for any
  attempted creation, update, or deletion of a v1 tag or v1 GitHub Release,
  including Release assets. No separate v1-freeze ruleset is part of the
  adopted design. The currently verified informational rule IDs are
  `16454474`, `21461558`, and `21461569`, respectively.
- Recovery always begins with machine reconciliation of target master, tags,
  Releases and assets. Current public verification does not call a Marketplace
  API; Marketplace visibility remains a separate human read-back and must not
  be reported as machine-verified. The normal repair direction is a later
  patch release; the floating alias does not move backwards.
- The retired standalone `github-codex-evidence-authority-v2.json` is removed
  from the publishable Action subtree, and release-contract tests require it to
  remain absent. Runtime code plus the reviewed design/docs are the supported
  v2 evidence contract; the obsolete JSON cannot silently drift into a release.

## Historical v1 Boundary

- Verified v1.5.1 provenance, signed tags, immutable Release evidence and the
  existing Marketplace listing remain historical evidence. Earlier journal
  entries and v1 release documents should remain inspectable.
- The old organisation target, PAT/SSH publication interface,
  `publish_v2=true`, three floating v2 tags and pre-activation wait/ledger
  topology are superseded designs, not live v2 requirements.
- Existing `@v1` consumers remain valid until each repository deliberately
  installs v2. v2 publication does not rewrite or republish the v1 series.

## Current State

- Read-only live verification on 2026-08-25 established publisher App
  `JoeyTeng/codex-review-gate-action-publisher`, App ID `4700530`, Client ID
  `Iv23liW83xfaR85dKJD3`, installation ID `156186692`, installed only for the
  target repository. Its live permissions are Administration read, Metadata
  read, and Contents/Workflows read-write.
- Joey reported that `RELEASE_SIGNING_GPG_PRIVATE_SUBKEY` contains the dedicated
  signing subkey `4DD48552DDEAF6D961769DD4A49827EC48984E2C`; the public key is registered to
  `JoeyTeng-Codex <codex@mahane.me>`. The key has no passphrase, so the
  passphrase secret remains absent.
- These reported external settings still require workflow preflight and live
  GitHub verification. This journal does not claim that the current source
  implementation, tests, rulesets, release workflow or canaries have passed.

## Deferred Work

- Decide whether a later release needs temporary numeric dispatch limit inputs;
  v2.0 uses persistent repository overrides only.
- Dedicated immutable-tag and floating-alias canary jobs are deferred and
  non-blocking for v2.0. Add canary orchestration only if the initial v1-like
  staged publication proves insufficient; the first publisher deliberately
  avoids a canary controller or durable release ledger.
- Finalise how Marketplace publication/visibility is automatically verified,
  including stable `v2.0.0` admission after any prerelease.
- Revisit cross-window selective completion after live failure evidence exists.
  V2.0 permits only the verified signed-immutable-tag completion path through
  the original still-replayable run/artifact window; outside it, use incident
  handling or a higher-version forward repair. Alias rollback is not the
  default recovery direction.
- Extend the runtime support boundary (merge queues, forks, GHES, non-default
  bases, drafts, bot PRs and self-hosted runners) only in separately reviewed
  releases.

## Next Steps

- Complete implementation, documentation and tests for the adopted contract.
- Configure and independently read back `publisher-master-update`,
  `master-integrity`, and `publisher-version-tags` before the first privileged
  write.
- Run release preflight without target mutation, then use an approved
  prerelease if needed. `v2.0.0` stable remains the required usable release.
- After publication, independently reconcile source SHA, target commit/tree,
  signatures, immutable tag/Release/assets and floating alias, then perform a
  separate human read-back of Marketplace visibility.
- Install v2 in selected Joey-owned repositories through one migration PR per
  repository, validate with a separate harmless PR, and close that canary
  unmerged.

## Evidence

- Runtime docs: `packages/action/README.md`, `packages/action/DESIGN.md`,
  `packages/action/COOKBOOK.md` and their Chinese counterparts
- Publisher runbook: `docs/RELEASING.md`, `docs/RELEASING.zh-CN.md`
- Release intent: `release-manifest.json`
- Publisher workflow: `.github/workflows/sync-action-subtree.yml`
- Provenance generator: `scripts/generate-action-release-provenance.mjs`
- Historical v1 release evidence: prior release journal entries and immutable
  assets in `JoeyTeng/codex-review-gate-action`
