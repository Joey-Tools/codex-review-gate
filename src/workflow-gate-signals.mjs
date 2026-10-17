const DEFAULT_RESERVED_CHECK_NAME = "codex/github-review-gate";
const MAX_INPUT_CHARS = 256 * 1024;
const MAX_LINES = 4096;
const MAX_LINE_CHARS = 4096;
const MAX_WINDOW_LINES = 16;
const MAX_WINDOW_CHARS = 2048;
const MAX_FINDINGS = 32;
const MAX_YAML_SCALAR_ANCHORS = 32;
const MAX_YAML_ANCHOR_VALUE_CHARS = 512;
const MAX_FLOW_COLLECTION_CHARS = 2048;
const MAX_FLOW_COLLECTION_DEPTH = 8;
const MAX_FOLDED_JOB_NAME_LINES = 4;

const ACTION_CALLERS = [
  /^JoeyTeng\/codex-review-gate-action(?:\/\.github\/workflows\/codex-review-gate\.ya?ml)?@[^\s,}"']+$/iu,
  /^Joey-Tools\/codex-review-gate(?:\/\.github\/workflows\/[^@\s,}"']+)?@[^\s,}"']+$/iu,
];

/**
 * Best-effort segmented text heuristic covering only a recognized subset of
 * literal workflow forms; matches does not guarantee detection of every
 * literal, syntax, or transport mechanism. The documented warning-only examples
 * listed in docs/install/workflow-scan-risk-boundary.md are intentional
 * accepted coverage limits. This heuristic is not an installation safety
 * boundary or proof of a unique producer; ordinary installation relies on
 * operator trust. Canonical-asset checks, default-permission checks, and strict
 * legacy-cleanup checks remain separate and unchanged. These scan limits do
 * not affect execution-time review-finding pass/block policy.
 *
 * It never executes scripts, and intentionally ignores permissions by itself.
 */
export function inspectWorkflowGateSignals(
  content,
  { reservedCheckName = DEFAULT_RESERVED_CHECK_NAME } = {},
) {
  const matches = [];
  const warnings = [];
  const matchKeys = new Set();
  const warningKeys = new Set();
  let matchLimitReached = false;
  let warningLimitReached = false;

  const addMatch = (kind, line, raw) => {
    const finding = { kind, line, excerpt: safeExcerpt(raw) };
    const key = `${kind}:${line}:${finding.excerpt}`;
    if (matchKeys.has(key)) return;
    if (matches.length >= MAX_FINDINGS) {
      matchLimitReached = true;
      return;
    }
    matchKeys.add(key);
    matches.push(finding);
  };

  const addWarning = (kind, line, message, raw = "") => {
    const finding = { kind, line, message, ...(raw ? { excerpt: safeExcerpt(raw) } : {}) };
    const key = `${kind}:${line}:${finding.excerpt ?? message}`;
    if (warningKeys.has(key)) return;
    if (warnings.length >= MAX_FINDINGS) {
      warningLimitReached = true;
      return;
    }
    warningKeys.add(key);
    warnings.push(finding);
  };

  if (typeof content !== "string") {
    addWarning("invalid-input", 1, "Workflow content is not a string.");
    return { matches, warnings };
  }

  const reserved =
    typeof reservedCheckName === "string" && reservedCheckName.length > 0
      ? reservedCheckName
      : DEFAULT_RESERVED_CHECK_NAME;
  if (reserved !== reservedCheckName) {
    addWarning(
      "invalid-reserved-check-name",
      1,
      `Reserved check name must be a non-empty string; using ${DEFAULT_RESERVED_CHECK_NAME}.`,
    );
  }

  const clipped = content.slice(0, MAX_INPUT_CHARS);
  const rawLines = clipped.split(/\r\n|\n|\r/u, MAX_LINES + 1);
  const lines = rawLines.slice(0, MAX_LINES).map((raw, index) => {
    if (raw.length > MAX_LINE_CHARS) {
      addWarning(
        "line-truncated",
        index + 1,
        `Line exceeds the ${MAX_LINE_CHARS}-character scan limit; its remainder was skipped.`,
        raw,
      );
    }
    const limited = raw.slice(0, MAX_LINE_CHARS);
    return {
      line: index + 1,
      raw: limited,
      text: stripComments(limited),
      truncated: raw.length > MAX_LINE_CHARS,
    };
  });
  markYamlJobNameFields(lines);
  inspectCurlContinuationBlocks(lines, reserved, addMatch, addWarning);

  if (content.length > clipped.length) {
    addWarning(
      "input-truncated",
      1,
      `Input exceeds the ${MAX_INPUT_CHARS}-character scan limit; only its prefix was inspected.`,
    );
  }
  if (rawLines.length > MAX_LINES) {
    addWarning(
      "line-limit",
      MAX_LINES + 1,
      `Input exceeds the ${MAX_LINES}-line scan limit; remaining lines were skipped.`,
    );
  }

  let foldedUses = null;
  let foldedJobName = null;
  const yamlAnchors = new Map();
  for (const line of lines) {
    if (!line.yamlScalarContent && isYamlDocumentBoundary(line.text)) {
      if (foldedJobName) {
        finishFoldedJobName(foldedJobName, reserved, addMatch, addWarning);
        foldedJobName = null;
      }
      yamlAnchors.clear();
      foldedUses = null;
    } else if (!line.yamlScalarContent && !isRunCommandLine(line.text)) {
      registerYamlScalarAnchors(line, yamlAnchors, addWarning);
    }
    if (foldedJobName) {
      const indent = indentationOf(line.raw);
      if (!line.raw.trim()) {
        if (foldedJobName.lines < MAX_FOLDED_JOB_NAME_LINES) foldedJobName.lines += 1;
        else foldedJobName.unclassified = true;
      } else if (indent > foldedJobName.indent) {
        if (foldedJobName.lines >= MAX_FOLDED_JOB_NAME_LINES) {
          foldedJobName.unclassified = true;
        } else {
          foldedJobName.lines += 1;
          if (line.truncated) foldedJobName.unclassified = true;
          if (foldedJobName.contentIndent === null) foldedJobName.contentIndent = indent;
          if (indent < foldedJobName.contentIndent) {
            foldedJobName.unclassified = true;
          } else if (!line.truncated) {
            const value = line.raw.slice(foldedJobName.contentIndent);
            foldedJobName.fragments.push(value);
            if (value.trim() && foldedJobName.firstContentLine === null) {
              foldedJobName.firstContentLine = line.line;
              foldedJobName.firstContentRaw = line.raw;
            }
          }
        }
      } else if (line.text.trim()) {
        finishFoldedJobName(foldedJobName, reserved, addMatch, addWarning);
        foldedJobName = null;
      }
    }
    if (foldedUses) {
      if (!line.text.trim()) {
        foldedUses.remaining -= 1;
      } else if (indentationOf(line.text) > foldedUses.indent) {
        const expression = line.text.trim();
        const value = resolveSimpleLiteral(expression, new Map());
        if (foldedUses.selector) {
          if (!addCallerMatch(value, line, addMatch)) {
            warnUnscopedCaller(expression, value, line, addWarning);
          }
        } else {
          warnUnscopedCaller(expression, value, line, addWarning);
        }
        foldedUses.remaining -= 1;
      } else {
        foldedUses = null;
      }
      if (foldedUses && foldedUses.remaining <= 0) foldedUses = null;
    }
    if (!line.text.trim()) continue;
    inspectLineSignals(
      line,
      reserved,
      yamlAnchors,
      !isRunCommandLine(line.text),
      addMatch,
      addWarning,
    );
    const yamlFields = line.yamlScalarContent || line.yamlDataField ? [] : fieldsOnLine(line.text);
    const uses = yamlFields.find((field) => field.key === "uses");
    if (uses && isBlockScalarIndicator(stripYamlAnchor(uses.value))) {
      foldedUses = {
        indent: indentationOf(line.text),
        remaining: 4,
        selector: uses && line.selectorUseStarts?.has(uses.start) === true,
      };
    }
    const name = yamlFields.find((field) => isNameField(field.key));
    if (line.jobNameField && name && isBlockScalarIndicator(stripYamlAnchor(name.value))) {
      const indicator = stripYamlAnchor(name.value);
      const explicitIndent = indicator.match(/[1-9]/u)?.[0];
      foldedJobName = {
        indent: indentationOf(line.text),
        contentIndent: explicitIndent ? indentationOf(line.text) + Number(explicitIndent) : null,
        lines: 0,
        fragments: [],
        firstContentLine: null,
        firstContentRaw: null,
        headerLine: line.line,
        headerRaw: line.raw,
        unclassified: line.truncated,
      };
    }
  }

  if (foldedJobName) {
    finishFoldedJobName(
      foldedJobName,
      reserved,
      addMatch,
      addWarning,
      content.length > clipped.length || rawLines.length > MAX_LINES,
    );
  }

  for (const segment of splitScopes(lines)) {
    for (const window of boundedWindows(segment)) {
      inspectWindow(window, reserved, addMatch, addWarning);
    }
  }

  if (matchLimitReached) {
    addWarning("match-limit", 1, `Match output is capped at ${MAX_FINDINGS} entries.`);
  }
  if (warningLimitReached) {
    warnings.push({
      kind: "warning-limit",
      line: 1,
      message: `Warning output is capped at ${MAX_FINDINGS} entries.`,
    });
  }
  const confirmedContextLines = new Set(
    matches
      .filter((finding) => finding.kind.startsWith("reserved-") || finding.kind.endsWith("caller"))
      .map((finding) => finding.line),
  );
  const usefulWarnings = warnings.filter(
    (finding) =>
      !confirmedContextLines.has(finding.line) ||
      !/context|caller/u.test(finding.kind),
  );
  matches.sort((left, right) => left.line - right.line || left.kind.localeCompare(right.kind));
  usefulWarnings.sort((left, right) => left.line - right.line || left.kind.localeCompare(right.kind));
  return { matches, warnings: usefulWarnings };
}

function finishFoldedJobName(foldedJobName, reserved, addMatch, addWarning, inputIncomplete = false) {
  if (foldedJobName.unclassified || inputIncomplete) {
    addWarning(
      "folded-job-name-limit",
      foldedJobName.headerLine,
      `Folded job name could not be fully inspected within the ${MAX_FOLDED_JOB_NAME_LINES}-line or input limits; it was not classified.`,
      foldedJobName.headerRaw,
    );
    return;
  }

  const expression = foldedJobName.fragments.join(" ").trim();
  if (!expression) return;
  const line = foldedJobName.firstContentLine ?? foldedJobName.headerLine;
  const raw = foldedJobName.firstContentRaw ?? foldedJobName.headerRaw;
  if (expression === reserved) {
    addMatch("reserved-job-name", line, raw);
  } else if (isDynamic(expression)) {
    addWarning(
      "dynamic-context-not-confirmed",
      line,
      "A folded job name uses a dynamic value, so the reserved check could not be confirmed.",
      raw,
    );
  }
}

function inspectLineSignals(line, reserved, yamlAnchors, allowYamlAliases, addMatch, addWarning) {
  if (line.flowScanAmbiguous) {
    addWarning(
      "ambiguous-flow-structure",
      line.line,
      `A flow-style jobs or steps collection exceeds the ${MAX_FLOW_COLLECTION_CHARS}-character or ${MAX_FLOW_COLLECTION_DEPTH}-level scan limit, or has unsupported structure; it was not classified.`,
      line.raw,
    );
  }
  const fields =
    line.yamlScalarContent ||
    line.yamlDataField ||
    isRunCommandLine(line.text) ||
    line.continuedCurlCommandPart
      ? []
      : fieldsOnLine(line.text);
  const recognizedUses = [];
  const resolveField = (expression) =>
    allowYamlAliases
      ? resolveYamlScalar(expression, yamlAnchors, line, addWarning)
      : resolveSimpleLiteral(expression, new Map());
  for (const field of fields) {
    if (field.key === "uses") {
      const value = resolveField(field.value);
      if (line.selectorUseStarts?.has(field.start)) {
        recognizedUses.push(field.value);
        if (!addCallerMatch(value, line, addMatch)) {
          warnUnscopedCaller(field.value, value, line, addWarning);
        }
      }
    } else if (isContextField(field.key) || (isNameField(field.key) && line.jobNameField)) {
      if (resolveField(field.value) === reserved) {
        addMatch(field.key.toLowerCase() === "name" ? "reserved-job-name" : "reserved-status-context", line.line, line.raw);
      }
    }
  }
  const flowJobNames = [
    ...(line.flowJobFields?.names ?? []),
    ...(line.inlineJobFields?.names ?? []),
  ];
  for (const field of flowJobNames) {
    if (resolveField(field.value) === reserved) {
      addMatch("reserved-job-name", line.line, line.raw);
    }
  }
  for (const field of [
    ...(line.flowJobFields?.uses ?? []),
    ...(line.inlineJobFields?.uses ?? []),
    ...(line.flowStepUses ?? []),
  ]) {
    recognizedUses.push(field.value);
    const value = resolveField(field.value);
    if (!addCallerMatch(value, line, addMatch)) {
      warnUnscopedCaller(field.value, value, line, addWarning);
    }
  }
  const useExpressions = line.yamlScalarContent || line.yamlDataField
    ? []
    : useFieldExpressions(line.text);
  for (const expression of useExpressions) {
    const recognizedIndex = recognizedUses.indexOf(expression);
    if (recognizedIndex !== -1) {
      recognizedUses.splice(recognizedIndex, 1);
      continue;
    }
    const value = resolveField(expression);
    warnUnscopedCaller(expression, value, line, addWarning);
  }
  const cliContext = cliContextExpression(line.text);
  if (cliContext && resolveSimpleLiteral(cliContext, new Map()) === reserved) {
    addMatch("reserved-status-context", line.line, line.raw);
  }
  const cliCheckRunName = cliCheckRunNameExpression(line.text);
  if (cliCheckRunName && resolveSimpleLiteral(cliCheckRunName, new Map()) === reserved) {
    addMatch("reserved-check-run-name", line.line, line.raw);
  }
  const curlSignal = line.continuedCurlCommandPart
    ? null
    : curlPublisherSignal(line.text, reserved);
  if (curlSignal) addMatch(curlSignal.kind, line.line, line.raw);
  const exactFieldHandled = fields.some(
    (field) =>
      (isContextField(field.key) || (isNameField(field.key) && line.jobNameField)) &&
      resolveField(field.value) === reserved,
  ) || flowJobNames.some((field) => resolveField(field.value) === reserved);
  const exactCliHandled =
    (cliContext !== null && resolveSimpleLiteral(cliContext, new Map()) === reserved) ||
    (cliCheckRunName !== null && resolveSimpleLiteral(cliCheckRunName, new Map()) === reserved) ||
    curlSignal !== null;
  if (
    hasExactToken(line.text, reserved) &&
    !exactFieldHandled &&
    !exactCliHandled
  ) {
    addWarning(
      "reserved-status-context-reference",
      line.line,
      "The reserved name appears outside a recognized publishing-like field or workflow job name; this text scan cannot confirm a status publisher.",
      line.raw,
    );
  }
}

function inspectWindow(window, reserved, addMatch, addWarning) {
  const literals = new Map();
  for (const line of window) {
    if (
      !line.yamlScalarContent &&
      !line.yamlDataField &&
      !isRunCommandLine(line.text) &&
      !line.continuedCurlCommandPart
    ) {
      for (const field of fieldsOnLine(line.text)) {
        if (field.key === "uses") {
          if (line.selectorUseStarts?.has(field.start)) {
            inspectCaller(field.value, literals, line, addMatch, addWarning);
          }
          continue;
        }
        if (isContextField(field.key) || (isNameField(field.key) && line.jobNameField)) {
          inspectContext(field.key, field.value, literals, line, reserved, addMatch, addWarning);
        }
      }
    }
    for (const field of [
      ...(line.flowJobFields?.names ?? []),
      ...(line.inlineJobFields?.names ?? []),
    ]) {
      inspectContext("name", field.value, literals, line, reserved, addMatch, addWarning);
    }
    for (const field of [
      ...(line.flowJobFields?.uses ?? []),
      ...(line.inlineJobFields?.uses ?? []),
      ...(line.flowStepUses ?? []),
    ]) {
      inspectCaller(field.value, literals, line, addMatch, addWarning);
    }
    const cliContext = cliContextExpression(line.text);
    if (cliContext) {
      inspectContext("context", cliContext, literals, line, reserved, addMatch, addWarning);
    }
    const cliCheckRunName = cliCheckRunNameExpression(line.text);
    if (cliCheckRunName) {
      inspectContext("check-run-name", cliCheckRunName, literals, line, reserved, addMatch, addWarning);
    }
    const curlSignal = line.continuedCurlCommandPart
      ? null
      : curlPublisherSignal(line.text, reserved);
    if (curlSignal) {
      inspectContext(curlSignal.field, curlSignal.expression, literals, line, reserved, addMatch, addWarning);
    }

    for (const statement of splitStatements(line.text)) {
      const assignment = statement.match(
        /^(?:(?:const|let|var)\s+)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u,
      );
      if (!assignment) continue;
      const [, name, expression] = assignment;
      const value = resolveSimpleLiteral(expression, literals);
      if (value === null) {
        literals.delete(name);
        if (isContextField(name) && isAmbiguous(expression, literals, reserved, value)) {
          addWarning(
            isDynamic(expression) ? "dynamic-context-not-confirmed" : "ambiguous-reserved-context",
            line.line,
            "A context-like variable may be assembled from reserved-name fragments, but literal composition could not be confirmed.",
            line.raw,
          );
        }
        continue;
      }
      literals.set(name, value);
      if (isContextField(name)) {
        if (value === reserved) {
          addMatch("reserved-status-context", line.line, line.raw);
        } else if (isAmbiguous(expression, literals, reserved, value)) {
          addWarning(
            "ambiguous-reserved-context",
            line.line,
            "A context-like variable contains reserved-name fragments, but does not confirm the full literal name.",
            line.raw,
          );
        }
      }
    }
  }
}

function inspectContext(key, expression, literals, line, reserved, addMatch, addWarning) {
  const value = resolveSimpleLiteral(expression, literals);
  if (value === reserved) {
    const normalized = key.toLowerCase();
    addMatch(
      normalized === "name"
        ? "reserved-job-name"
        : normalized === "check-run-name"
          ? "reserved-check-run-name"
          : "reserved-status-context",
      line.line,
      line.raw,
    );
    return;
  }
  if (isDynamic(expression) || isAmbiguous(expression, literals, reserved, value)) {
    addWarning(
      isDynamic(expression) ? "dynamic-context-not-confirmed" : "ambiguous-reserved-context",
      line.line,
      isDynamic(expression)
        ? "A context-like field is dynamic and cannot be confirmed by this literal-only scan."
        : "A context-like field contains reserved-name fragments, but literal composition could not be confirmed.",
      line.raw,
    );
  }
}

function inspectCaller(expression, literals, line, addMatch, addWarning) {
  const value = resolveSimpleLiteral(stripYamlAnchor(expression), literals);
  if (
    !addCallerMatch(value, line, addMatch) &&
    looksLikeGateCaller(`${expression} ${value ?? ""}`)
  ) {
    addWarning(
      "ambiguous-codex-review-gate-caller",
      line.line,
      "A uses selector may refer to a Codex review gate caller, but literal composition could not be confirmed.",
      line.raw,
    );
  }
}

function warnUnscopedCaller(expression, value, line, addWarning) {
  if (!looksLikeGateCaller(`${expression} ${value ?? ""}`)) return;
  addWarning(
    "ambiguous-codex-review-gate-caller",
    line.line,
    "A uses-like field resembles a Codex review gate caller, but its job or step selector scope could not be confirmed.",
    line.raw,
  );
}

function looksLikeGateCaller(value) {
  return /codex-review-gate-action|Joey-Tools\/codex-review-gate|JoeyTeng/iu.test(value);
}

function addCallerMatch(value, line, addMatch) {
  if (!value || !ACTION_CALLERS.some((pattern) => pattern.test(value))) return false;
  const kind = value.startsWith("Joey-Tools/")
    ? "legacy-codex-review-gate-caller"
    : "codex-review-gate-action-caller";
  addMatch(kind, line.line, line.raw);
  return true;
}

function indentationOf(text) {
  return text.match(/^\s*/u)?.[0].length ?? 0;
}

function fieldsOnLine(text) {
  const fields = [];
  const pattern = /(?:^|[,{])\s*(?:-\s*)?["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*:\s*([^,}\n]*)/gu;
  for (const match of text.matchAll(pattern)) {
    const key = match[1];
    const value = match[2].trim();
    const start = match.index + match[0].indexOf(key);
    if (key.toLowerCase() === "uses" || isContextField(key) || isNameField(key)) {
      fields.push({ key, value, start });
    }
  }
  return fields;
}

function useFieldExpressions(text) {
  const pattern = /(?:^|[,{])\s*(?:-\s*)?(?:"uses"|'uses'|uses)\s*:\s*([^,}\n]*)/gu;
  return [...text.matchAll(pattern)].map((match) => match[1].trim());
}

function cliContextExpression(text) {
  const command = runCommand(text);
  if (!/^gh\s+api(?:\s|$)/iu.test(command)) return null;
  if (!/\/(?:statuses\/[^/?#\s]+|check-runs)(?:[/?#\s]|$)/iu.test(command)) return null;
  if (hasExplicitReadOnlyGitHubApiMethod(command)) return null;
  return cliFieldExpression(command, "context");
}

function hasExplicitReadOnlyGitHubApiMethod(command) {
  const method = command.match(/(?:^|\s)(?:-X|--method)(?:=|\s+)([A-Za-z]+)/iu);
  return method !== null && ["GET", "HEAD"].includes(method[1].toUpperCase());
}

function cliCheckRunNameExpression(text) {
  const command = runCommand(text);
  if (!/^gh\s+api(?:\s|$)/iu.test(command) || !/\/check-runs(?:[/?#\s]|$)/iu.test(command)) return null;
  if (hasExplicitReadOnlyGitHubApiMethod(command)) return null;
  return cliFieldExpression(command, "name");
}

function curlPublisherSignal(text, reserved) {
  const command = runCommand(text);
  if (!/^curl(?:\s|$)/iu.test(command)) return null;
  if (hasShellLineContinuation(command)) return null;

  const dataOption = /(?:^|\s)(?:-d|--data(?:-raw|-binary|-urlencode)?|--json)(?:\s+|=)(?:"([^"]*)"|'([^']*)'|([^\s]+))/giu;
  const dataMatches = [...command.matchAll(dataOption)];
  if (!dataMatches.length) return null;
  const withoutData = command.replace(dataOption, " ");
  const checkRunsEndpoint = /https?:\/\/[^/\s"']+\/repos\/[^/\s"']+\/[^/\s"']+\/check-runs(?:[/?#\s"']|$)/iu.test(withoutData);
  const statusesEndpoint = /https?:\/\/[^/\s"']+\/repos\/[^/\s"']+\/[^/\s"']+\/statuses\/[^/?#\s"']+(?:[/?#\s"']|$)/iu.test(withoutData);
  if (
    /[;&|]/u.test(withoutData) ||
    !/(?:^|\s)(?:-X\s*|--request(?:=|\s+))POST(?:\s|$)/iu.test(withoutData) ||
    (!checkRunsEndpoint && !statusesEndpoint)
  ) {
    return null;
  }

  for (const match of dataMatches) {
    const payload = match[1] ?? match[2] ?? match[3] ?? "";
    if (checkRunsEndpoint) {
      const name = jsonStringField(payload, "name");
      if (name === reserved) {
        return { kind: "reserved-check-run-name", field: "check-run-name", expression: JSON.stringify(name) };
      }
    }
    if (statusesEndpoint) {
      const context = jsonStringField(payload, "context");
      if (context === reserved) {
        return { kind: "reserved-status-context", field: "context", expression: JSON.stringify(context) };
      }
    }
  }
  return null;
}

function jsonStringField(payload, key) {
  const field = payload.match(new RegExp(`(?:^|[,{])\\s*["']${key}["']\\s*:\\s*(?:"([^"\\\\]*)"|'([^'\\\\]*)')`, "iu"));
  return field ? field[1] ?? field[2] : null;
}

function inspectCurlContinuationBlocks(lines, reserved, addMatch, addWarning) {
  let runBlockIndent = null;
  let runBlockHeaderChars = 0;
  let previousContinues = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.yamlScalarContent && isYamlDocumentBoundary(line.text)) {
      runBlockIndent = null;
      runBlockHeaderChars = 0;
      previousContinues = false;
      index += 1;
      continue;
    }
    const runHeader = line.text.match(/^\s*(?:-\s*)?run\s*:\s*(.*)$/iu);
    if (runHeader) {
      runBlockIndent = isBlockScalarIndicator(stripYamlAnchor(runHeader[1].trim()))
        ? indentationOf(line.text)
        : null;
      runBlockHeaderChars = runBlockIndent === null ? 0 : line.text.length + 1;
      previousContinues = false;
      index += 1;
      continue;
    }
    if (runBlockIndent === null) {
      index += 1;
      continue;
    }
    if (!line.text.trim()) {
      previousContinues = false;
      index += 1;
      continue;
    }
    if (indentationOf(line.text) <= runBlockIndent) {
      runBlockIndent = null;
      runBlockHeaderChars = 0;
      previousContinues = false;
      index += 1;
      continue;
    }

    const initialCommand = line.text.trim();
    if (previousContinues) line.continuedCurlCommandPart = true;
    if (
      previousContinues ||
      !/^curl(?:\s|$)/iu.test(initialCommand) ||
      !hasShellLineContinuation(initialCommand)
    ) {
      previousContinues = hasShellLineContinuation(initialCommand);
      index += 1;
      continue;
    }

    const firstLine = line;
    const chunks = [];
    let totalChars = runBlockHeaderChars;
    let consumed = 1;
    let current = index;
    let complete = false;
    let exceeded = false;
    while (current < lines.length) {
      const physical = lines[current];
      if (
        isYamlDocumentBoundary(physical.text) ||
        !physical.text.trim() ||
        indentationOf(physical.text) <= runBlockIndent
      ) {
        break;
      }
      const part = physical.text.trim();
      physical.continuedCurlCommandPart = true;
      const continuation = hasShellLineContinuation(part);
      const chunk = continuation ? part.replace(/\\\s*$/u, "").trimEnd() : part;
      consumed += 1;
      totalChars += chunk.length + (chunks.length ? 1 : 0);
      if (consumed > MAX_WINDOW_LINES || totalChars > MAX_WINDOW_CHARS) {
        exceeded = true;
        break;
      }
      chunks.push(chunk);
      if (!continuation) {
        complete = true;
        current += 1;
        break;
      }
      current += 1;
    }

    if (exceeded) {
      addWarning(
        "continued-curl-command-limit",
        firstLine.line,
        `A continued curl command exceeds the ${MAX_WINDOW_LINES}-line or ${MAX_WINDOW_CHARS}-character scan limit and was not joined.`,
        firstLine.raw,
      );
      previousContinues = false;
      index = Math.max(index + 1, current + 1);
      continue;
    }
    if (!complete) {
      addWarning(
        "continued-curl-command-unclosed",
        firstLine.line,
        "A continued curl command ended before a bounded completion could be confirmed.",
        firstLine.raw,
      );
      previousContinues = false;
      index = Math.max(index + 1, current);
      continue;
    }

    const signal = curlPublisherSignal(chunks.join(" "), reserved);
    if (signal) addMatch(signal.kind, firstLine.line, firstLine.raw);
    previousContinues = false;
    index = current;
  }
}

function hasShellLineContinuation(value) {
  const trailingSlashes = value.match(/\\+\s*$/u)?.[0].trimEnd().length ?? 0;
  return trailingSlashes % 2 === 1;
}

function runCommand(text) {
  return text.match(/^\s*(?:-\s*)?run\s*:\s*(.*)$/iu)?.[1]?.trim() ?? text.trim();
}

function cliFieldExpression(text, field) {
  const wholeField = text.match(
    new RegExp(`(?:^|\\s)(?:-f|--field|--raw-field)(?:\\s+|=)\\s*(['"])${field}=([^'"]*)\\1`, "iu"),
  );
  if (wholeField) return `${wholeField[1]}${wholeField[2]}${wholeField[1]}`;
  const fieldValue = text.match(
    new RegExp(
      `(?:^|\\s)(?:-f|--field|--raw-field)(?:\\s+|=)\\s*${field}=(?:"([^"]*)"|'([^']*)'|([^\\s'"]+))`,
      "iu",
    ),
  );
  if (!fieldValue) return null;
  if (fieldValue[1] !== undefined) return `"${fieldValue[1]}"`;
  if (fieldValue[2] !== undefined) return `'${fieldValue[2]}'`;
  return fieldValue[3];
}

function isContextField(key) {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("context") ||
    /(?:^|[-_])check[-_]?name$/u.test(normalized) ||
    normalized === "checkname"
  );
}

function isNameField(key) {
  return key.toLowerCase() === "name";
}

function markYamlJobNameFields(lines) {
  markYamlDataAndScalarFields(lines);
  let jobsIndent = null;
  let jobIndent = null;
  let jobPropertyIndent = null;
  let stepsIndent = null;
  let stepIndent = null;
  let stepPropertyIndent = null;
  for (const line of lines) {
    if (!line.yamlScalarContent && isYamlDocumentBoundary(line.text)) {
      jobsIndent = null;
      jobIndent = null;
      jobPropertyIndent = null;
      stepsIndent = null;
      stepIndent = null;
      stepPropertyIndent = null;
      continue;
    }
    if (!line.text.trim()) continue;
    if (line.yamlScalarContent) continue;
    line.flowJobFields = line.yamlDataField
      ? { names: [], uses: [], steps: [], ambiguous: false }
      : flowStyleJobFields(line.text);
    line.flowStepUses = line.flowJobFields.steps;
    line.flowScanAmbiguous = line.flowJobFields.ambiguous;
    const indent = indentationOf(line.text);
    const text = line.text.trim();
    const key = line.yamlDataField ? null : simpleYamlKey(text);
    if (key?.toLowerCase() === "jobs" && /^\s*$/u.test(text.slice(text.indexOf(":") + 1))) {
      jobsIndent = indent;
      jobIndent = null;
      jobPropertyIndent = null;
      stepsIndent = null;
      stepIndent = null;
      stepPropertyIndent = null;
      continue;
    }
    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      jobPropertyIndent = null;
      stepsIndent = null;
      stepIndent = null;
      stepPropertyIndent = null;
      continue;
    }
    if (jobIndent === null || indent === jobIndent) {
      if (key !== null) {
        jobIndent = indent;
        jobPropertyIndent = null;
        stepsIndent = null;
        stepIndent = null;
        stepPropertyIndent = null;
        line.inlineJobFields = simpleInlineJobFields(text.slice(text.indexOf(":") + 1));
        line.flowScanAmbiguous ||= line.inlineJobFields.ambiguous;
        line.flowStepUses = [...line.flowStepUses, ...line.inlineJobFields.steps];
      }
      continue;
    }
    if (jobPropertyIndent === null) jobPropertyIndent = indent;
    if (indent === jobPropertyIndent) {
      if (key?.toLowerCase() === "name") line.jobNameField = true;
      if (key?.toLowerCase() === "uses") {
        markSelectorUse(line);
      }
      if (key?.toLowerCase() === "steps") {
        const flowSteps = simpleFlowStepUses(text.slice(text.indexOf(":") + 1));
        line.flowStepUses = flowSteps.uses;
        line.flowScanAmbiguous ||= flowSteps.ambiguous;
        stepsIndent = indent;
        stepIndent = null;
        stepPropertyIndent = null;
      } else if (stepsIndent !== null) {
        stepsIndent = null;
        stepIndent = null;
        stepPropertyIndent = null;
      }
      continue;
    }
    if (stepsIndent === null) continue;
    if (indent <= stepsIndent) {
      stepsIndent = null;
      stepIndent = null;
      stepPropertyIndent = null;
      continue;
    }
    if (/^\s*-\s+/u.test(line.text)) {
      stepIndent = indent;
      stepPropertyIndent = null;
      if (key?.toLowerCase() === "uses") {
        markSelectorUse(line);
      }
      continue;
    }
    if (stepIndent !== null && indent > stepIndent) {
      if (stepPropertyIndent === null) stepPropertyIndent = indent;
      if (indent === stepPropertyIndent && key?.toLowerCase() === "uses") {
        markSelectorUse(line);
      }
    }
  }
}

function markSelectorUse(line) {
  if (line.yamlDataField || line.yamlScalarContent) return;
  const field = fieldsOnLine(line.text).find(
    (candidate) =>
      candidate.key.toLowerCase() === "uses" &&
      /^\s*(?:-\s*)?["']?$/u.test(line.text.slice(0, candidate.start)),
  );
  if (!field) return;
  line.selectorUseStarts ??= new Set();
  line.selectorUseStarts.add(field.start);
}

function markYamlDataAndScalarFields(lines) {
  let scalarKeyIndent = null;
  const dataMappingIndents = [];
  const workflow = {
    jobsIndent: null,
    jobIndent: null,
    jobPropertyIndent: null,
    stepsIndent: null,
    stepIndent: null,
    stepPropertyIndent: null,
  };
  for (const line of lines) {
    if (
      isYamlDocumentBoundary(line.text) &&
      (scalarKeyIndent === null || indentationOf(line.text) <= scalarKeyIndent)
    ) {
      scalarKeyIndent = null;
      dataMappingIndents.length = 0;
      resetWorkflowYamlScope(workflow);
      continue;
    }
    if (!line.text.trim()) continue;

    const mapping = simpleYamlMapping(line.text);
    if (scalarKeyIndent !== null) {
      if (mapping && mapping.indent <= scalarKeyIndent) {
        scalarKeyIndent = null;
      } else {
        line.yamlScalarContent = true;
        continue;
      }
    }

    const fieldIndent = mapping?.indent ?? indentationOf(line.text);
    while (dataMappingIndents.length && dataMappingIndents.at(-1) >= fieldIndent) {
      dataMappingIndents.pop();
    }
    line.yamlDataField = dataMappingIndents.length > 0;

    if (
      !line.yamlDataField &&
      mapping &&
      /^(?:env|with|outputs)$/iu.test(mapping.key) &&
      !mapping.value.trim() &&
      isWorkflowYamlProperty(line, mapping, workflow)
    ) {
      dataMappingIndents.push(mapping.indent);
    } else if (!line.yamlDataField) {
      isWorkflowYamlProperty(line, mapping, workflow);
    }
    if (mapping && isBlockScalarIndicator(stripYamlAnchor(mapping.value))) {
      scalarKeyIndent = mapping.indent;
    }
  }
}

function isWorkflowYamlProperty(line, mapping, scope) {
  const indent = indentationOf(line.text);
  const key = mapping?.key.toLowerCase() ?? null;
  if (key === "jobs" && !mapping.value.trim()) {
    scope.jobsIndent = indent;
    scope.jobIndent = null;
    scope.jobPropertyIndent = null;
    scope.stepsIndent = null;
    scope.stepIndent = null;
    scope.stepPropertyIndent = null;
    return false;
  }
  if (scope.jobsIndent === null) return indent === 0;
  if (indent <= scope.jobsIndent) {
    resetWorkflowYamlScope(scope);
    return indent === 0;
  }
  if (scope.jobIndent === null || indent === scope.jobIndent) {
    if (mapping) {
      scope.jobIndent = indent;
      scope.jobPropertyIndent = null;
      scope.stepsIndent = null;
      scope.stepIndent = null;
      scope.stepPropertyIndent = null;
    }
    return false;
  }
  if (scope.jobPropertyIndent === null) scope.jobPropertyIndent = indent;
  if (indent === scope.jobPropertyIndent) {
    if (key === "steps") {
      scope.stepsIndent = indent;
      scope.stepIndent = null;
      scope.stepPropertyIndent = null;
    } else if (scope.stepsIndent !== null) {
      scope.stepsIndent = null;
      scope.stepIndent = null;
      scope.stepPropertyIndent = null;
    }
    return true;
  }
  if (scope.stepsIndent === null) return false;
  if (indent <= scope.stepsIndent) {
    scope.stepsIndent = null;
    scope.stepIndent = null;
    scope.stepPropertyIndent = null;
    return false;
  }
  if (/^\s*-\s+/u.test(line.text)) {
    scope.stepIndent = indent;
    scope.stepPropertyIndent = null;
    return true;
  }
  if (scope.stepIndent !== null && indent > scope.stepIndent) {
    if (scope.stepPropertyIndent === null) scope.stepPropertyIndent = indent;
    return indent === scope.stepPropertyIndent;
  }
  return false;
}

function resetWorkflowYamlScope(scope) {
  scope.jobsIndent = null;
  scope.jobIndent = null;
  scope.jobPropertyIndent = null;
  scope.stepsIndent = null;
  scope.stepIndent = null;
  scope.stepPropertyIndent = null;
}

function simpleYamlMapping(text) {
  const match = text.match(/^\s*(?:-\s+)?(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*:\s*(.*)$/u);
  if (!match) return null;
  const key = simpleYamlKey(text.trimStart());
  if (key === null) return null;
  const prefix = text.match(/^\s*(?:-\s+)?/u)?.[0] ?? "";
  return { key, value: match[1], indent: prefix.length };
}

function simpleYamlKey(text) {
  const normalized = text.replace(/^\s*-\s+/u, "");
  const match = normalized.match(/^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*:/u);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function flowStyleJobFields(text) {
  const result = { names: [], uses: [], steps: [], ambiguous: false };
  const root = parseFlowMap(text);
  if (root.ambiguous) {
    result.ambiguous = /\bjobs\b/iu.test(text);
    return result;
  }
  const jobs = root.entries.find((field) => field.key.toLowerCase() === "jobs");
  if (!jobs) return result;

  const jobEntries = parseFlowMap(jobs.value);
  if (jobEntries.ambiguous) {
    result.ambiguous = true;
    return result;
  }
  for (const job of jobEntries.entries) {
    const fields = parseFlowMap(job.value);
    if (fields.ambiguous) {
      result.ambiguous = true;
      continue;
    }
    for (const field of fields.entries) {
      if (isNameField(field.key)) result.names.push(field);
      if (field.key.toLowerCase() === "uses") result.uses.push(field);
      if (field.key.toLowerCase() === "steps") {
        const steps = simpleFlowStepUses(field.value);
        result.steps.push(...steps.uses);
        result.ambiguous ||= steps.ambiguous;
      }
    }
  }
  return result;
}

function simpleInlineJobFields(value) {
  const result = { names: [], uses: [], steps: [], ambiguous: false };
  const fields = parseFlowMap(value);
  if (fields.ambiguous) {
    result.ambiguous = true;
    return result;
  }
  for (const field of fields.entries) {
    if (isNameField(field.key)) result.names.push(field);
    if (field.key.toLowerCase() === "uses") result.uses.push(field);
    if (field.key.toLowerCase() === "steps") {
      const steps = simpleFlowStepUses(field.value);
      result.steps = steps.uses;
      result.ambiguous ||= steps.ambiguous;
    }
  }
  return result;
}

function simpleFlowStepUses(value) {
  const collection = unwrapFlowCollection(value, "[");
  if (!collection.present) return { uses: [], ambiguous: false };
  if (collection.ambiguous) return { uses: [], ambiguous: true };
  const items = splitFlowParts(collection.body);
  if (!items) return { uses: [], ambiguous: true };
  const uses = [];
  for (const item of items) {
    if (!item.trim().startsWith("{")) continue;
    const fields = parseFlowMap(item);
    if (fields.ambiguous) return { uses: [], ambiguous: true };
    for (const field of fields.entries) {
      if (field.key.toLowerCase() === "uses") uses.push(field);
    }
  }
  return { uses, ambiguous: false };
}

function parseFlowMap(value) {
  const source = value.trim();
  if (source.length > MAX_FLOW_COLLECTION_CHARS) return { entries: [], ambiguous: true };
  const collection = unwrapFlowCollection(source, "{");
  if (collection.ambiguous) return { entries: [], ambiguous: true };
  const body = collection.present ? collection.body : source;
  const parts = splitFlowParts(body);
  if (!parts) return { entries: [], ambiguous: true };

  const entries = [];
  for (const part of parts) {
    const colon = findFlowColon(part);
    if (colon <= 0) continue;
    const key = parseFlowKey(part.slice(0, colon));
    if (key !== null) entries.push({ key, value: part.slice(colon + 1).trim() });
  }
  return { entries, ambiguous: false };
}

function unwrapFlowCollection(value, opener) {
  const source = value.trim();
  if (!source.startsWith(opener)) return { present: false, body: source, ambiguous: false };
  if (source.length > MAX_FLOW_COLLECTION_CHARS) return { present: true, body: "", ambiguous: true };

  const stack = [];
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (quote === '"' && character === "\\") escaped = true;
      else if (character === quote) {
        if (quote === "'" && source[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      if (stack.length > MAX_FLOW_COLLECTION_DEPTH) return { present: true, body: "", ambiguous: true };
    } else if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) return { present: true, body: "", ambiguous: true };
      if (stack.length === 0) {
        if (character !== (opener === "{" ? "}" : "]") || source.slice(index + 1).trim()) {
          return { present: true, body: "", ambiguous: true };
        }
        return { present: true, body: source.slice(1, index), ambiguous: false };
      }
    }
  }
  return { present: true, body: "", ambiguous: true };
}

function splitFlowParts(value) {
  const parts = [];
  const stack = [];
  let quote = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (quote === '"' && character === "\\") escaped = true;
      else if (character === quote) {
        if (quote === "'" && value[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "{" || character === "[") {
      stack.push(character);
      if (stack.length > MAX_FLOW_COLLECTION_DEPTH) return null;
    } else if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) return null;
    } else if (character === "," && stack.length === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quote !== null || stack.length > 0) return null;
  parts.push(value.slice(start));
  return parts;
}

function findFlowColon(value) {
  const stack = [];
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (quote === '"' && character === "\\") escaped = true;
      else if (character === quote) {
        if (quote === "'" && value[index + 1] === "'") index += 1;
        else quote = null;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "{" || character === "[") {
      stack.push(character);
    } else if (character === "}" || character === "]") {
      stack.pop();
    } else if (character === ":" && stack.length === 0) {
      return index;
    }
  }
  return -1;
}

function parseFlowKey(value) {
  const key = value.trim();
  if (
    key.length >= 2 &&
    ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))
  ) {
    const inner = key.slice(1, -1);
    return inner.includes("\\") ? null : inner;
  }
  return /^[A-Za-z0-9_.-]+$/u.test(key) ? key : null;
}

function stripYamlAnchor(value) {
  return value.replace(/^&[A-Za-z_][A-Za-z0-9_-]*\s+/u, "");
}

function isYamlDocumentBoundary(text) {
  return /^\s*(?:---|\.\.\.)\s*$/u.test(text);
}

function isRunCommandLine(text) {
  return /^\s*(?:-\s*)?run\s*:/iu.test(text);
}

function registerYamlScalarAnchors(line, anchors, addWarning) {
  const pattern = /(?:^|[,{])\s*(?:-\s*)?(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*:\s*&([A-Za-z_][A-Za-z0-9_-]*)\s+("[^"]*"|'[^']*'|[^,}\]\n]+)/gu;
  for (const match of line.text.matchAll(pattern)) {
    const [, name, rawValue] = match;
    const expression = rawValue.trim();
    if (isBlockScalarIndicator(expression)) {
      anchors.delete(name);
      addWarning(
        "complex-yaml-scalar-anchor",
        line.line,
        "A folded YAML anchor value is not resolved by this bounded scalar scan.",
        line.raw,
      );
      continue;
    }
    const value = literalAtom(expression, new Map());
    if (expression.length > MAX_YAML_ANCHOR_VALUE_CHARS || value === null || value.length > MAX_YAML_ANCHOR_VALUE_CHARS) {
      anchors.delete(name);
      addWarning(
        "complex-yaml-scalar-anchor",
        line.line,
        "A YAML anchor value is not a bounded simple scalar and was not resolved.",
        line.raw,
      );
      continue;
    }
    if (!anchors.has(name) && anchors.size >= MAX_YAML_SCALAR_ANCHORS) {
      addWarning(
        "yaml-scalar-anchor-limit",
        line.line,
        `YAML scalar anchor tracking is capped at ${MAX_YAML_SCALAR_ANCHORS} entries for this document.`,
        line.raw,
      );
      continue;
    }
    anchors.set(name, value);
  }
}

function resolveYamlScalar(expression, anchors, line, addWarning) {
  const value = stripYamlAnchor(expression).trim();
  if (!value.startsWith("*")) return resolveSimpleLiteral(value, new Map());

  const alias = value.match(/^\*([A-Za-z_][A-Za-z0-9_-]*)$/u);
  if (alias && anchors.has(alias[1])) return anchors.get(alias[1]);
  addWarning(
    alias ? "unknown-yaml-scalar-alias" : "complex-yaml-scalar-alias",
    line.line,
    alias
      ? "A YAML scalar alias is unknown within this bounded document scan."
      : "A complex YAML alias expression was not resolved by this bounded scan.",
    line.raw,
  );
  return null;
}

function isBlockScalarIndicator(value) {
  return /^[>|](?:[+-]?[1-9]?|[1-9]?[+-]?)\s*$/u.test(value);
}

function resolveSimpleLiteral(expression, literals) {
  const value = expression.trim().replace(/[;,]\s*$/u, "").trim();
  if (!value || value.length > MAX_WINDOW_CHARS) return null;

  const concatenation = splitPlusExpression(value);
  if (concatenation) {
    let result = "";
    for (const part of concatenation) {
      const resolved = literalAtom(part, literals, false);
      if (resolved === null) return null;
      result += resolved;
      if (result.length > 512) return null;
    }
    return result;
  }
  return literalAtom(value, literals);
}

function literalAtom(value, literals, allowBare = true) {
  const token = value.trim();
  if (literals.has(token)) return literals.get(token);
  if (token.length >= 2 && token[0] === token.at(-1) && (token[0] === "'" || token[0] === '"')) {
    const inner = token.slice(1, -1);
    if (inner.includes("\\")) return null;
    return token[0] === '"' ? expandShellVariables(inner, literals) : inner;
  }
  if (allowBare && /^[A-Za-z0-9_./:@-]+$/u.test(token)) return token;
  return null;
}

function splitPlusExpression(expression) {
  const parts = [];
  let quote = null;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "+") {
      parts.push(expression.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (parts.length === 0) return null;
  parts.push(expression.slice(start).trim());
  return parts.some((part) => !part) ? null : parts;
}

function expandShellVariables(value, literals) {
  let unresolved = false;
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/gu, (_match, braced, plain) => {
    const name = braced ?? plain;
    if (!literals.has(name)) {
      unresolved = true;
      return "";
    }
    return literals.get(name);
  });
  return unresolved || expanded.includes("$") ? null : expanded;
}

function splitStatements(line) {
  let text = line.trim();
  const run = text.match(/^(?:-\s*)?run\s*:\s*(.*)$/iu);
  if (run) text = run[1].trim();
  if (!text || /^(?:[>|][+-]?[1-9]?\s*)$/u.test(text)) return [];
  return text.split(";").map((statement) => statement.trim()).filter(Boolean);
}

function isAmbiguous(expression, literals, reserved, resolved = null) {
  if (resolved !== null) return false;
  const knownText = [...literals.values()].join(" ");
  const evidence = `${expression} ${knownText}`.toLowerCase();
  const fragments = ["codex", "github", "review", "gate"].filter((part) =>
    new RegExp(`(?:^|[^a-z0-9])${part}(?:$|[^a-z0-9])`, "u").test(evidence),
  );
  return (
    fragments.length >= 2 ||
    (isDynamic(expression) && fragments.includes("codex")) ||
    (expression.includes("+") && fragments.length >= 1)
  );
}

function hasExactToken(text, reserved) {
  const escaped = reserved.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_.-])${escaped}(?:$|[^A-Za-z0-9_.-])`, "u").test(text);
}

function isDynamic(expression) {
  return /\$\{\{|\$\{?[A-Za-z_][A-Za-z0-9_.]*\}?/u.test(expression);
}

function splitScopes(lines) {
  const scopes = [];
  let scope = [];
  for (const line of lines) {
    if (scope.length && isScopeBoundary(line.text)) {
      scopes.push(scope);
      scope = [];
    }
    scope.push(line);
  }
  if (scope.length) scopes.push(scope);
  return scopes;
}

function isScopeBoundary(text) {
  return (
    /^\s*---\s*$/u.test(text) ||
    /^\S[A-Za-z0-9_-]*:\s*$/u.test(text) ||
    /^ {2}[A-Za-z0-9_-]+:\s*$/u.test(text) ||
    /^\s{4,}-\s+(?:name|uses|run|id)\s*:/iu.test(text)
  );
}

function boundedWindows(scope) {
  const windows = [];
  const stride = Math.floor(MAX_WINDOW_LINES / 2);
  for (let start = 0; start < scope.length; start += stride) {
    const window = [];
    let length = 0;
    for (let index = start; index < scope.length && window.length < MAX_WINDOW_LINES; index += 1) {
      const line = scope[index];
      const remaining = MAX_WINDOW_CHARS - length;
      if (remaining <= 0) break;
      window.push(line.text.length > remaining ? { ...line, text: line.text.slice(0, remaining) } : line);
      length += Math.min(line.text.length, remaining) + 1;
      if (line.text.length > remaining) break;
    }
    if (window.length) windows.push(window);
    if (start + window.length >= scope.length) break;
  }
  return windows;
}

function stripComments(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\" && quote !== null) {
      escaped = true;
    } else if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (
      (character === "#" || (character === "/" && value[index + 1] === "/")) &&
      (index === 0 || /\s/u.test(value[index - 1]))
    ) {
      return value.slice(0, index);
    }
  }
  return value;
}

function safeExcerpt(value) {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~-]+/giu, "$1[redacted]")
    .replace(/((?:token|secret|password|authorization|api[_-]?key)\s*[:=]\s*)([^\s,}]+)/giu, "$1[redacted]")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, 160);
}
