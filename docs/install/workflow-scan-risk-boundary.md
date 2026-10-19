# Workflow source scan: accepted risk boundary

This note documents the accepted limits of the ordinary current-v2 installer preflight. It clarifies the existing contract; it does not change installer or runtime behavior.

## What the scan does and does not establish

The scoped keyword scan is a best-effort heuristic over workflow source text. It is not a complete YAML parser, shell interpreter, or JavaScript interpreter, and it does not establish complete data flow. Only explicit matches recognized by the scanner block installation. Unsupported or unrecognized literal forms may be missed. Recognized references, uncertain candidates and scan limits can produce warnings; unsupported forms need not. No warning does not prove that no other workflow can emit the reserved signal.

This preflight is neither security isolation nor proof of a unique producer. Required-check `integration_id: 15368` identifies the shared GitHub Actions App, not an individual workflow. The ordinary install accepts that other workflows and their runners remain an operator-trust boundary; it does not require unrelated publishers to be isolated.

A local assignment to a context-like variable is not itself publication. Its
literal may support a later recognized publishing sink (the command or API
field that actually emits the signal), but the assignment alone stays
nonblocking. Likewise, the legacy reusable caller identity is the exact
`Joey-Tools/codex-review-gate/.github/workflows/codex-review-gate.yml` path,
not every reusable workflow hosted in that repository.

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

The examples above are not exhaustive. In particular, on Windows a workflow's
`GH api ...` command can invoke `gh.exe` while the scanner's exact lowercase
`gh api` source grammar does not recognize that executable spelling. This concrete
platform-specific false negative remains warning-only under the existing
unsupported literal/platform/shell-semantics boundary ([PR #128 review
finding](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309246151)).
It can publish a competing check; this is a real coverage gap, not a claim
that the request cannot publish. Keep the matcher unchanged: do not add executable
discovery or shell/platform interpretation, and do not globally case-fold the
command because `GH` and `gh` can denote different executables on Unix. This
is not a fifth accepted conservative false-positive match. The original four
named conservative matches, eight listed warning-only examples, and strict
installer/runtime controls remain unchanged.
Microsoft documents that external application discovery follows the underlying
filesystem's case behavior ([PowerShell case sensitivity](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_case-sensitivity?view=powershell-7.6)); this source-only fixture is not a Windows execution test.

The false-negative allowance does not justify treating known data as execution. Context-like fields inside `env`, `with`, `outputs` or `secrets` data, including nested container environment mappings, and YAML-looking selector text inside block scalars, are not by themselves proof of a publisher or caller. The scanner keeps those references nonblocking while retaining its separate recognition of actual command/API publishing patterns. An environment, input, output or secret value may still flow into a publisher; tracing that data flow remains outside this preflight. This distinction is bounded source classification, not a promise of complete YAML or shell semantics.

Here, `env` / `with` / `outputs` / `secrets` means mapping properties, not a job ID with the same spelling. Likewise, CLI-shaped output text such as `echo -f context=...` is not a publishing command. A bounded folded job name is compared as a complete value, not a single physical line; incomplete or over-budget values warn rather than proving a collision from a prefix. Known YAML step boundaries reset local literal tracking regardless of the first step field; list-looking text inside data or a scalar is not an execution boundary.

The supported `gh api` publishing matches exclude recognized explicit GET/HEAD method forms for both context and CheckRun-name fields. Other recognized command fields remain candidates, including a PATCH CheckRun-name update; non-POST does not mean read-only. Unsupported command forms remain outside the completeness guarantee.

For a supported CheckRun collection-create POST, the CLI match requires the
exact `head_sha` field with nonempty supplied CLI text. This is a raw-text
presence check, not proof that CLI conversion produces a JSON string or that
the request succeeds. A dynamic CLI value is also presence-only: the scan does
not evaluate its expansion or prove that its runtime value is nonempty. The
explicitly accepted typed-nonstring case is recorded below. The supported curl
POST JSON form requires a nonempty top-level string `head_sha`. This narrow
field-presence rule does not validate the full API schema or SHA format; the existing name-only PATCH match
with a canonical positive-decimal run ID is unchanged ([review finding](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4307496207)).
No additional API, shell, or value interpreter is added.

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

Within a known job span, a recognized `matrix:` key or supported flow mention makes that
job's exact reserved-name candidates unknown and warning-only; the scan does
not interpret matrix structure or expansion. A shared flow-style physical line
can conservatively lose all its name candidates when one matrix mention is
recognized; this is not per-job expansion proof. Other separately classified
non-matrix jobs and control matches remain visible. Likewise, a recognized explicit YAML `shell:`
configuration makes command-publisher matches source-wide unknown and
warning-only, including inline commands, curl commands and variable-derived
paths. Actual action callers and job-name matches remain eligible. These rules
intentionally lose coverage even for harmless or data-only matrix text and
ordinary shell declarations; the scan does not inherit defaults or interpret
shell configuration with a shell implementation. The accepted matrix loss
includes a block-form `env:` mapping with a nested `matrix:` key and a reusable
job's block-form `with:` mapping with a nested `matrix:` input, even though
neither establishes `strategy.matrix` expansion ([review finding](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4306626036)).
The finding's inline-map example is not reproduced by this heuristic; this note
records only the recognized block-form key mentions.
The accepted shell loss also includes a job ID named `shell` or an `env`/`with`
data entry named `shell`, even without an actual run-shell setting
([review finding](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4306626032)).
No YAML role or `strategy.matrix` parser is added to distinguish those cases;
action-caller and unaffected job-name recognition remain eligible, and strict
canonical/runtime controls remain unchanged.

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
supported argument positions. Unknown option layouts and shell-expanded gate
name/context values remain unclassified; tokenization alone does not prove
whether a dollar expression was quoted literally or expanded. The separate
`head_sha` presence check does not resolve that value. No shell expansion or
arbitrary option-value interpretation is added to recover those matches.

The scanner also deliberately does not decode a quoted inline YAML `run` value
or escaped YAML job-name scalars. Those can contain real publishers or decode
to the reserved name; the [quoted-run](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4305333685)
and [escaped-name](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4305333692)
examples remain warning-only rather than introducing YAML decoding semantics.
The ordinary `-F` alias is supported alongside `--field`; adding that existing
literal option alias does not add typed-value/file or stdin interpretation.

When the ordinary installer already knows its target repository, the scan's
owner/repository filter uses only literal CLI/curl destination text. The
case-insensitive text comparison does not establish an immutable repository
identity or account for redirects. A literal former-slug destination that
redirects to the configured repository may therefore be missed as a publisher
([review finding](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4306800104)).
Dynamic or encoded destinations are not proven foreign. Remote installation
reuses its existing target identity. Offline preparation optionally reads the
local origin once, without a network lookup; absent, invalid or unreadable
origin data produces a generic warning and retains the conservative scan. No
alias/redirect network lookup is performed; Joey explicitly accepted this
bounded gap rather than adding that lookup. This scope correction does not
suppress additional gate callers or matching job names, and does not change
strict historical/proof paths.

Known flow-style environment/input/output/secret/matrix mappings are data just
like their block-form equivalents; a nested `context` does not itself prove a
publisher. Known strategy, container, service and default-run-settings properties
are likewise configuration data, including a flow container around matrix or
environment fields; jobs whose IDs have those spellings remain jobs.
Plain YAML scalar text retains a `//` suffix rather than applying
JavaScript comment semantics to a job name. These are false-positive scope and
value-identity corrections, not complete YAML parsing or executable-language
comment interpretation.

Existing simple anchor prefixes are removed before classifying an otherwise
supported empty or flow data mapping; aliases and arbitrary YAML semantics are
not evaluated. A trailing backslash inside an open single-quoted curl argument
does not establish a shell line continuation; that unsupported body remains
unclassified rather than reconstructing a different JSON payload.

Ordinary permission warnings use fixed messages as well as omitted excerpts.
Neither permission-parser exceptions nor arbitrary parsed permission names are
copied into diagnostics; both can contain raw workflow text. Operators inspect
the reported workflow path instead. Strict validation decisions are unchanged.

Known folded `run: >` blocks stay unclassified as whole blocks. Physical lines
cannot establish separate shell commands after YAML folding; no reconstruction
is attempted. Literal `|` run blocks keep their separate supported matching.

Within a known literal `run` block, an unsupported incomplete shell physical
line (for example, a backslash-continued `echo` or an unclosed quote) makes the
entire block unknown to this scan. The bounded curl continuation groups remain
supported unless another incomplete line makes the block unknown. In that
case, even an earlier provisional literal curl match is suppressed. This is an
intentional coverage loss, not evidence that the block cannot execute a
publisher.

A multiline quoted YAML scalar, including a quoted `run` value, remains
unclassified through its conservative dedent boundary. The scan does not fold
or decode that scalar; `context`, `uses` or `gh`-looking text inside it is not
proof of a job field, action caller or executable command. This is bounded
classification, not YAML parsing or execution analysis.

An indentless sequence item under `steps:` remains a step even when its
indentation equals the `steps:` key. Its `name` is a step display name, not the
enclosing job's name. This role correction avoids a false job-name collision;
it does not broaden the scanner's syntax coverage.

Mentioning `GH_HOST` anywhere in the bounded workflow source makes implicit-host
gh API publication unclassified for that scan, with a fixed warning. This is a
conservative coverage loss even for inactive/data/comment references, not scoped
environment inheritance or evaluation. A supported explicit `--hostname github.com`
can still establish the host. No host-override value is printed.

Likewise, a bounded-source `GH_REPO` mention leaves only `gh api` endpoints
containing recognized `{owner}` or `{repo}` placeholders in repository path
components unclassified; literal
endpoints remain eligible for the existing repository-text filter, including
its literal foreign-destination handling. The scan does not interpret scoped
environment inheritance, overrides, aliases, or the value of `GH_REPO`. This
deliberately loses placeholder-endpoint coverage even when a mention is
inactive, data, or comment text. The local `gh api --help` consulted for this
boundary says endpoint placeholders may be filled from the current directory
or `GH_REPO`; the relevant current-head review findings are [query/fragment
route handling](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309084677)
and [GH_REPO placeholder routing](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309084682).
Endpoint query/fragment text is not treated as additional route identity:
endpoints containing `?` or `#` remain unclassified rather than being parsed
or normalized by this source heuristic. This is an accepted best-effort
coverage loss, not an additional named conservative false-positive waiver;
the existing four named waivers and eight warning-only examples are unchanged.
Strict canonical/runtime controls and curl whitespace handling are unchanged.

Three narrow CLI/curl corrections keep supported matching tied to literal,
unambiguous request evidence ([Content-Length override/removal](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309174015),
[fixed route-segment case](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309174019),
[backslash-bearing URL](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309174026)). A literal curl `Content-Length` header override or
removal makes that request unclassified: do not calculate or infer the
effective wire length. Curl documents that custom headers replace its internal
header, so the source text alone cannot establish the transmitted request
shape ([curl `-H` documentation](https://curl.se/docs/manpage.html#-H)). For
supported API routes, fixed path segments such as `repos`, `check-runs` and
`statuses` compare case-sensitively; host, owner and repository identity retain
their intended case-insensitive comparison. A read-only probe observed the
existing check-run GET route succeed in lowercase and return HTTP 404 when the
fixed segment was uppercased under the same identity. This is GET evidence,
not a POST experiment. Finally, a literal URL containing a backslash is
unclassified before URL parsing: do not normalize it through WHATWG or curl
URL rules, which are not interchangeable ([curl URL syntax](https://curl.se/docs/url-syntax.html)).
These are conservative classification limits, not new interpreters or
additional false-positive waivers; the four accepted conservative matches
and eight warning-only cases remain unchanged.

Three narrow R11 corrections prevent false positives without inferring
runtime expansion ([partial repository placeholder](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309295711),
[caller workflow path case](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309295712),
[folded `uses` prefix](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309295713)). When the target repository is known and an endpoint has a recognized exact
`{owner}` or `{repo}` placeholder in one repository component, a different
valid literal ASCII owner or repository component still establishes that the
destination is foreign. Do not substitute the placeholder, infer its runtime
value from the environment/current directory, or perform a network lookup.
For reusable workflow caller identity, compare owner/repository identity
case-insensitively but keep `.github/workflows/` path components and the
workflow path/extension exact and case-sensitive. For a supported folded
`uses` block scalar, defer classification until the complete scalar boundary;
only a complete single-content-line value with a plain `>-` or `|-`
strip-chomp marker can be matched. Multiline or blank-containing, truncated,
over-budget, explicit-indentation, non-strip-chomp, or otherwise uncertain values remain
unclassified rather than being matched from a physical-line prefix. These
rules distinguish an ordinary terminal LF/CRLF's empty split record from
actual blank scalar content, so a complete one-line strip-chomp caller at EOF
does not lose its match merely because the file has a terminating newline. The
bounded literal corrections add no placeholder substitution, environment or
YAML interpreter, and no new conservative false-positive waiver.
The four named conservative matches, original eight warning-only examples,
and strict installer/runtime controls remain unchanged.

Three R12 role and value-scope corrections keep the existing literal
classifiers from overclaiming ([curl brace path](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309370811),
[workflow-file selector role](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309370820),
[CLI field collisions](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4309370826)). A literal curl URL path containing braces is unclassified; GitHub's `{owner}` / `{repo}` endpoint-placeholder rule is specific to the supported `gh api` form and is not applied to curl. Reusable-workflow and action selector checks use the existing job/step role annotations: a selector only counts in its matching workflow-file/job or root-action/step role. A wrong or unknown role remains uncertain and warning-only rather than being reinterpreted by a new YAML parser. For supported CLI argument layouts, conflicting spellings of a relevant core field—such as a scalar field key alongside bracket-nested or array-style keys—leave that request candidate unclassified. Do not evaluate JSON, CLI types, schemas or values, and do not discard an otherwise recognized command solely because an unrelated field is nested. These narrow boundaries preserve unrelated matching while adding no general placeholder, role, YAML or CLI-value interpreter. The four named conservative matches, original eight warning-only cases, R11 single-line strip-chomp behavior, and strict installer/runtime/workflow/version/tag scope remain unchanged.

Any backslash inside a double-quoted shell word leaves that command
unclassified instead of interpreting escape rules or erasing characters into a different exact name. A quoted
gh endpoint must end at a token boundary; quoted/unquoted endpoint concatenation
does not prove the quoted prefix is the route. Literal curl `Host` header
overrides are unclassified rather than simulating HTTP virtual-host behavior.
These guards intentionally lose coverage rather than adding interpreters.

Three additional source-classification corrections keep supported publisher
matching bounded ([curl continuation](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4308992826),
[status context comparison](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4308992831),
[status POST fields](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4308992834)).
Supported curl continuations preserve the original scalar content, whitespace
and token adjacency; joining physical lines must not invent a separating
space. If indentation makes the continuation relationship unprovable, leave
the candidate unclassified rather than guessing. This adds no general YAML
or shell interpreter. Status API context comparisons use ASCII case-insensitive
comparison only, consistent with GitHub's documented case-insensitive context
comparison; CheckRun names and job names retain exact, case-sensitive equality.
For a supported status-creation POST, the `state` field must be present with
nonempty supported text: `gh api` uses raw supplied-text
presence, while curl requires a nonempty top-level JSON string. This is not
enum, full-schema, SHA, or typed CLI-value validation, and adds no YAML/shell
interpreter or runtime-policy change ([GitHub status API](https://docs.github.com/en/rest/commits/statuses#create-a-commit-status)).

## Explicitly approved conservative matches

Joey explicitly accepted these four narrow conservative outcomes to keep the
ordinary preflight a bounded source-keyword scan. The first two avoid
caller/callee name analysis and condition evaluation; the `gh` function case
avoids function execution or lookup and avoids skipping a whole block that
could contain a real publisher; the typed-field case avoids CLI value/type
interpretation:

- A reserved job-name string in a `workflow_call`-only reusable workflow may
  still be matched without determining whether a caller references it or how
  GitHub names the resulting native check ([review finding](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4306800092)).
- A publisher-shaped command in a step with literal `if: false` may still be
  matched because the scanner does not evaluate workflow conditions ([review
  finding](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4306800100)).
- A local shell function named `gh` may shadow the CLI while a publisher-shaped
  textual `gh api` command is still matched, causing a conservative false
  positive. The scanner does not execute or resolve shell functions, and
  skipping the entire block could miss another real publisher in it ([review
  finding](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4307496214)).
- A supported `-F` / `--field` `head_sha` argument with nonempty supplied text
  may match even when the argument is null, boolean, or integer typed rather
  than a JSON string. Supplied text does not prove the final JSON type/value or
  that the request succeeds; the scanner does not interpret CLI field values
  or types ([review finding](https://github.com/Joey-Tools/codex-review-gate/pull/128#discussion_r4307680786)).

These syntactic matches can block ordinary installation even when a workflow
is not invoked, a command never executes, or the emitted native name differs.
Joey's approval is limited to these four named cases, not a general waiver for
other false positives. Known-data and exact-literal identity corrections
remain required. A match is not proof that a workflow is invoked, that a step
executes, or that GitHub emits the exact native check name. The accepted
former-slug redirect gap is described above. These dispositions add no broader
caller/callee, condition, shell-function, or CLI field type/value interpreter,
and no additional alias/redirect API query. The separate narrow `head_sha`
presence rule above does not validate the full API schema or SHA value. This
record does not define a bypass, override, or recovery path for literal matches.

## Safeguards that remain strict

This accepted preflight risk does not relax exact-byte verification of the canonical verifier and controller workflows, the repository-wide `default_workflow_permissions=read` preflight, canonical workflow permissions, CODEOWNERS and ruleset protections, or canary verification. Frozen historical organization handoff, bridge-removal, and source-only proof contracts remain unchanged.

Future scan-coverage work needs a separate explicit product decision that weighs the requested format, implementation complexity, and expected benefit. This note records the accepted scope of this change; it is not a permanent prohibition on improving coverage.
