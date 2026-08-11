# 发布 Action Package

语言：[British English (en-GB)](RELEASING.md) | [简体中文 (zh-CN)](RELEASING.zh-CN.md)

Marketplace repository 是 `packages/action` 的 subtree split。发布到
`JoeyTeng/codex-review-gate-action` root 的所有内容，包括 reusable workflow，都必须
位于该目录内。

## 兼容 v1.x Rollout Boundary

本流程用于准备兼容的 v1.5.2 targeted-schedule release。Immutable v1.5.1 release 是
首个 admitted reusable-workflow baseline，source-root caller 与 repository template
已经选择 `@v1`。完成源码修改不表示 v1.5.2 release 已发生。

Release PR 修改 `packages/action` 中 packaged reusable workflow，但不改变 producer
protocol major 1、receipt schema v1 或 decision policy 1.4。Packaged workflow 把闭合的
`workflow_dispatch` marker `codex_review_gate_trigger=scheduled-target-v1` 识别为
auto-retry gating 的 schedule-equivalent，并把 `CODEX_REVIEW_GATE_AUTO_RETRY` 传入
composite Action。该 marker 仍是 caller event-payload protocol，不是新 Action input。

先发布并验证 immutable v1.5.2 release 与 provenance，再一起移动 signed `v1.5` 和
`v1` aliases。Active callers 已选择 `@v1`，因此 alias transaction 是 live activation
boundary。紧接着从现有 source-root caller 运行普通 live `@v1` canary。Source-root
workflow 不暴露 targeted dispatch marker；downstream consumer branch 必须新增 marker，
并在启用 per-PR scheduling 前通过自己的 targeted-dispatch canary。

## Preconditions

- Source release commit 已 merge，且是 exact `master` tip。
- Root `package.json` 与 `packages/action/package.json` 都声明 `1.5.2`。
- `packages/action/decision-table.json` 声明 `schema_version: 1`、
  `policy_major: 1` 与 `policy_version: 1.4.0`；reviewed frozen raw SHA-256 为
  `6c04ccf20e5033639c2ba88931ea10ba7b6577189f91f6eaeea9b2792892b8a7`。
- Producer protocol major 1 与 producer receipt schema v1 保持兼容。
- Receipt structural selection 保持 native-action precedence：native action
  repository/ref 任一 field 存在就选择 direct identity，并忽略 reusable checkout-commit
  environment；只有两个 native fields 都缺失且 called job tuple exact canonical 时，
  才能采用 reusable W/C binding。
- `packages/action/.github/workflows/codex-review-gate.yml` 已存在。其 runtime closure
  只有 full-SHA-pinned
  `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`、
  `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`，以及 local
  `./.codex-review-gate-action` use。
- Reusable job literal 使用 `runs-on: ubuntu-slim`，不读取
  `vars.CODEX_REVIEW_GATE_RUNNER_LABELS` 或任何 caller-controlled runner selector。
  GitHub-hosted runner 是 checkout output、worktree 与 receipt production 的 runtime
  trust root；direct composite caller 保留现有 caller-owned runner 配置。
- Called workflow checkout 精确使用
  `repository: ${{ job.workflow_repository }}`、
  `ref: ${{ job.workflow_sha }}`、path `.codex-review-gate-action` 与
  `persist-credentials: false`。Step ID 是 `checkout`；official `commit` output 只能通过
  `CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA: ${{ steps.checkout.outputs.commit }}`
  传入 local composite，绝不能来自 workflow-call/caller input。不存在 bare checkout 或
  PR checkout。
- Reusable workflow 只把 caller `workflow_dispatch` payload 中 exact
  `codex_review_gate_trigger: scheduled-target-v1` 视为 targeted scheduled scan。它通过
  fixed `CODEX_REVIEW_GATE_AUTO_RETRY` environment binding 转发
  `vars.CODEX_REVIEW_GATE_AUTO_RETRY`，所以 `false` 会同时禁用 broad schedule 与
  targeted scheduled dispatch。两者都不作为 caller-controlled Action input 暴露。
- 其他 reviewed frozen raw SHA-256 与 generator constants 一致：`action.yml` 为
  `3b73835ec0e8dfb2305f0801ebaa7b3f9ea04e02c72392e822aabcd25d2093be`，
  reusable workflow 为
  `c4b5c4eb61c8ae586357b44fffc951e751e7478685b56d299cb45ad391c659fb`，
  `producer-receipt.schema.json` 为
  `89decfcabeeab817a975b1118498375c4eafe730b35e2cb9aa5c4abde6637b77`。
- Source checks、package checks、tests 与 release split validation 全部通过。
- Action repository default branch 能接收 verified subtree split。
- Release operator 可以使用 trusted OpenPGP key，并已从独立控制的 signer policy
  获取 expected primary-key fingerprint。禁止把 candidate manifest 首次出现的
  fingerprint 自己当作 trust root。
- Release operator 的 GitHub credential 能读取 immutable-release preflight 所需的
  repository Administration state。

发布任何 release ref 前，action repository 必须启用 immutable releases。使用 GitHub
REST API version `2026-03-10` 时，
`GET /repos/JoeyTeng/codex-review-gate-action/immutable-releases` 必须返回 HTTP 200，
且 top-level `enabled` exact 为 `true`；404 或其他值都 fail closed。
`enforced_by_owner` 可记录，但不改变 admission。参见 GitHub 的
[repository endpoint](https://docs.github.com/en/rest/repos/repos?apiVersion=2026-03-10#check-if-immutable-releases-are-enabled-for-a-repository)
与 [immutable-release guidance](https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/supply-chain-security/immutable-releases)。

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

Provenance generator 会记录 signature verification 与 fingerprints，但不决定哪个 primary
signer 可信，也不执行 revocation-freshness service check；两者都是 consumer/operator
policy input。

## 同步并证明 Subtree

Canonical path 是 automatic sync workflow。Source release commit merge 后，选择 exact
`sync-action-subtree.yml` push run，要求其 `headSha` 等于该 source commit，并 watch 到
terminal `success`；保留 run ID/URL/head SHA 作为 release evidence。该 workflow 只把计算
出的 `packages/action` split 推到 `JoeyTeng/codex-review-gate-action:master`，不会创建
release 或移动 tag。正常路径为 fast-forward；只有已记录的 squash-merge
equivalent-parent 情形才使用 guarded lease。

另在 exact source commit 的 fresh full-history checkout 中独立运行 split validation，并
记录 computed split commit：

```bash
set -euo pipefail

npm run release:split
```

随后用 action repository 的 fresh full checkout 要求
`master` 等于已记录的 computed split commit，并证明 tree equality。Automatic sync
成功后禁止再做第二次 manual push。

只有 automatic workflow 无法使用时，才允许显式 manual fallback。它要求另行验证
`action` remote，并使用同一 fresh/full source checkout 与 split proof：

```bash
set -euo pipefail

git remote get-url action
scripts/release-action-subtree.sh --remote action --branch master --push
```

同步后必须证明：

- source `master` 是 intended source release commit；
- selected sync run 的 `headSha` exact 等于该 commit，且 terminal 为 `success`；
- action `master` 是 intended split commit；
- source commit 的 `packages/action` tree OID exact 等于 action commit root tree OID；
- tag/provenance 准备期间两个 default refs 都不变化。

## 创建并验证 Local Release Tags

在 action repository 中创建三个 direct signed annotated tags，并要求全部 peel 到同一个
verified action commit：

1. immutable release tag `v1.5.2`；
2. minor compatibility alias `v1.5`；
3. major compatibility alias `v1`。

绝不移动 `v1.5.0`、`v1.5.1` 或 `v1.5.2`。v1.5.2 release 只推进两个 compatibility
aliases，不修改任何 immutable 或 older release tag。禁止通用
`git push -f --tags`。

Generator 会解析 absolute GnuPG executable、清除 inherited `GIT_*` 与 global/system Git
configuration，并且只在 `git verify-tag --raw` 产生恰好一个 identity-consistent
`GOODSIG` 与 `VALIDSIG`、且没有 rejecting status 时接受 tag。每个 tag 都记录
`signing_key_fingerprint` 与 `primary_key_fingerprint`。

发布前，必须要求三个 tag 的 `primary_key_fingerprint` 全部等于 independently
predeclared trusted primary fingerprint。Signing subkey fingerprint 可以不同，因此
primary fingerprint 才是 trust anchor。

本 release session 开始时、替换两个 local aliases 前，先 fresh probe remote，要求
`refs/tags/v1.5.2` 的输出严格为空，并要求该 local ref 不存在。它已存在时
必须停下审计，绝不覆盖 immutable release ref。分别只读取一次已存在的 remote
`v1.5` 与 `v1` tag-object OIDs，并持久化为 release evidence。后续 exact leases
必须使用这两个事先观察到的值，不能把 alias push 前才首次读取的新值
当作可信基准。

三个 local tags 必须使用同一个 resolved GnuPG executable 与保持不变的 keyring：

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

## 生成 Provenance Schema v2

对 frozen default refs 与三个 local tag refs 运行完整 generator：

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

Generator 会在 create-only publication 前检查 source/action default refs 与三个 local tag
refs，包括紧邻 atomic hard link 前的检查，并在 publication 后做 final revalidation。它绝不
覆盖既有 output path。如果 post-publication revalidation 失败，failure handler 既不
修改也不 unlink final path，CLI 以 nonzero 退出。如果 path 仍存在，对它做
audit/quarantine；concurrent actor 可能已经移走或替换它，因此该失败不保证 path 仍存在，
也不保证 content identity。禁止上传该 output。Audit 后只能使用新的 absent output
path 重试，禁止覆盖旧 path。
结合 generation 内部的 ref checks，这只会缩小本地 TOCTOU window，不会为
source/action 两个 repositories 或多个 refs 建立 atomic snapshot。Remote publication 前后仍必须
使用下文的 exact lease/CAS boundary，并重新读取 remote ref、tag-object 与
peeled-commit values。

Production 中禁止 `--test-only-skip-signature-verification`；它只允许在同时满足两个显式
test guards 的 hermetic tests 中使用。

Deterministic asset 的 schema 是
`urn:joeyteng:codex-review-gate:release-provenance:2`，`schema_version: 2`，
`release: 1.5.2`。除这些 identity fields 外，exact top-level map 为
`compatibility`、`source`、`action`、`runtime_closure`、`tags`、`proofs`、
`released_tree`、`critical_files` 与 `contracts`。

至少完整验证以下证据：

- `compatibility.producer_protocol_major == 1` 与
  `compatibility.github_immutable_release_required == true`；
- receipt schema ID/version 1，以及 decision table schema 1、
  `policy_major: 1`、`policy_version: 1.4.0`；
- called workflow repository/path 与 caller selector `v1`；
- exact source/action commit/tree OIDs，且 source subtree tree 等于 action root tree；
- 三个 direct annotated tag-object OIDs、共同 peeled action commit、verified signatures、
  signing-key fingerprints 与 trusted primary fingerprints；
- 完整 NUL-delimited released-tree inventory 与 digest；
- `package.json`、`action.yml`、`.github/workflows/codex-review-gate.yml`、
  `producer-receipt.schema.json` 与 `decision-table.json` 的 critical blob OIDs/raw
  SHA-256；
- `action.yml`、reusable workflow、receipt schema 与 decision table 的 frozen admission
  digests，以及 decision table immutable action-SHA URL；
- `runtime_closure.called_workflow.caller_reference` 绑定 canonical `@v1`，其
  `immutable_reference` 绑定 exact action SHA；还要有 exact `source_checkout`、exact
  local action use 与 closed two-entry external action list；
  `contracts.producer_receipt.source_checkout` 必须复制同一个 checkout object；
- exact-attempt `referenced_workflows` selection 与 cross-bind，定义 `W ==
  referenced_workflows[].sha == receipt job.workflow_sha == producer.action.ref`；`W` 必须
  恰好等于 `runtime_closure.called_workflow.workflow_sha_resolution.candidates` 中一个
  declared value：current-live `W == T == tags.v1.tag_object_oid`，或 future `W == C ==
  action.commit_oid`。两个分支都要求 independently signed `T` direct peel 到 `C ==
  tags.v1.peeled_commit_oid == action.commit_oid`；full-SHA-pinned checkout output commit 与
  receipt `producer.action.commit_sha` 也必须等于 `C`。其他 object type、nested tag、零个或
  多个 candidate match 都 fail closed；
- exact 四项 SHA-domain 禁令：不得要求 exact run-attempt `head_sha` 或 Artifact API
  `workflow_run.head_sha` 等于 selected receipt status head；不得要求 exact run-attempt
  `head_sha` 等于 `GITHUB_WORKFLOW_SHA`；也不得要求 `GITHUB_WORKFLOW_SHA` 等于
  `job.workflow_sha`；
- `proofs.revocation_freshness_checked == false` 与
  `proofs.release_asset_is_signed_attestation == false`。

Signed tags 认证各自 tag object；JSON asset 本身不是 signature、OIDC attestation 或
signed attestation。Immutable-release controls 在发布后保护 tag 与 assets。
Point-in-time verification 仍不证明 historical/future revocation freshness。

## 按安全顺序发布

先准备不含任何 SHA placeholder 的 `v1.5.2-release-notes.md`。内容必须说明：

- canonical live caller：
  `jobs.<job>.uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`；
- floating `@v1` 是集中式 pre-execution trust boundary；`job.workflow_sha`、
  exact-attempt `referenced_workflows[].sha` 与 receipt `producer.action.ref` 定义 `W`。说明
  当前 live shape 是 `W == T == tags.v1.tag_object_oid`，闭合的第二 candidate 是 future
  `W == C == action.commit_oid`；两个分支都验证 independently signed `T`、其到 `C` 的
  direct peel，以及 called-workflow-controlled
  checkout output commit、receipt `producer.action.commit_sha`、trusted-signer immutable
  release/provenance action commit 与 root tree 的 equality；
- 用于 audit 与 direct composite/GHES compatibility 的 actual lower-case action commit；
- producer protocol major 1、receipt schema v1、decision `policy_major: 1` 与
  `policy_version: 1.4.0`；
- targeted scheduled-dispatch marker
  `codex_review_gate_trigger=scheduled-target-v1`、fixed
  `CODEX_REVIEW_GATE_AUTO_RETRY` forwarding boundary，以及该 transport 不新增
  composite Action input；
- receipt output names 与 causal/integrity-only limitations；
- alias 移动后立即执行的普通 live `@v1` canary gate；随后由 downstream consumer
  branch 执行 targeted-dispatch canary，consumer 通过后才能启用 per-PR scheduling。

严格按以下顺序发布，避免 `@v1` consumer 在 immutable release authority 就绪前看到新
runtime：

1. 只 push `refs/tags/v1.5.2`，禁止 force；随后验证 remote tag-object OID 与 peeled
   action commit。
2. 为 `v1.5.2` 创建 draft GitHub Release，在 draft 状态附上 final notes 与
   `v1.5.2-release-provenance.json`。
3. 重查 immutable-release repository setting，要求 draft release 的 `tag_name`/`tagName`
   exact 为 `v1.5.2`；紧邻 publish 前重读 remote direct tag-object OID 与 peeled commit，
   并要求两者分别等于 generated manifest 的
   `tags["v1.5.2"].tag_object_oid/peeled_commit_oid`。同时重查 asset name、asset SHA-256 与
   notes，然后 publish draft。
4. Publish 后要求 release REST object 报告 exact tag name `v1.5.2`、`draft: false`、
   `prerelease: false` 与 `immutable: true`。运行下列命令前后，都要重读 remote
   direct tag-object OID/peeled commit 并与同一 manifest fields 比较：
   `gh release verify v1.5.2 --repo JoeyTeng/codex-review-gate-action` 与
   `gh release verify-asset v1.5.2 v1.5.2-release-provenance.json --repo JoeyTeng/codex-review-gate-action`，并独立重新下载和
   digest-check asset。任何 mismatch 都必须在 compatibility aliases 移动前 fail closed。
5. 只有上述检查成功后，才从 freshly downloaded、且与 generated asset 逐字节相同的
   provenance asset 中读取 exact `v1.5` 与 `v1` tag-object OIDs。要求两个 manifest
   entries 都描述已 admitted 的 signed annotated tags，且 peel 到 manifest 的
   `action.commit_oid`；随后重新验证这些 exact local objects。一次 atomic push 必须直接
   使用这些 OIDs，而不是 mutable local tag refs。对事先观察到的 remote `v1.5` 与 `v1`
   tag-object OIDs 分别使用 exact `--force-with-lease`。必须要求 atomic push support；任一
   ref 被拒绝时两个 aliases 都保持不变。
6. 重读两个 remote alias tag-object OIDs 与 peeled commits，并要求分别 exact 等于
   manifest-bound OIDs 与 action commit。把 generator rerun 到 verification file，并
   要求其 bytes 与已发布 provenance asset 完全相同。

Immutable tag 与 draft-to-published release 步骤如下：

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

Alias push 刻意与 immutable tag/release 分开：

`TRUSTED_RELEASE_PRIMARY_FINGERPRINT` 只能来自 independently controlled signer
policy，禁止从任一 provenance file 复制。Freshly downloaded asset 是 alias tag-object
OIDs 的 authority；generated asset 必须与它保持逐字节相同。Shell 会先验证这个独立
提供的 fingerprint 是 40 或 64 位 hexadecimal，再 canonicalize 为 generator 使用的
lower-case representation。

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

Atomic update 失败时禁止改用 separate alias pushes。重读 remote state、解决冲突，并重跑
完整 admission proof。把持久化的两个 pre-release alias tag-object OIDs 与其他 release
evidence 一并保留。禁止用 local alias ref 替换任一 manifest-bound source OID，也禁止在
validation 后重新解析这些 OIDs。

## Live Canaries 与完成边界

把 v1.5.0 canary 视为 fail-closed compatibility finding，而不是 erratum：其 immutable
provenance contract 错把 GitHub selected annotated `v1` tag-object OID 当成 peeled action
commit。禁止用 digest-keyed exception admit v1.5.0，也禁止修改其 immutable release。
发布 v1.5.2 并推进两个 aliases 后，立即使用现有 source-root caller 选择 `@v1` 重新运行
普通 GitHub.com canary。声明 source release transaction 完成前必须证明：

- called job 的 `job.workflow_repository/file_path/ref/sha` 是 canonical tuple，且 SHA `W` 恰好
  等于一个 declared workflow-SHA resolution candidate：current-live signed annotated `v1` tag
  object `T`，或 future exact action commit `C`；
- receipt 把该 job repository/selected-object SHA 映射为 `producer.action.ref` with
  `immutable: true`；full-SHA-pinned checkout 的 `steps.checkout.outputs.commit` 只能经
  called-workflow-controlled `CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA` environment
  binding 传入 local composite，且 receipt `producer.action.commit_sha` 等于该 peeled
  action commit，不能来自 workflow-call/caller input；
- exact run-attempt response 恰好含有一个 canonical `referenced_workflows` member，
  其 SHA 匹配 `W == job.workflow_sha == producer.action.ref` 与 selected manifest candidate；
- independently signed exact `v1` tag object `T` 在 trusted primary signer 下验签通过，
  并 direct peel 到 `C == release-provenance.action.commit_oid`，即使是 future `W == C`
  分支也一样；signed immutable `v1.5.2` tag peel 到同一
  commit，checkout output、receipt `producer.action.commit_sha`、action root tree 与
  critical files 都匹配 provenance asset；
- receipt artifact、status membership、GraphQL status re-read 与独立归约的 provider
  evidence 都通过 stable checks；
- reusable job 在 literal `ubuntu-slim` 上运行，且没有 caller repository variable 选择
  self-hosted runner；这是 runtime trust boundary，不是 cryptographic 或 OIDC
  attestation；
- canary 未 checkout 或执行 PR code。

Source-root workflow 只暴露既有 pull-request input 与 native global schedule。禁止在这里
预先激活新 marker：floating alias 仍选择 v1.5.1 时，它会误解该 dispatch。普通 canary
通过后，使用新增 `codex_review_gate_trigger=scheduled-target-v1` 的 downstream consumer
branch，针对一个 exact pull request 运行 targeted-dispatch canary。该 consumer 启用或
调度 per-PR dispatch 前，必须通过同一 admission checks，并证明 exact marker 与预期
auto-retry policy。Targeted canary 失败只阻断该 consumer rollout；它不授权修改 immutable
release，也不授权在没有另行 review 的 recovery transaction 时回移 aliases。

未来兼容的 v1.x Action-only releases 可以移动 `v1`，无需修改 caller 或 Skill；前提是
同一 dynamic admission 接受 signed immutable release/provenance 与
`policy_major: 1`。Producer protocol 或 policy major 变化属于 breaking change，必须
协调 Skill/caller plan。

## 为什么使用 Subtree

`packages/action` 是稳定 package boundary，其内容可完整作为 repository root。因此
`git subtree split --prefix=packages/action` 是直接 release operation；source-only
tests、CI 与 rollout coordination 留在 published package 之外。
