# 发布 Action Package

语言：[British English (en-GB)](RELEASING.md) | [简体中文 (zh-CN)](RELEASING.zh-CN.md)

Marketplace repository 是 `packages/action` 的 subtree split。发布到
`JoeyTeng/codex-review-gate-action` root 的所有内容，包括 reusable workflow，都必须
位于该目录内。

## 两阶段 Rollout Boundary

本流程用于准备未来的 v1.5.0 release；完成源码修改不表示 release 已发生。

Release PR 只在 `packages/action` 中 stage reusable workflow。它不得激活 source-root
caller、repository template 或对应 root 文档。只有 immutable v1.5.0 release 与
provenance 已发布、`v1.5` 和 `v1` aliases 已验证且 live `@v1` canary 通过后，才由独立
activation PR 修改 caller/template。

该顺序保证 active source/template caller 不会在 immutable post-run authority 就绪前，
把 pre-execution trust 委托给 `@v1`。

## Preconditions

- Source release commit 已 merge，且是 exact `master` tip。
- Root `package.json` 与 `packages/action/package.json` 都声明 `1.5.0`。
- `packages/action/decision-table.json` 声明 `schema_version: 1`、
  `policy_major: 1` 与 `policy_version: 1.4.0`；reviewed frozen raw SHA-256 为
  `3f0032df69e2015c1dfe198c20a141652b2dcaba520e8749a5d049d31ffd7ad3`。
- Producer protocol major 1 与 producer receipt schema v1 保持兼容。
- `packages/action/.github/workflows/codex-review-gate.yml` 已存在。其 runtime closure
  只有 full-SHA-pinned
  `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`、
  `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`，以及 local
  `./.codex-review-gate-action` use。
- Called workflow checkout 精确使用
  `repository: ${{ job.workflow_repository }}`、
  `ref: ${{ job.workflow_sha }}`、path `.codex-review-gate-action` 与
  `persist-credentials: false`，不存在 bare checkout 或 PR checkout。
- 其他 reviewed frozen raw SHA-256 与 generator constants 一致：`action.yml` 为
  `3b73835ec0e8dfb2305f0801ebaa7b3f9ea04e02c72392e822aabcd25d2093be`，
  reusable workflow 为
  `91720b868b972d947a65fa3cc408d8c866d83cf4d75032f6bfb597b014752bce`，
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

1. immutable release tag `v1.5.0`；
2. minor compatibility alias `v1.5`；
3. major compatibility alias `v1`。

绝不移动 `v1.5.0`，也不修改既有 immutable/older compatibility tags。禁止通用
`git push -f --tags`。

Generator 会解析 absolute GnuPG executable、清除 inherited `GIT_*` 与 global/system Git
configuration，并且只在 `git verify-tag --raw` 产生恰好一个 identity-consistent
`GOODSIG` 与 `VALIDSIG`、且没有 rejecting status 时接受 tag。每个 tag 都记录
`signing_key_fingerprint` 与 `primary_key_fingerprint`。

发布前，必须要求三个 tag 的 `primary_key_fingerprint` 全部等于 independently
predeclared trusted primary fingerprint。Signing subkey fingerprint 可以不同，因此
primary fingerprint 才是 trust anchor。

本 release session 开始时、替换 local `v1` alias 前，先 fresh probe remote，要求
`refs/tags/v1.5.0` 与 `refs/tags/v1.5` 的输出都严格为空，并要求两个 local refs 也不
存在。任一 ref 已存在时必须停下审计，绝不覆盖 immutable 或 minor release ref。随后只
读取一次 remote `v1` tag-object OID，并把它持久化为 release evidence。后续 exact
lease 必须使用这个事先观察到的值，不能把 alias push 前才首次读取的新值当作可信基准。

三个 local tags 必须使用同一个 resolved GnuPG executable 与保持不变的 keyring：

```bash
set -euo pipefail

action_repo_path="../codex-review-gate-action"
release_evidence_path="v1.5.0-expected-remote-v1-tag-object.txt"
test ! -e "$release_evidence_path"
remote_immutable_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1.5.0
)"
remote_minor_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1.5
)"
test -z "$remote_immutable_record"
test -z "$remote_minor_record"
for release_ref in refs/tags/v1.5.0 refs/tags/v1.5; do
  if git -C "$action_repo_path" show-ref --verify --quiet "$release_ref"; then
    exit 1
  else
    test "$?" -eq 1
  fi
done
remote_v1_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1
)"
expected_remote_v1_tag_object_oid="${remote_v1_record%%$'\t'*}"
test "$remote_v1_record" = \
  "$expected_remote_v1_tag_object_oid"$'\trefs/tags/v1'
test "${#expected_remote_v1_tag_object_oid}" -eq 40
[[ "$expected_remote_v1_tag_object_oid" != *[!0-9a-f]* ]]
printf '%s\n' "$expected_remote_v1_tag_object_oid" > "$release_evidence_path"

action_release_commit="$(
  git -C "$action_repo_path" rev-parse 'refs/heads/master^{commit}'
)"
release_gpg_path="$(realpath "$(command -v gpg)")"
test -x "$release_gpg_path"

git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -s -a v1.5.0 "$action_release_commit" \
  -m "codex-review-gate-action v1.5.0"
git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -s -a v1.5 "$action_release_commit" \
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
  --immutable-tag-ref refs/tags/v1.5.0 \
  --minor-tag-ref refs/tags/v1.5 \
  --major-tag-ref refs/tags/v1 \
  --output v1.5.0-release-provenance.json
```

Generator 会在 create-only output 发布前检查两次 source/action default refs 与三个 local tag
refs，第二次紧邻 final atomic hard link；它绝不覆盖或删除既有 output path。结合 generation 内部的 ref
checks，这只会缩小本地 TOCTOU window，不会为 source/action 两个 repositories 或多个
refs 建立 atomic snapshot。Remote publication 前后仍必须使用下文的 exact lease/CAS
boundary，并重新读取 remote ref、tag-object 与 peeled-commit values。

Production 中禁止 `--test-only-skip-signature-verification`；它只允许在同时满足两个显式
test guards 的 hermetic tests 中使用。

Deterministic asset 的 schema 是
`urn:joeyteng:codex-review-gate:release-provenance:2`，`schema_version: 2`，
`release: 1.5.0`。除这些 identity fields 外，exact top-level map 为
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
- exact-attempt `referenced_workflows` selection，以及其 selected SHA 和 receipt
  `job.workflow_sha` 到 `release-provenance.action.commit_oid` 的 cross-bind；
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

先准备不含任何 SHA placeholder 的 `v1.5.0-release-notes.md`。内容必须说明：

- post-activation canonical caller：
  `jobs.<job>.uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`；
- floating `@v1` 是集中式 pre-execution trust boundary；post-run authority 来自 exact
  `job.workflow_sha`、exact-attempt `referenced_workflows` 与 trusted-signer immutable
  release/provenance；
- 用于 audit 与 direct composite/GHES compatibility 的 actual lower-case action commit；
- producer protocol major 1、receipt schema v1、decision `policy_major: 1` 与
  `policy_version: 1.4.0`；
- receipt output names 与 causal/integrity-only limitations；
- 独立的 post-release activation gate。

严格按以下顺序发布，避免 `@v1` consumer 在 immutable release authority 就绪前看到新
runtime：

1. 只 push `refs/tags/v1.5.0`，禁止 force；随后验证 remote tag-object OID 与 peeled
   action commit。
2. 为 `v1.5.0` 创建 draft GitHub Release，在 draft 状态附上 final notes 与
   `v1.5.0-release-provenance.json`。
3. 重查 immutable-release repository setting、draft tag、asset name、asset SHA-256 与
   notes，然后 publish draft。
4. 要求 release REST object exact 报告 `immutable: true`。运行
   `gh release verify v1.5.0 --repo JoeyTeng/codex-review-gate-action` 与
   `gh release verify-asset v1.5.0 v1.5.0-release-provenance.json --repo JoeyTeng/codex-review-gate-action`，并独立重新下载和
   digest-check asset。
5. 只有上述检查成功后，才 atomic publish `v1.5` 并把 `v1` 移到已 admitted 的 signed
   tag objects。对事先观察到的 remote `v1` tag-object OID 使用 exact
   `--force-with-lease`。必须要求 atomic push support；任一 ref 被拒绝时两个 aliases
   都保持不变。
6. 重读两个 remote alias tag-object OIDs 与 peeled commits。把 generator rerun 到
   verification file，并要求其 bytes 与已发布 provenance asset 完全相同。

Immutable tag 与 draft-to-published release 步骤如下：

```bash
set -euo pipefail

action_repo_path="../codex-review-gate-action"
git -C "$action_repo_path" push origin \
  refs/tags/v1.5.0:refs/tags/v1.5.0

gh release create v1.5.0 \
  --repo JoeyTeng/codex-review-gate-action \
  --draft \
  --verify-tag \
  --title "codex-review-gate-action v1.5.0" \
  --notes-file v1.5.0-release-notes.md \
  v1.5.0-release-provenance.json

gh release edit v1.5.0 \
  --repo JoeyTeng/codex-review-gate-action \
  --draft=false

test "$(
  gh api \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2026-03-10' \
    repos/JoeyTeng/codex-review-gate-action/releases/tags/v1.5.0 \
    --jq '.immutable'
)" = true

gh release verify v1.5.0 \
  --repo JoeyTeng/codex-review-gate-action
gh release verify-asset \
  v1.5.0 \
  v1.5.0-release-provenance.json \
  --repo JoeyTeng/codex-review-gate-action
```

Alias push 刻意与 immutable tag/release 分开：

```bash
set -euo pipefail

action_repo_path="../codex-review-gate-action"
release_evidence_path="v1.5.0-expected-remote-v1-tag-object.txt"
expected_remote_v1_tag_object_oid="$(sed -n '1p' "$release_evidence_path")"
test "${#expected_remote_v1_tag_object_oid}" -eq 40
[[ "$expected_remote_v1_tag_object_oid" != *[!0-9a-f]* ]]
current_remote_v1_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1
)"
test "$current_remote_v1_record" = \
  "$expected_remote_v1_tag_object_oid"$'\trefs/tags/v1'

git -C "$action_repo_path" push --atomic \
  --force-with-lease="refs/tags/v1:$expected_remote_v1_tag_object_oid" \
  origin \
  refs/tags/v1.5:refs/tags/v1.5 \
  refs/tags/v1:refs/tags/v1
```

Atomic update 失败时禁止改用 separate alias pushes。重读 remote state、解决冲突，并重跑
完整 admission proof。把持久化的 pre-release `v1` tag-object OID 与其他 release
evidence 一并保留。

## Live Canary 与 Activation

使用已发布 canonical caller `@v1` 运行 GitHub.com canary。Activation 前必须证明：

- called job 的 `job.workflow_repository/file_path/ref/sha` 是 canonical tuple 与 exact
  v1.5.0 action commit；
- receipt 把该 job repository/SHA 映射为 `producer.action` with `immutable: true`；
- exact run-attempt response 恰好含有一个 canonical `referenced_workflows` member，
  其 SHA 匹配 receipt 与 release provenance；
- receipt artifact、status membership、GraphQL status re-read 与独立归约的 provider
  evidence 都通过 stable checks；
- canary 未 checkout 或执行 PR code。

只有这时才能创建独立 activation PR，把 source-root caller、template caller 与
root/template consumer documentation 改为 `@v1`。

未来兼容的 v1.x Action-only releases 可以移动 `v1`，无需修改 caller 或 Skill；前提是
同一 dynamic admission 接受 signed immutable release/provenance 与
`policy_major: 1`。Producer protocol 或 policy major 变化属于 breaking change，必须
协调 Skill/caller plan。

## 为什么使用 Subtree

`packages/action` 是稳定 package boundary，其内容可完整作为 repository root。因此
`git subtree split --prefix=packages/action` 是直接 release operation；source-only
tests、CI 与 rollout coordination 留在 published package 之外。
