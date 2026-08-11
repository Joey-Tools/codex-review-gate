# Releasing the Action Package

Languages: [British English (en-GB)](RELEASING.md) | [简体中文 (zh-CN)](RELEASING.zh-CN.md)

The Marketplace repository is a subtree split of `packages/action`. Everything
needed at the root of `JoeyTeng/codex-review-gate-action`, including the
reusable workflow, must live inside that directory.

## Compatible v1.x Rollout Boundary

This procedure prepares the compatible v1.5.2 targeted-schedule release.
The immutable v1.5.1 release is the first admitted reusable-workflow baseline,
and the source-root caller and repository template already select `@v1`.
Completing source changes does not mean that v1.5.2 has been released.

The release PR changes the packaged reusable workflow in `packages/action`
without changing producer protocol major 1, receipt schema v1, or decision
policy 1.4. The packaged workflow recognises the closed
`workflow_dispatch` marker `codex_review_gate_trigger=scheduled-target-v1` as
schedule-equivalent for auto-retry gating and forwards
`CODEX_REVIEW_GATE_AUTO_RETRY` to the composite Action. The marker remains
caller event-payload protocol, not a new Action input.

Publish and verify the immutable v1.5.2 release and provenance before moving
the signed `v1.5` and `v1` aliases together. Because active callers already
select `@v1`, the alias transaction is the live activation boundary. Immediately
afterwards, run an ordinary live `@v1` canary from the existing source-root
caller. The source-root workflow does not expose the targeted dispatch marker;
a downstream consumer branch must add that marker and pass its own targeted-
dispatch canary before enabling per-PR scheduling.

## Preconditions

- The source release commit is merged to the exact `master` tip.
- Root `package.json` and `packages/action/package.json` both declare `1.5.2`.
- `packages/action/decision-table.json` declares `schema_version: 1`,
  `policy_major: 1`, and `policy_version: 1.4.0`; its reviewed frozen raw
  SHA-256 is
  `6c04ccf20e5033639c2ba88931ea10ba7b6577189f91f6eaeea9b2792892b8a7`.
- Producer protocol major 1 and producer receipt schema v1 remain compatible.
- Receipt structural selection preserves native-action precedence: either
  native action repository/ref field selects direct identity and ignores the
  reusable checkout-commit environment; reusable W/C binding is possible only
  when both native fields are absent and the called job tuple is exact canonical.
- `packages/action/.github/workflows/codex-review-gate.yml` exists. Its runtime
  closure contains only full-SHA-pinned
  `actions/checkout@11d5960a326750d5838078e36cf38b85af677262` and
  `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`,
  plus the local `./.codex-review-gate-action` use.
- The reusable job literally uses `runs-on: ubuntu-slim` and does not read
  `vars.CODEX_REVIEW_GATE_RUNNER_LABELS` or any caller-controlled runner
  selector. The GitHub-hosted runner is a runtime trust root for checkout
  output, worktree, and receipt production. Direct composite callers retain
  their existing caller-owned runner configuration.
- The called workflow checkout uses exact
  `repository: ${{ job.workflow_repository }}`,
  `ref: ${{ job.workflow_sha }}`, path `.codex-review-gate-action`, and
  `persist-credentials: false`. The step ID is `checkout`, and its official
  `commit` output is bound to the local composite only as
  `CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA: ${{ steps.checkout.outputs.commit }}`,
  never a workflow-call/caller input. It contains no bare or PR checkout.
- The reusable workflow treats only caller `workflow_dispatch` payloads with
  exact `codex_review_gate_trigger: scheduled-target-v1` as targeted scheduled
  scans. It forwards `vars.CODEX_REVIEW_GATE_AUTO_RETRY` through the fixed
  `CODEX_REVIEW_GATE_AUTO_RETRY` environment binding, so `false` disables both
  broad schedules and targeted scheduled dispatches. Neither value is exposed
  as a caller-controlled Action input.
- The other reviewed frozen raw SHA-256 values match the generator constants:
  `action.yml` is
  `3b73835ec0e8dfb2305f0801ebaa7b3f9ea04e02c72392e822aabcd25d2093be`,
  the reusable workflow is
  `c4b5c4eb61c8ae586357b44fffc951e751e7478685b56d299cb45ad391c659fb`,
  and `producer-receipt.schema.json` is
  `89decfcabeeab817a975b1118498375c4eafe730b35e2cb9aa5c4abde6637b77`.
- Source checks, package checks, tests, and the release split validation pass.
- The action repository default branch can receive the verified subtree split.
- The release operator has the trusted OpenPGP key available and has obtained
  its expected primary-key fingerprint from the independently controlled
  signer policy. Do not derive trust from a fingerprint first seen in the
  candidate manifest.
- The release operator's GitHub credential can read repository Administration
  state for the immutable-release preflight.

The action repository must have immutable releases enabled before any release
ref is published. With GitHub REST API version `2026-03-10`, require HTTP 200
and exact top-level `enabled: true` from
`GET /repos/JoeyTeng/codex-review-gate-action/immutable-releases`; 404 or any
other value fails closed. `enforced_by_owner` may be recorded but does not
change admission. See GitHub's
[repository endpoint](https://docs.github.com/en/rest/repos/repos?apiVersion=2026-03-10#check-if-immutable-releases-are-enabled-for-a-repository)
and [immutable-release guidance](https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/supply-chain-security/immutable-releases).

```bash
set -euo pipefail

test "$(
  gh api \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2026-03-10' \
    repos/JoeyTeng/codex-review-gate-action/immutable-releases \
    --jq '.enabled'
)" = true
```

The provenance generator records signature verification and fingerprints, but
it does not decide which primary signer is trusted and it does not perform a
revocation-freshness service check. Those are consumer/operator policy inputs.

## Synchronise and Prove the Subtree

The canonical path is the automatic sync workflow. After the source release
commit merges, select the exact `sync-action-subtree.yml` push run whose
`headSha` equals that source commit, watch it to terminal `success`, and retain
the run ID/URL/head SHA as release evidence. The workflow pushes only the
computed `packages/action` split to
`JoeyTeng/codex-review-gate-action:master`; it does not create releases or move
tags. It normally fast-forwards and uses its guarded equivalent-parent lease
path only for the documented squash-merge case.

Independently, in a fresh full-history checkout of the exact source commit,
run the split validation and record the computed split commit:

```bash
set -euo pipefail

npm run release:split
```

Then use a fresh full checkout of the action repository to require
`master` to equal that recorded computed split commit and prove tree equality.
Do not perform a second manual push after the automatic sync succeeds.

Manual publication is an explicit fallback only when the automatic workflow
cannot be used. It requires a separately verified `action` remote and the same
fresh/full source checkout and split proof:

```bash
set -euo pipefail

git remote get-url action
scripts/release-action-subtree.sh --remote action --branch master --push
```

After sync, require all of the following:

- source `master` is the intended source release commit;
- the selected sync run has that exact `headSha` and terminal `success`;
- action `master` is the intended split commit;
- the source commit's `packages/action` tree OID exactly equals the action
  commit's root tree OID; and
- neither default ref changes during tag/provenance preparation.

## Create and Verify Local Release Tags

Create three direct signed annotated tags in the action repository, all peeling
to the same verified action commit:

1. immutable release tag `v1.5.2`;
2. minor compatibility alias `v1.5`; and
3. major compatibility alias `v1`.

Never move `v1.5.0`, `v1.5.1`, or `v1.5.2`. The v1.5.2 release advances the
two compatibility aliases only; leave every immutable and older release tag
untouched. A generic `git push -f --tags` is prohibited.

The generator resolves an absolute GnuPG executable, clears inherited `GIT_*`
and global/system Git configuration, and accepts each tag only when
`git verify-tag --raw` yields exactly one identity-consistent `GOODSIG` and
`VALIDSIG` with no rejecting status. It records both
`signing_key_fingerprint` and `primary_key_fingerprint` for each tag.

Before publication, require every tag's recorded
`primary_key_fingerprint` to equal the independently predeclared trusted
primary fingerprint. A signing subkey fingerprint may differ; that is why the
primary fingerprint is the trust anchor.

At the start of this release session, before replacing either local alias,
freshly probe the remote and require strictly empty output for
`refs/tags/v1.5.2`; require that local ref to be absent as well. If it exists,
stop and audit it—never overwrite an immutable release ref. Read both existing
remote `v1.5` and `v1` tag-object OIDs once and persist them as release
evidence. Those previously observed values—not fresh values first seen
immediately before the alias push—are the exact lease expectations used later.

Use the same resolved GnuPG executable and unchanged keyring for all three
local tags:

```bash
set -euo pipefail

action_repo_path="../codex-review-gate-action"
release_evidence_path="v1.5.2-expected-remote-alias-tag-objects.tsv"
test ! -e "$release_evidence_path"
remote_immutable_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1.5.2
)"
test -z "$remote_immutable_record"
if git -C "$action_repo_path" \
  show-ref --verify --quiet refs/tags/v1.5.2; then
  exit 1
else
  test "$?" -eq 1
fi
remote_v1_5_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1.5
)"
expected_remote_v1_5_tag_object_oid="${remote_v1_5_record%%$'\t'*}"
test "$remote_v1_5_record" = \
  "$expected_remote_v1_5_tag_object_oid"$'\trefs/tags/v1.5'
test "${#expected_remote_v1_5_tag_object_oid}" -eq 40
[[ "$expected_remote_v1_5_tag_object_oid" != *[!0-9a-f]* ]]
remote_v1_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1
)"
expected_remote_v1_tag_object_oid="${remote_v1_record%%$'\t'*}"
test "$remote_v1_record" = \
  "$expected_remote_v1_tag_object_oid"$'\trefs/tags/v1'
test "${#expected_remote_v1_tag_object_oid}" -eq 40
[[ "$expected_remote_v1_tag_object_oid" != *[!0-9a-f]* ]]
printf '%s\t%s\n' \
  "$expected_remote_v1_5_tag_object_oid" \
  "$expected_remote_v1_tag_object_oid" > "$release_evidence_path"

action_release_commit="$(
  git -C "$action_repo_path" rev-parse 'refs/heads/master^{commit}'
)"
release_gpg_path="$(realpath "$(command -v gpg)")"
test -x "$release_gpg_path"

git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -s -a v1.5.2 "$action_release_commit" \
  -m "codex-review-gate-action v1.5.2"
git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -f -s -a v1.5 "$action_release_commit" \
  -m "codex-review-gate-action v1.5"
git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -f -s -a v1 "$action_release_commit" \
  -m "codex-review-gate-action v1"
```

## Generate Provenance Schema v2

Run the complete generator against the frozen default refs and all three local
tag refs:

```bash
set -euo pipefail

source_repo_path="$(pwd -P)"
action_repo_path="../codex-review-gate-action"
source_release_commit="$(git rev-parse 'refs/heads/master^{commit}')"
action_release_commit="$(
  git -C "$action_repo_path" rev-parse 'refs/heads/master^{commit}'
)"

npm run release:provenance -- \
  --source-repo "$source_repo_path" \
  --source-repository JoeyTeng/codex-review-gate \
  --source-commit "$source_release_commit" \
  --source-default-ref refs/heads/master \
  --action-repo "$action_repo_path" \
  --action-repository JoeyTeng/codex-review-gate-action \
  --action-commit "$action_release_commit" \
  --action-default-ref refs/heads/master \
  --immutable-tag-ref refs/tags/v1.5.2 \
  --minor-tag-ref refs/tags/v1.5 \
  --major-tag-ref refs/tags/v1 \
  --output v1.5.2-release-provenance.json
```

The generator checks the source/action default refs and all three local tag
refs before create-only publication, including immediately before the atomic
hard link, and performs a final revalidation after publication. It never
overwrites an existing output path. If that post-publication revalidation
fails, its failure handler neither mutates nor unlinks the final path and the
CLI exits nonzero. If the path still exists, audit and quarantine it; a
concurrent actor may already have moved or replaced it, so the failure does not
guarantee path existence or content identity. Do not upload it. After audit,
retry only with a new absent output path, never by overwriting the old path.
Together with its in-generation ref checks, this narrows the local TOCTOU
window only; it does not create an atomic snapshot across the source and action
repositories or across multiple refs. Remote publication must still use the
exact leases/CAS boundaries below and re-read remote ref, tag-object, and
peeled-commit values both before and after mutation.

`--test-only-skip-signature-verification` is forbidden in production. It is
accepted only by hermetic tests under both explicit test guards.

The deterministic asset has schema
`urn:joeyteng:codex-review-gate:release-provenance:2`, `schema_version: 2`, and
`release: 1.5.2`. Its exact top-level map is `compatibility`, `source`,
`action`, `runtime_closure`, `tags`, `proofs`, `released_tree`,
`critical_files`, and `contracts` in addition to those identity fields.

Verify at least this complete evidence:

- `compatibility.producer_protocol_major == 1` and
  `compatibility.github_immutable_release_required == true`;
- receipt schema ID/version 1 and decision table schema 1,
  `policy_major: 1`, `policy_version: 1.4.0`;
- called workflow repository/path and caller selector `v1`;
- exact source/action commit and tree OIDs, with source subtree tree equal to
  action root tree;
- all three direct annotated tag-object OIDs, their common peeled action
  commit, verified signatures, signing-key fingerprints, and trusted primary
  fingerprints;
- the complete NUL-delimited released-tree inventory and digest;
- critical file blob OIDs/raw SHA-256 values for `package.json`, `action.yml`,
  `.github/workflows/codex-review-gate.yml`,
  `producer-receipt.schema.json`, and `decision-table.json`;
- the frozen admission digest for `action.yml`, the reusable workflow, the
  receipt schema, and the decision table, plus the decision table's immutable
  action-SHA URL;
- `runtime_closure.called_workflow.caller_reference` binding canonical `@v1`
  and its `immutable_reference` binding the exact action SHA; exact
  `source_checkout`, exact local action use, and the closed two-entry external
  action list; `contracts.producer_receipt.source_checkout` must copy the same
  checkout object;
- `referenced_workflows` exact-attempt selection and the cross-bind defining
  `W == referenced_workflows[].sha == receipt job.workflow_sha ==
  producer.action.ref`; `W` must equal exactly one declared
  `runtime_closure.called_workflow.workflow_sha_resolution.candidates` value:
  current-live `W == T == tags.v1.tag_object_oid`, or future `W == C ==
  action.commit_oid`. In both branches independently signed `T` must peel
  directly to `C == tags.v1.peeled_commit_oid == action.commit_oid`; the
  full-SHA-pinned checkout output commit and receipt
  `producer.action.commit_sha` must also equal `C`. Other object types, nested
  tags, and zero or multiple candidate matches fail closed;
- the exact four-item SHA-domain prohibition: neither exact run-attempt
  `head_sha` nor Artifact API `workflow_run.head_sha` may be required to equal
  the selected receipt status head; exact run-attempt `head_sha` may not be
  required to equal `GITHUB_WORKFLOW_SHA`; and `GITHUB_WORKFLOW_SHA` may not be
  required to equal `job.workflow_sha`; and
- `proofs.revocation_freshness_checked == false` and
  `proofs.release_asset_is_signed_attestation == false`.

The signed tags authenticate their tag objects; the JSON asset is not itself a
signature, OIDC attestation, or signed attestation. Immutable-release controls
protect the published tag and assets after publication. Point-in-time
verification still does not prove historical or future revocation freshness.

## Publish in the Safe Order

Prepare `v1.5.2-release-notes.md` with no SHA placeholders. It must state:

- canonical live caller
  `jobs.<job>.uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`;
- floating `@v1` is the centralised pre-execution trust boundary, while
  `job.workflow_sha`, exact-attempt `referenced_workflows[].sha`, and receipt
  `producer.action.ref` define `W`. State that the current live shape is
  `W == T == tags.v1.tag_object_oid`, while the closed second candidate is
  future `W == C == action.commit_oid`; in both branches post-run authority
  verifies independently signed `T`, its direct peel to `C`, and equality among the
  called-workflow-controlled checkout output commit, receipt
  `producer.action.commit_sha`, and the trusted-signer immutable
  release/provenance action commit and root tree;
- the actual lower-case action commit for audit and direct composite/GHES
  compatibility;
- producer protocol major 1, receipt schema v1, decision `policy_major: 1` and
  `policy_version: 1.4.0`;
- the targeted scheduled-dispatch marker
  `codex_review_gate_trigger=scheduled-target-v1`, the fixed
  `CODEX_REVIEW_GATE_AUTO_RETRY` forwarding boundary, and that this transport
  adds no composite Action input;
- receipt output names and their causal/integrity-only limitations; and
- the immediate post-alias ordinary live `@v1` canary gate, followed by a
  targeted-dispatch canary from the downstream consumer branch before that
  consumer enables per-PR scheduling.

Publish in this order so an `@v1` consumer never sees new runtime code before
its immutable release authority is available:

1. Push only `refs/tags/v1.5.2`, without force, then verify its remote tag-object
   OID and peeled action commit.
2. Create a draft GitHub Release for `v1.5.2`; attach the final notes and
   `v1.5.2-release-provenance.json` while it is still draft.
3. Recheck the immutable-release repository setting, require the draft release
   `tag_name`/`tagName` to be exact `v1.5.2`, and immediately before publish
   re-read the remote direct tag-object OID and peeled commit. Both must equal
   `tags["v1.5.2"].tag_object_oid/peeled_commit_oid` in the generated manifest;
   also recheck the asset name, asset SHA-256, and notes, then publish the draft.
4. After publish, require the release REST object to report exact tag name
   `v1.5.2`, `draft: false`, `prerelease: false`, and `immutable: true`. Re-read
   the remote direct tag-object OID and peeled commit against the same manifest
   fields before and after running
   `gh release verify v1.5.2 --repo JoeyTeng/codex-review-gate-action` and
   `gh release verify-asset v1.5.2 v1.5.2-release-provenance.json --repo JoeyTeng/codex-review-gate-action`, and
   independently re-downloading and digest-checking the asset. Any mismatch
   fails closed before the compatibility aliases move.
5. Only after those checks succeed, read the exact `v1.5` and `v1` tag-object
   OIDs from a freshly downloaded provenance asset that is byte-for-byte equal
   to the generated asset. Require both manifest entries to describe admitted
   signed annotated tags that peel to the manifest's `action.commit_oid`, and
   reverify those exact local objects. Use the OIDs themselves—not mutable local
   tag refs—as the sources of one atomic push. Use exact
   `--force-with-lease` values for both previously observed remote `v1.5` and
   `v1` tag-object OIDs.
   Require atomic push support; a rejected ref leaves both aliases unchanged.
6. Re-read both remote alias tag-object OIDs and peeled commits and require exact
   equality with the manifest-bound OIDs and action commit. Rerun the generator
   to a verification file and require byte-for-byte equality with the already
   published provenance asset.

The immutable tag and draft-to-published release steps have this shape:

```bash
set -euo pipefail

action_repo_path="../codex-review-gate-action"
generated_provenance_path="v1.5.2-release-provenance.json"
manifest_immutable_tag_binding="$(
  jq -er '
      def oid:
        type == "string" and test("^[0-9a-f]{40}$");
      . as $manifest
      | ($manifest.tags["v1.5.2"]) as $tag
      | select(
          $manifest.release == "1.5.2" and
          ($manifest.action.commit_oid | oid) and
          $tag.ref == "refs/tags/v1.5.2" and
          $tag.annotated == true and
          ($tag.tag_object_oid | oid) and
          ($tag.peeled_commit_oid | oid) and
          $tag.peeled_commit_oid == $manifest.action.commit_oid
        )
      | [$tag.tag_object_oid, $tag.peeled_commit_oid]
      | @tsv
    ' "$generated_provenance_path"
)"
IFS=$'\t' read -r \
  expected_immutable_tag_object_oid \
  expected_action_release_commit <<< "$manifest_immutable_tag_binding"
test "$manifest_immutable_tag_binding" = \
  "$expected_immutable_tag_object_oid"$'\t'"$expected_action_release_commit"

verify_remote_immutable_tag() {
  local remote_tag_record
  local remote_peeled_record

  remote_tag_record="$(
    git -C "$action_repo_path" ls-remote --tags \
      origin refs/tags/v1.5.2
  )"
  test "$remote_tag_record" = \
    "$expected_immutable_tag_object_oid"$'\trefs/tags/v1.5.2'
  remote_peeled_record="$(
    git -C "$action_repo_path" ls-remote --tags \
      origin 'refs/tags/v1.5.2^{}'
  )"
  test "$remote_peeled_record" = \
    "$expected_action_release_commit"$'\trefs/tags/v1.5.2^{}'
}

git -C "$action_repo_path" push origin \
  refs/tags/v1.5.2:refs/tags/v1.5.2

gh release create v1.5.2 \
  --repo JoeyTeng/codex-review-gate-action \
  --draft \
  --verify-tag \
  --title "codex-review-gate-action v1.5.2" \
  --notes-file v1.5.2-release-notes.md \
  v1.5.2-release-provenance.json

draft_release_binding="$(
  gh release view v1.5.2 \
    --repo JoeyTeng/codex-review-gate-action \
    --json tagName,isDraft \
    --jq '[.tagName, .isDraft] | @tsv'
)"
test "$draft_release_binding" = $'v1.5.2\ttrue'
verify_remote_immutable_tag

gh release edit v1.5.2 \
  --repo JoeyTeng/codex-review-gate-action \
  --draft=false

published_release_binding="$(
  gh api \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2026-03-10' \
    repos/JoeyTeng/codex-review-gate-action/releases/tags/v1.5.2 \
    --jq '[.tag_name, .draft, .prerelease, .immutable] | @tsv'
)"
test "$published_release_binding" = $'v1.5.2\tfalse\tfalse\ttrue'
verify_remote_immutable_tag

gh release verify v1.5.2 \
  --repo JoeyTeng/codex-review-gate-action
gh release verify-asset \
  v1.5.2 \
  v1.5.2-release-provenance.json \
  --repo JoeyTeng/codex-review-gate-action

published_provenance_path="v1.5.2-published-release-provenance.json"
test ! -e "$published_provenance_path"
gh release download v1.5.2 \
  --repo JoeyTeng/codex-review-gate-action \
  --pattern v1.5.2-release-provenance.json \
  --output "$published_provenance_path"
cmp -s v1.5.2-release-provenance.json "$published_provenance_path"
verify_remote_immutable_tag
```

The alias push shape is deliberately separate from the immutable tag/release:

Set `TRUSTED_RELEASE_PRIMARY_FINGERPRINT` only from the independently
controlled signer policy. Do not copy it from either provenance file. The
freshly downloaded asset is the authority for the alias tag-object OIDs; the
generated asset must remain byte-for-byte identical to it. The shell validates
the independently supplied 40- or 64-hex fingerprint before canonicalising it
to the lower-case representation used by the generator.

```bash
set -euo pipefail

action_repo_path="../codex-review-gate-action"
generated_provenance_path="v1.5.2-release-provenance.json"
published_provenance_path="v1.5.2-published-release-provenance.json"
release_evidence_path="v1.5.2-expected-remote-alias-tag-objects.tsv"
trusted_primary_fingerprint_input="${TRUSTED_RELEASE_PRIMARY_FINGERPRINT:?}"
release_gpg_path="$(realpath "$(command -v gpg)")"
test -x "$release_gpg_path"
test -f "$generated_provenance_path"
test -f "$published_provenance_path"
cmp -s "$generated_provenance_path" "$published_provenance_path"
[[ "$trusted_primary_fingerprint_input" =~ \
  ^[0-9A-Fa-f]{40}([0-9A-Fa-f]{24})?$ ]]
trusted_primary_fingerprint="$(
  printf '%s' "$trusted_primary_fingerprint_input" |
    tr '[:upper:]' '[:lower:]'
)"

manifest_alias_binding="$(
  jq -er \
    --arg trusted_primary_fingerprint "$trusted_primary_fingerprint" '
        def oid:
          type == "string" and test("^[0-9a-f]{40}$");
        def fingerprint:
          type == "string" and
          test("^[0-9a-f]{40}([0-9a-f]{24})?$");
        def admitted_tag($name; $commit_oid; $primary_fingerprint):
          .ref == ("refs/tags/" + $name) and
          .annotated == true and
          (.tag_object_oid | oid) and
          .peeled_commit_oid == $commit_oid and
          (.peeled_commit_oid | oid) and
          .signature.verified == true and
          .signature.method == "git-verify-tag-openpgp-raw" and
          (.signature.signing_key_fingerprint | fingerprint) and
          .signature.primary_key_fingerprint == $primary_fingerprint and
          (.signature.primary_key_fingerprint | fingerprint);
        . as $manifest
        | ($manifest.action.commit_oid) as $commit_oid
        | select(
            $manifest.schema ==
              "urn:joeyteng:codex-review-gate:release-provenance:2" and
            $manifest.schema_version == 2 and
            $manifest.release == "1.5.2" and
            ($commit_oid | oid) and
            ($manifest.tags["v1.5.2"] |
              admitted_tag(
                "v1.5.2";
                $commit_oid;
                $trusted_primary_fingerprint
              )) and
            ($manifest.tags["v1.5"] |
              admitted_tag(
                "v1.5";
                $commit_oid;
                $trusted_primary_fingerprint
              )) and
            ($manifest.tags.v1 |
              admitted_tag(
                "v1";
                $commit_oid;
                $trusted_primary_fingerprint
              ))
          )
        | [
            $commit_oid,
            $manifest.tags["v1.5"].tag_object_oid,
            $manifest.tags.v1.tag_object_oid
          ]
      | @tsv
    ' "$published_provenance_path"
)"
IFS=$'\t' read -r \
  expected_action_release_commit \
  expected_v1_5_tag_object_oid \
  expected_v1_tag_object_oid <<< "$manifest_alias_binding"
test "$manifest_alias_binding" = \
  "$expected_action_release_commit"$'\t'\
"$expected_v1_5_tag_object_oid"$'\t'"$expected_v1_tag_object_oid"
test "$expected_v1_5_tag_object_oid" != "$expected_v1_tag_object_oid"

verify_manifest_tag_object() {
  local tag_object_oid="$1"
  local peeled_commit_oid

  test "$(
    git -C "$action_repo_path" cat-file -t "$tag_object_oid"
  )" = tag
  peeled_commit_oid="$(
    git -C "$action_repo_path" rev-parse --verify "${tag_object_oid}^{commit}"
  )"
  test "$peeled_commit_oid" = "$expected_action_release_commit"
  git -C "$action_repo_path" \
    -c gpg.format=openpgp \
    -c "gpg.program=$release_gpg_path" \
    -c "gpg.openpgp.program=$release_gpg_path" \
    verify-tag --raw "$tag_object_oid"
}

verify_manifest_tag_object "$expected_v1_5_tag_object_oid"
verify_manifest_tag_object "$expected_v1_tag_object_oid"

IFS=$'\t' read -r \
  expected_remote_v1_5_tag_object_oid \
  expected_remote_v1_tag_object_oid < "$release_evidence_path"
test "${#expected_remote_v1_5_tag_object_oid}" -eq 40
test "${#expected_remote_v1_tag_object_oid}" -eq 40
[[ "$expected_remote_v1_5_tag_object_oid" != *[!0-9a-f]* ]]
[[ "$expected_remote_v1_tag_object_oid" != *[!0-9a-f]* ]]
current_remote_v1_5_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1.5
)"
test "$current_remote_v1_5_record" = \
  "$expected_remote_v1_5_tag_object_oid"$'\trefs/tags/v1.5'
current_remote_v1_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1
)"
test "$current_remote_v1_record" = \
  "$expected_remote_v1_tag_object_oid"$'\trefs/tags/v1'

git -C "$action_repo_path" push --atomic \
  --force-with-lease="refs/tags/v1.5:$expected_remote_v1_5_tag_object_oid" \
  --force-with-lease="refs/tags/v1:$expected_remote_v1_tag_object_oid" \
  origin \
  "$expected_v1_5_tag_object_oid:refs/tags/v1.5" \
  "$expected_v1_tag_object_oid:refs/tags/v1"

verify_remote_alias() {
  local alias_ref="$1"
  local expected_tag_object_oid="$2"
  local remote_tag_record
  local remote_peeled_record

  remote_tag_record="$(
    git -C "$action_repo_path" ls-remote --tags origin "$alias_ref"
  )"
  test "$remote_tag_record" = \
    "$expected_tag_object_oid"$'\t'"$alias_ref"
  remote_peeled_record="$(
    git -C "$action_repo_path" ls-remote --tags origin "${alias_ref}^{}"
  )"
  test "$remote_peeled_record" = \
    "$expected_action_release_commit"$'\t'"${alias_ref}^{}"
}

verify_remote_alias refs/tags/v1.5 "$expected_v1_5_tag_object_oid"
verify_remote_alias refs/tags/v1 "$expected_v1_tag_object_oid"
```

Do not fall back to separate alias pushes if the atomic update fails. Re-read
remote state, resolve the conflict, and rerun the full admission proof. Retain
both persisted pre-release alias tag-object OIDs with the other release evidence.
Do not replace either manifest-bound source OID with a local alias ref or
re-resolve it after validation.

## Live Canaries and Completion

Treat the v1.5.0 canary as a fail-closed compatibility finding, not an erratum:
its immutable provenance contract incorrectly treated GitHub's selected
annotated `v1` tag-object OID as the peeled action commit. Do not admit v1.5.0
through a digest-keyed exception and do not mutate its immutable release. After
v1.5.2 is published and both aliases advance, immediately run a replacement
ordinary GitHub.com canary with the existing source-root caller selecting
`@v1`. Require all of the following before declaring the source release
transaction complete:

- the called job's `job.workflow_repository/file_path/ref/sha` is the canonical
  tuple and its SHA `W` equals exactly one declared workflow-SHA resolution
  candidate: current-live signed annotated `v1` tag-object `T`, or future exact
  action commit `C`;
- the receipt maps that job repository/selected-object SHA to
  `producer.action.ref` with `immutable: true`; the full-SHA-pinned checkout's
  official `steps.checkout.outputs.commit` reaches the local composite only
  through the called-workflow-controlled
  `CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA` environment binding, and
  receipt `producer.action.commit_sha` equals that peeled action commit rather
  than any workflow-call/caller input;
- the exact run-attempt response contains exactly one canonical
  `referenced_workflows` member whose SHA matches `W == job.workflow_sha ==
  producer.action.ref` and the selected manifest candidate;
- the independently signed exact `v1` tag object `T` verifies under the trusted
  primary signer and peels directly to `C == release-provenance.action.commit_oid`,
  including in the future `W == C` branch; the signed immutable `v1.5.2` tag
  peels to that same commit; the checkout output, receipt
  `producer.action.commit_sha`, action root tree, and critical files all match
  the provenance asset;
- the receipt artifact, status membership, GraphQL status re-read, and
  independently reduced provider evidence all pass their stable checks; and
- the reusable job ran on literal `ubuntu-slim`; no caller repository variable
  selected a self-hosted runner. Treat this as a runtime trust boundary, not a
  cryptographic or OIDC attestation; and
- the canary did not checkout or execute PR code.

The source-root workflow exposes only its existing pull-request input and native
global schedule. Do not pre-activate the new marker there: v1.5.1 would
misinterpret that dispatch while the floating alias still selects it. After the
ordinary canary passes, use the downstream consumer branch that adds
`codex_review_gate_trigger=scheduled-target-v1` to run a targeted-dispatch
canary against one exact pull request. Require the same admission checks, the
exact marker, and the intended auto-retry policy before that consumer enables
or schedules per-PR dispatches. A targeted canary failure blocks only that
consumer rollout; it does not justify mutating the immutable release or moving
the aliases back without a separately reviewed recovery transaction.

Future compatible v1.x Action-only releases can advance `v1` without changing
the caller or Skill, provided the same dynamic admission accepts their signed
immutable release/provenance and `policy_major: 1`. A producer protocol or
policy major change is breaking and requires a coordinated Skill/caller plan.

## Why Subtree

`packages/action` is a stable package boundary whose contents are complete as
a repository root. `git subtree split --prefix=packages/action` is therefore a
direct release operation; source-only tests, CI, and rollout coordination stay
outside the published package.
