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

The false-negative allowance does not justify treating known data as execution. Context-like fields inside `env`, `with`, `outputs` or `secrets` data, including nested container environment mappings, and YAML-looking selector text inside block scalars, are not by themselves proof of a publisher or caller. The scanner keeps those references nonblocking while retaining its separate recognition of actual command/API publishing patterns. An environment, input, output or secret value may still flow into a publisher; tracing that data flow remains outside this preflight. This distinction is bounded source classification, not a promise of complete YAML or shell semantics.

Here, `env` / `with` / `outputs` / `secrets` means mapping properties, not a job ID with the same spelling. Likewise, CLI-shaped output text such as `echo -f context=...` is not a publishing command. A bounded folded job name is compared as a complete value, not a single physical line; incomplete or over-budget values warn rather than proving a collision from a prefix. Known YAML step boundaries reset local literal tracking regardless of the first step field; list-looking text inside data or a scalar is not an execution boundary.

The supported `gh api` publishing matches exclude recognized explicit GET/HEAD method forms for both context and CheckRun-name fields. Other recognized command fields remain candidates, including a PATCH CheckRun-name update; non-POST does not mean read-only. Unsupported command forms remain outside the completeness guarantee.

Endpoint classification uses the leading literal endpoint directly after `gh api`, allowing simple surrounding quotes. Endpoint-like text inside a GraphQL query, header or other payload is not an endpoint. This deliberately does not interpret arbitrary argument ordering, option arity or shell expansion; option-before-endpoint and other unsupported forms can remain warning-only coverage limits.

The supported CLI match is confined to the first command before an unquoted shell separator. Flags belonging to a later command are not request parameters of the first one. This bounded prefix scan is not a full shell parser or a guarantee of detecting writers in later commands or complex substitutions.

Non-run block-scalar bodies and matrix contents are data for this heuristic; action-input data flow is not interpreted. Truncated physical lines, clipped input tails and incomplete window values must not establish an exact collision or supply a prefix literal to later matching. Existing limit warnings remain visible.

Definite block-scalar job-name recognition is restricted to complete supported explicit strip-chomp forms (`|-` / `>-`). Default/keep chomping and other unsupported scalar details can remain warning-only; the scanner does not trim away meaningful body spaces or implement full YAML scalar semantics. Supported curl recognition binds a literal payload and explicit POST to the actual unambiguous URL operand; header text is not a request target. Unknown option layouts or ambiguous targets remain coverage limits, not proof of a publisher.

Supported `gh api` field matches use the default GitHub host or an explicit `github.com` hostname, without `--input`. An explicit different or ambiguous host, or any file/stdin input body, is not classified as a publisher by this heuristic; files are not opened to infer request content. Supported curl publication uses HTTPS on `api.github.com`, no URL user-info, the default/443 port, and exactly one literal body option. Other hosts and multiple body options stay nonblocking; the scanner does not compose HTTP bodies.

A known block-scalar `run` containing `<<` is conservatively skipped as an entire unclassified run block, with a warning. This deliberately also skips lookalike text and real commands in that block instead of interpreting here-document delimiters or shell expansion. Local literal state is cleared rather than carried through the skipped block. It is an accepted coverage loss, not evidence that no publisher exists there.

All raw source-text diagnostic excerpts are omitted, not only known credential-shaped fields. Finding kind, workflow path, line and fixed explanatory messages remain available; operators inspect that source location themselves. This avoids exporting a credential in an unrecognized spelling without requiring the scanner to understand every secret format.

Repeated `gh api` method flags remain unclassified instead of inferring the effective final method. Semicolons inside a quoted string are not standalone assignment boundaries. Ordinary local scanning compares canonical workflow paths using one slash representation, while strict reviewed-writer identities and digest snapshots retain their existing handling.

Quoted scalar display text is not an additional YAML field, and punctuation in a YAML job name remains part of its identity. The supported literal curl JSON body is read only for a top-level string field on the exact supported POST route; a nested name or an update-route suffix does not prove a create request. CLI method evidence comes from supported argument positions, not method-like prose in a quoted header or payload value. These are identity and scope corrections within the existing bounded forms, not new coverage guarantees.

Encoded body forms such as curl `--data-urlencode` remain unclassified: their raw argument is not the JSON emitted on the wire, and this scanner does not decode or simulate that transport.

## Additional intentionally unclassified forms

The scan does not interpret descriptor redirections such as `2>&1` or `&>`.
Its bounded first-command prefix can stop at their ampersand and miss a real
publisher later in that same command ([review example](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4305246320)).
This is an accepted warning-only transport gap under the ordinary operator-trust
contract, not a claim that those commands cannot publish the reserved signal.
The exact reported gh/curl examples are retained as warning-only regressions;
no shell-redirection recognizer is added.

Quoted strings remain data even when preceded by `JSON.parse`. Programmatic
JSON parsing and JavaScript data flow stay outside this heuristic, avoiding a
special case that also misclassified YAML display text ([review example](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4305246314)).
These additions do not change the eight earlier fixed warning-only examples or
relax the runtime unresolved-finding gate.

CLI payload fields use literal case-sensitive field keys and a closed set of
supported argument positions. Unknown option layouts and shell-expanded field
values remain unclassified; tokenization alone does not prove whether a dollar
expression was quoted literally or expanded. No shell expansion or arbitrary
option-value interpretation is added to recover those matches.

The scanner also deliberately does not decode a quoted inline YAML `run` value
or escaped YAML job-name scalars. Those can contain real publishers or decode
to the reserved name; the [quoted-run](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4305333685)
and [escaped-name](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4305333692)
examples remain warning-only rather than introducing YAML decoding semantics.
The ordinary `-F` alias is supported alongside `--field`; adding that existing
literal option alias does not add typed-value/file or stdin interpretation.

When the ordinary installer already knows its target repository, supported CLI
and curl API requests that literally name a different owner/repository do not
prove a publisher in that target. Repository-name comparison is case-insensitive;
dynamic or encoded destinations are not proven foreign. Remote installation
reuses its existing repository identity. Offline preparation optionally reads
the local origin once, without a network lookup; absent, invalid or unreadable
origin data produces a generic warning and retains the conservative scan.
This scope correction does not suppress additional gate callers or matching job
names, and does not change strict historical/proof paths.

Known flow-style environment/input/output/secret/matrix mappings are data just
like their block-form equivalents; a nested `context` does not itself prove a
publisher. Known strategy, container, service and default-run-settings properties
are likewise configuration data, including a flow container around matrix or
environment fields; jobs whose IDs have those spellings remain jobs.
Plain YAML scalar text retains a `//` suffix rather than applying
JavaScript comment semantics to a job name. These are false-positive scope and
value-identity corrections, not complete YAML parsing or executable-language
comment interpretation.

## Safeguards that remain strict

This accepted preflight risk does not relax exact-byte verification of the canonical verifier and controller workflows, the repository-wide `default_workflow_permissions=read` preflight, canonical workflow permissions, CODEOWNERS and ruleset protections, or canary verification. Frozen historical organization handoff, bridge-removal, and source-only proof contracts remain unchanged.

Future scan-coverage work needs a separate explicit product decision that weighs the requested format, implementation complexity, and expected benefit. This note records the accepted scope of this change; it is not a permanent prohibition on improving coverage.
