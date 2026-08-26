# Action release publisher

This document is the canonical publication contract for action v2 and later.
The source and publication repositories are fixed:

```text
source:  Joey-Tools/codex-review-gate
target:  JoeyTeng/codex-review-gate-action
```

The target is the existing action and Marketplace repository. It retains the
v1 history and selectors while receiving v2 and later releases. The abandoned
`Joey-Tools/codex-review-gate-action` target is not part of this contract.

This contract describes the intended publisher. It does not claim that a
release intent is present, or that a release, test run, Marketplace update, or
production installation has already completed. The complete accepted design
and its rationale are recorded in
[`docs/project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md`](project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md).

## Delivery sequence

Publisher infrastructure and release intent are deliberately separate changes:

1. Land and validate the publisher workflow, scripts, tests, documentation,
   repository rulesets, Environment, App installation, and signing setup.
2. In a later reviewed PR, add or change `release-manifest.json` for one exact
   SemVer release.
3. After that release-intent PR reaches protected source `master`, run the
   staged publisher and approve only its privileged `publish` job.

The current infrastructure delivery is step 1. It carries no release intent,
must not trigger publication, and does not mean that any tag, GitHub Release,
floating alias, Marketplace version, or consumer installation exists. A
release-intent change must not modify publisher workflow/scripts or their
control tests. This keeps newly introduced privileged code from immediately
receiving production credentials to publish itself.

## Release intent

When present in a later release-intent PR, `release-manifest.json` is the
committed release intent. A release PR changes its `version` and any
policy-bound release metadata. The normal publisher starts after that reviewed
change reaches source `master`. The workflow derives
the immutable full tag, prerelease/stable status, Release version, and—only for
a stable release—the floating major alias such as `v2` from SemVer.

There is no `publish_v2` flag and no manually supplied version. Future v3 and
later releases use the same rules. A recovery `workflow_dispatch` may select
the exact committed source SHA to reconcile, but the version still comes from
the manifest at that SHA. That SHA is a recovery binding, not a public consumer
selector.

The publisher workflow is `.github/workflows/sync-action-subtree.yml`. Its
normal trigger is a push to source `master` that changes
`release-manifest.json`. Its recovery `workflow_dispatch` requires one
`source_sha`: the exact lowercase 40-hex commit that introduced the intended
manifest. A dispatch with no manifest at that source, a short or ambiguous SHA,
or a source outside the admitted protected history is rejected before
publication.

A dispatch always executes the workflow and publisher controls from the live
source `master` commit recorded by `github.sha`; it never checks out an old
commit as executable release control. The selected `source_sha` must be the
linear ancestor commit that changed `release-manifest.json`. That source freezes
the release manifest and complete `packages/action` payload and tree. Recovery
does not require the publisher controls at the old source commit to match the
current controls. Instead, every attempt uses the current protected source
`master` control commit to create a fresh plan, deterministic candidates A and
B, publication plan, and Environment approval that bind that current control
inventory. If source `master` or those controls advance after the attempt's
plan is created, publication fails closed before App-token minting or any
durable mutation and must be rematerialized and approved again. A later release
intent cannot leapfrog an older partial release; the older source may only
reconcile and resume its exact canonical prefix. Mismatched frozen payload or
remote publication state is never blessed as recovery.

The manifest also binds the source path, target repository and branch, and the
expected signing identity. The publisher validates it against release policy
and current remote state before any write. Editing a baseline to bless
unexpected remote drift is not recovery.

## Workflow stages and privilege boundary

The dedicated publisher runs in the source repository and has these logical
stages:

| Stage | Privilege | Contract |
| --- | --- | --- |
| `plan` | Unprivileged | Check the exact source commit, manifest, SemVer, reachability, release policy, and immutable target-parent policy. |
| `candidate-a` | Unprivileged | Independently materialize and test candidate A on a clean runner; record its tree, inventory, modes, sizes, and SHA-256 digests. |
| `candidate-b` | Unprivileged | Independently materialize and test candidate B on another clean runner. |
| `assemble` | Unprivileged | Require byte-identical candidates and produce the canonical candidate bundle. |
| `admission` | Unprivileged | Reconstruct and validate the publication plan and candidate before approval; upload no privileged material. |
| `publish` | Privileged | After Environment approval, revalidate everything and perform signed remote publication. |
| `verify` | Unprivileged | Re-read public refs and Release state and report the observed result. |

The unprivileged `plan`, `candidate-a`, `candidate-b`, `assemble`, `admission`,
and `verify` jobs use `ubuntu-slim` with 14-minute timeouts. The privileged
`publish` job uses `ubuntu-24.04` with a 30-minute timeout.

Only `publish` binds the `marketplace-production` Environment. Despite its
historical name, this is the production publication-credential and approval
boundary; it does not mean that the workflow publishes to or verifies
Marketplace. Its initial policy requires reviewer `JoeyTeng`, keeps **Prevent
self-review** disabled, disables administrator bypass, permits only source
branch `master`, and allows the approval wait to remain pending for up to 30
days. Before approval:

- no publisher App token or signing key is available;
- no job can write the target repository or a GitHub Release; and
- the candidate artifact contains no credential or signing-key material.

Artifacts are transport between jobs, not a ledger or authoritative
publication evidence. The `plan`, `candidate-a`, `candidate-b`, and `admission`
artifacts are retained for one day; the assembled canonical candidate is
retained for 35 days. Artifact display names include the workflow run ID and
attempt. Consumers bind the server-returned artifact ID and a validated exact
basename instead of trusting a display name. The committed manifest plus
re-read Git and Release state remain authoritative.

GitHub does not allocate the protected job's runner while it waits for required
reviewer approval, and that wait does not consume billable runner time. The
platform limit is 30 days, not an infinite wait. If approval is rejected,
cancelled, or expires, no privileged step has run; dispatch the same committed
source SHA to rebuild its frozen payload under the then-current protected
controls, create a fresh plan and candidates A/B, and request fresh approval.
Only drift after that new plan is created invalidates the attempt. The
privileged runner has a 30-minute timeout after approval; the Environment wait
occurs before that runner time is allocated.

## Publisher identities and secrets

The only remote writer is the private GitHub App:

```text
JoeyTeng/codex-review-gate-action-publisher
App ID:          4700530
Client ID:       Iv23liW83xfaR85dKJD3
installation ID: 156186692
```

It is installed only on `JoeyTeng/codex-review-gate-action`. Before any
credential is minted, the privileged job checks out protected source control,
downloads and safely extracts the assembled artifact, and repeats exact
admission validation. Only then does it mint a just-in-time installation token
with the allowlisted official `actions/create-github-app-token@v3` Action. The
request names only the target repository and explicitly narrows the token to
Administration read and Contents write. The trusted source-repository
generator is the private key's only other consumer: it creates an in-memory
RS256 App JWT with `iat = now - 60`, `exp = now + 540`, and `iss` equal to the
configured App client ID, solely for
`GET /app/installations/{installation_id}`. That JWT is never written to a
file, `GITHUB_ENV`, an artifact, an output, a summary, or a log. The separate
installation token reads `GET /installation/repositories`, is bound to the
expected App identity and sole target repository, and is the only credential
exposed to Git. It is never passed between jobs, embedded in a remote URL,
stored in an artifact, or printed. Checkout uses `persist-credentials: false`.
Git receives it only through an owner-private temporary `GIT_ASKPASS` helper
scoped to the exact target repository. Post-step revocation is best effort;
expiry is the remaining bound if the runner is forcibly terminated.

Every `uses:` dependency in the publisher workflow must be an allowlisted
GitHub-official Action referenced by its floating major, such as `@v4`, and
never `@main`. Patch-level upstream drift is consciously accepted so official
fixes arrive automatically. Moving to immutable SHA pins later would make
Dependabot in `Joey-Tools/codex-review-gate` mandatory so important updates are
not missed. A major-alias upgrade remains an ordinary reviewed infrastructure
PR and must not share a release-intent change.

The installed App grants the implicit `Metadata: read` plus `Contents:
read/write` and `Administration: read`. The publisher requests only
Administration read and Contents write for its one-repository installation
token. It does not require Workflows write.

The `marketplace-production` Environment provides:

```text
RELEASE_PUBLISHER_APP_OWNER=JoeyTeng
RELEASE_PUBLISHER_APP_SLUG=codex-review-gate-action-publisher
RELEASE_PUBLISHER_APP_CLIENT_ID=Iv23liW83xfaR85dKJD3
RELEASE_PUBLISHER_APP_PRIVATE_KEY=<environment secret>
```

The private key exists only inside the privileged `publish` job after
credential-free admission succeeds. It is supplied to the official token
Action to mint the installation token and, for the single App-installation
identity read described above, directly to the trusted generator to construct
the short-lived JWT in memory. It is never persisted or exposed through
`GITHUB_ENV`, an artifact, an output, a summary, or a log.

Publication commits, immutable tags, and floating aliases are signed by the
dedicated `JoeyTeng-Codex <codex@mahane.me>` key:

```text
primary fingerprint: AD403DAB5377F9FA0F7D775EC2844D3367B8A71B
signing subkey:       4DD48552DDEAF6D961769DD4A49827EC48984E2C
secret:               RELEASE_SIGNING_GPG_PRIVATE_SUBKEY
```

The secret contains the signing subkey material, not the unrestricted primary
secret key. It has no passphrase, so `RELEASE_SIGNING_GPG_PASSPHRASE` remains
absent instead of being configured as an empty secret. `publish` imports it
into an owner-private temporary `GNUPGHOME`, requires the pinned primary and
signing fingerprints, performs a fixed sign/verify probe, and destroys the
keyring afterward. Public encryption-only subkey metadata is harmless; another
usable secret signing, encryption, or authentication subkey is rejected.

The App is the pusher; the GPG identity is the author, committer, and signer.
Both identities are checked after GitHub accepts a publication commit.

## Target rulesets

Repository rules provide two distinct properties and must not be collapsed into
one bypassable ruleset:

1. `publisher-master-update` restricts updates to `refs/heads/master` and
   gives only the Publisher App an `always` bypass. It answers who may publish.
2. `master-integrity` requires signed commits and linear history, blocks force
   pushes, and restricts deletion, with no bypass actors. It answers what even
   the Publisher App is allowed to publish.

The currently verified rule IDs are `16454474` for
`publisher-master-update` and `21461558` for `master-integrity`. IDs are
informational read-back evidence, not substitutes for verifying each rule's
name, target, enforcement state, rules, and bypass actors.

Tag protection uses two non-overlapping rulesets:

1. `freeze-v1-tags` covers `refs/tags/v1` and `refs/tags/v1.*`, has no bypass
   actor, and freezes existing v1 tags independently of publisher code.
2. `publisher-v2-plus-tags` covers `refs/tags/v*` while excluding both v1
   patterns. It gives only the Publisher App an `always` bypass needed to
   create signed immutable full tags and advance signed major aliases.

Both rulesets restrict creation, update, and deletion as appropriate and block
unauthorized force updates. The publisher also fails closed before its first
target write if an invocation would mutate any v1 tag, v1 GitHub Release, or v1
Release asset. Ruleset IDs are only informational read-back evidence; the
publisher verifies names, targets, enforcement, ref conditions, rules, and
bypass actors.

Repository administrators can still edit rulesets; that configuration-control
authority is outside a repository-hosted workflow. `publish` therefore
re-reads the exact named rules, ref conditions, enforcement state, and bypass
actors after approval and before its first write.

## Candidate and signed release commit

`candidate-a` and `candidate-b` start from the same exact source commit but run
independently. Each materializes, packs, and uploads its candidate before it
runs `npm run check` and the complete Node test suite from its own detached
frozen-source worktree. Source test code therefore cannot mutate the uploaded
candidate, while a failed test still fails the job and prevents assembly. Each
candidate emits a canonical inventory and digests. The
inventory byte-sorts every Git path and records its type, Git mode, logical
size, and SHA-256 content digest. Only the explicit
`src/v2/gate-runtime.mjs` v2 runtime module is admitted; reintroducing a retired
v2 module blocks candidate construction. `assemble` requires both
payloads and all identity records to be byte-identical, then independently
rebuilds and binds each candidate to the frozen manifest/source payload and
this attempt's current-control inventory. Identical tampering of both artifacts
therefore still fails before
the Environment approval boundary. Candidate directories contain exactly
`candidate.json` and the declared regular-file archive; extra entries,
directories, and symlinks are rejected before content is read. Candidate
construction also extracts the final archive under its single canonical prefix
and requires its path/type/mode/size/SHA-256 inventory to equal the frozen Git
tree exactly; committed `export-ignore` or `export-subst` attributes cannot
silently change the published payload.

`publish` treats the assembled candidate only as data. It revalidates the
artifact ID and basename, archive digest, path/type/mode/size ceilings,
complete inventory, and rebuilt Git tree, and never executes candidate content.

The immutable plan deliberately does not record a live observed target-master
snapshot. A manual retry may legitimately observe the parent, the already
published wrapper, or a later verified release, and putting that observation in
the plan would make candidate/provenance bytes change. Instead,
`target_master_before` is bound exclusively to the frozen manifest's
`target.expected_head`; every unprivileged and privileged stage rebinds that
field exactly, and `publish` separately reads and reconciles the live target
before its first mutation.

The candidate payload and Git tree are deterministic. The final release commit
is deliberately outside that deterministic byte boundary because its parent,
timestamp, and signature are established after approval. `publish` constructs
one signed wrapper commit:

```text
tree:       the verified candidate tree
parent:     the frozen manifest target.expected_head
author:     JoeyTeng-Codex <codex@mahane.me>
committer:  JoeyTeng-Codex <codex@mahane.me>
signature:  4DD48552DDEAF6D961769DD4A49827EC48984E2C
```

The message records the release version, source repository, full source commit,
and release-manifest digest. The raw subtree-split commit is evidence used to
prove tree equality; it is not pushed as target `master`.

The wrapper has exactly one parent. The publisher advances `master` with an
ordinary non-force fast-forward push from the exact re-read parent. If target
`master` moved, the run stops and reconciles; it never rewrites history or
reuses an equivalent-tree force-push path. A retry that finds the intended
signed commit already published verifies and reuses it instead of creating a
second commit with a new timestamp or signature.

## Publication order

After approval, one fail-closed publication-input preflight runs before any
target ref or Release mutation. It reconstructs the expected plan from the
frozen manifest and source tree and exactly rebinds version/prerelease/tag
policy, `target_master_before`, `previous_version`, complete signer identity,
repositories/refs, source tree, payload inventory, immutable control inventory,
and candidate archive bytes. The control inventory is the one frozen by this
attempt's plan, not the old source commit's controls. The preflight also
re-reads live source `master` to determine
whether target writes remain eligible. `publish` then repeats the target-head,
ruleset, existing-tag, and existing-Release checks and follows this order:

1. Construct and locally verify the signed, single-parent wrapper commit.
2. Fast-forward target `master` without force, then re-read its exact commit,
   parent, tree, App pusher, and GitHub signature result.
3. Create the signed annotated immutable full tag `v<version>` without force.
   It points directly to the wrapper commit and is never moved or deleted.
   Re-read the exact tag object, peeled commit, commit tree, and GitHub signature
   result. Publisher identity is bound before the first write from the minted
   token's actual App slug and installation ID, target scope, and effective
   rulesets.
4. Create or resume a draft GitHub Release for the full tag. Upload release
   assets, canonical provenance, checksums, and the detached provenance
   signature.
5. Re-read the draft tag binding and every asset byte/digest, then publish the
   Release under the repository's immutable-release policy and verify the
   immutable published Release.
6. For a stable version only, create a signed annotated floating major tag such
   as `v2` and update it with an exact lease on the previously observed tag
   object. The alias may move only forward through version history.
7. Re-read the alias. A prerelease stops before this step and never changes
   `v2`.

There is no `v2.0` alias in this contract. A floating alias does not receive a
separate GitHub Release; Releases belong only to immutable full-version tags.
Consumers use `JoeyTeng/codex-review-gate-action@v2` after the stable release
is admitted, so later v2 patches do not require edits in every consumer repo.

Provenance binds at least the release intent, exact source commit and subtree,
candidate tree and complete payload inventory, wrapper commit and parent,
signing identity, immutable tag object, assets, and observed target state. It
does not contain a self-referential digest. The floating-alias result is mutable
post-publication state rather than data forged into already immutable
provenance.

## Verification and admission

`verify` has no Environment and no publisher or signing secrets.
It performs a fresh public read of target `master`, the immutable tag and
peeled commit, signatures, Release immutability and assets, and—after a stable
release—the floating alias. It writes an Actions summary with observed state
and an exact recovery action for every incomplete step.

Every full SemVer, including every prerelease, minor, and patch version,
receives its immutable full tag and immutable GitHub Release. Marketplace is a
separate, manual, out-of-band operator task only for the first stable release
of each major: `v2.0.0`, later `v3.0.0`, and so on. On that Release page, a
human uses the Action Marketplace Release UI to publish the major's initial
listing version. Minor and patch releases require no Marketplace operation.

The publisher never waits for, reads back, or gates success on Marketplace.
Marketplace does not create or resolve the floating `v2` Git ref. The accepted
tradeoff is that the listing may continue to display `v2.0.0` for the lifetime
of v2 while the signed `v2` alias advances to newer immutable releases.

Before consumer rollout, the full tag must be usable, stable `v2` must peel to
the same admitted commit, and the immutable Release and provenance must match.
For the first stable release of a major, the separate Marketplace UI task may
be completed after publisher success; its completion is not machine read-back
evidence and is not a publisher admission condition. Dedicated
immutable-tag and floating-alias canary jobs are deferred and are not v2.0
publication or rollout gates. Prereleases may be published and tested by
immutable full tag, but they are not production selectors and do not move
`v2`.

## Reconcile, retry, and cancellation

Publication is a sequence of remote operations, not one cross-service
transaction. Every privileged retry begins with a full reconcile of:

- the manifest and exact source commit;
- current target `master` and its ancestry;
- the intended wrapper commit and full tag object;
- draft or published Release state and every asset digest;
- the floating alias for stable releases; and
- effective branch and tag rulesets.

Reconcile returns exactly one remote-state class: `fresh`,
`resumable_partial`, `already_complete`, `superseded`, `blocked_conflict`, or
`inconclusive`. It may reuse only an exact signer/parent/tree/digest-matching
prefix of the canonical publication sequence. Every durable write is re-read.
An older partial release blocks a newer release from leapfrogging it.

The fully paginated Release-inventory stability fingerprint is a closed,
decision-relevant projection. It binds Release and asset object identities,
tag and lifecycle policy, immutable metadata, asset digests and byte metadata,
and author/uploader identities. It deliberately excludes observational or
decorative API fields such as `assets[].download_count` and profile URLs.
Downloading an asset during reconcile can change a download counter without
changing any protected publication property; treating that counter as state
mutation would make the verifier invalidate its own otherwise stable snapshot.

An exact completed step is verified and reused; an absent next step may resume.
A conflicting tag, commit, signature, Release asset, unexpected target advance,
or unknown state fails closed with a specific recovery summary. The publisher
never deletes or rewrites an immutable full tag or Release, force-pushes
`master`, or moves a major alias backward. Recovery after an immutable
conflict is a reviewed forward release, normally a new patch version.

Each attempt's immutable plan binds the frozen release intent and the current
protected control commit and complete control-file digests used for that
attempt. If an artifact expires or becomes unavailable, dispatch the exact
source SHA again, independently rematerialize both candidates under the
then-current protected controls, construct a fresh plan and publication plan,
and obtain Environment approval again. The new run must still classify and
reconcile every remote object before writing. It may resume only an exact valid
prefix; otherwise it stops with `blocked_conflict` or `inconclusive`. If a
durable immutable conflict cannot be reconciled, preserve it for diagnosis and
publish a reviewed higher version that repairs forward. Historically restoring
earlier code is allowed only through that higher version; the floating alias
never moves backward through version history.

The workflow-level concurrency contract is:

```yaml
concurrency:
  group: codex-review-gate-action-release
  cancel-in-progress: false
```

The `false` value is intentional and must be covered by static workflow tests.
A newer run must not automatically terminate an active release between
advancing `master`, creating the immutable tag, publishing the Release, and
updating the alias. Cancellation does not roll back those remote writes, and
App-token revocation on a forcibly terminated runner is only best effort. A
pending run may be superseded by a later pending run; an active run remains
uninterrupted. The owner may still cancel it deliberately after inspecting
remote state, but the next run must perform full reconcile before continuing.

## Initial v2 scope and deferred work

Initial v2 publication deliberately keeps v1-like operational simplicity: one
source-hosted publisher, two deterministic candidate builds, one protected
publication stage, and one unprivileged public-verification stage. It does not
introduce the old pre-activation controller, three Environment wait jobs, a
scheduled consumer scan, dedicated immutable-tag or floating-alias canary jobs,
or a separate canary orchestrator as release prerequisites.

Stable `v2.0.0` admission additionally requires a published `v2.0.0-rc.N` and
one complete live gate loop on a temporary PR in a real consumer repository.
The RC uses only its immutable full tag; it does not move `v2`. The ordinary
post-installation `@v2` consumer canary remains separate from the publisher and
is closed unmerged after success.

The following are explicitly deferred and must not be represented as completed
or silently promoted into the current contract:

- dedicated immutable-tag and floating-alias canary jobs, including richer
  multi-repository or multi-phase canary orchestration;
- Marketplace publication automation and machine-verifiable admission;
- detailed rollback and forward-recovery automation for every partial GitHub
  Release failure mode; and
- optional temporary numeric overrides for release or runtime soft limits.

For an unimplemented edge, stop, preserve observed state, and use reviewed
forward recovery. Do not weaken a ruleset or mutate immutable history.

## Historical v1 evidence

The following is retained as historical evidence, not as the live v2 publisher
contract:

- v1 was published in `JoeyTeng/codex-review-gate-action`, so v2 keeps the
  existing Marketplace listing instead of publishing from a second repo;
- the recorded pre-v2 target `master` was
  `59eeda2af2a7baab3f3f15a59fbbaee015fa6c01`, with tree
  `8d909dd441b28b6915c46f60e8a144e64fd5268b`;
- the recorded `v1.5.1` annotated tag object was
  `f9201d016b0abd21403550c3bf8030eb0beb76b4`, and v1.1.0 through v1.5.1
  release refs and assets remain historical target state; and
- the recorded v1 `master` was an unsigned raw subtree-split commit, while the
  verified `v1.5.1` annotated release tag had a valid GPG signature; v1 also
  used manual release evidence and an SSH deploy-key publication path.

Those facts explain migration checks but grant no current authority. v1 refs
remain frozen; v2 uses the Publisher App, signed wrapper commits, committed
SemVer intent, immutable full-version Releases, and the floating `v2` selector.
