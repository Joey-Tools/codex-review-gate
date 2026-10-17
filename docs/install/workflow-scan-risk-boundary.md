# Workflow source scan: accepted risk boundary

This note documents the accepted limits of the ordinary current-v2 installer preflight. It clarifies the existing contract; it does not change installer or runtime behavior.

## What the scan does and does not establish

The scoped keyword scan is a best-effort heuristic over workflow source text. It is not a complete YAML parser, shell interpreter, or JavaScript interpreter, and it does not establish complete data flow. Only explicit matches recognized by the scanner block installation. Unsupported or unrecognized literal forms may be missed. Recognized references, uncertain candidates and scan limits can produce warnings; unsupported forms need not. No warning does not prove that no other workflow can emit the reserved signal.

This preflight is neither security isolation nor proof of a unique producer. Required-check `integration_id: 15368` identifies the shared GitHub Actions App, not an individual workflow. The ordinary install accepts that other workflows and their runners remain an operator-trust boundary; it does not require unrelated publishers to be isolated.

## Accepted warning-only coverage gaps

The following eight PR #128 review examples are intentionally accepted as warning-only coverage gaps in this change. No new recognition logic is added for them, and the scanner does not promise to warn for every instance:

- `curl` body options such as `--data` or `--json`, whose implicit POST semantics may require interpreting other method-selection options ([review discussion](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4304322776)).
- A bare YAML `-` step ([review discussion](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4304322781)).
- A flow mapping used as one block-sequence step, such as `- { uses: ... }` ([review discussion](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4304433545)).
- Multiline YAML flow-style syntax ([review discussion](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4304322783)).
- A `run` command inside a flow-style step ([review discussion](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4304322787)).
- A folded `run: >` scalar ([review discussion](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4304322790)).
- A `gh` request body supplied with `--input -`, including stdin or a here-string ([review discussion](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4304322791)).
- An Octokit JavaScript `checks.create` body ([review discussion](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4304322794)).

These accepted scanner-coverage examples do not by themselves establish a security regression or change runtime evidence. They also do not waive ordinary runtime handling of unresolved review findings.

The false-negative allowance does not justify treating known data as execution. Context-like fields inside `env` or `with` data, and YAML-looking selector text inside block scalars, are not by themselves proof of a publisher or caller. The scanner keeps those references nonblocking while retaining its separate recognition of actual command/API publishing patterns. An environment or input value may still flow into a publisher; tracing that data flow remains outside this preflight. This distinction is bounded source classification, not a promise of complete YAML or shell semantics.

## Safeguards that remain strict

This accepted preflight risk does not relax exact-byte verification of the canonical verifier and controller workflows, the repository-wide `default_workflow_permissions=read` preflight, canonical workflow permissions, CODEOWNERS and ruleset protections, or canary verification. Frozen historical organization handoff, bridge-removal, and source-only proof contracts remain unchanged.

Future scan-coverage work needs a separate explicit product decision that weighs the requested format, implementation complexity, and expected benefit. This note records the accepted scope of this change; it is not a permanent prohibition on improving coverage.
