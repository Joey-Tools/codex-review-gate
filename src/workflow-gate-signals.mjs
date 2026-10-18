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
  { reservedCheckName = DEFAULT_RESERVED_CHECK_NAME, repositoryFullName } = {},
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
  const inputTruncated = content.length > clipped.length || rawLines.length > MAX_LINES;
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
      truncated:
        raw.length > MAX_LINE_CHARS ||
        (content.length > clipped.length && index === rawLines.length - 1),
    };
  });
  // GH_HOST can redirect implicit-host gh api commands; do not infer its value or shell data flow.
  const implicitCliHostUncertain = lines.some((line) => line.raw.includes("GH_HOST"));
  if (implicitCliHostUncertain) {
    addWarning(
      "cli-host-override-unclassified",
      1,
      "The bounded source mentions GH_HOST; implicit-host GitHub CLI API requests were left unclassified.",
    );
  }
  markYamlJobNameFields(lines);
  markUnknownRunBlocks(lines, reserved, addWarning);
  inspectCurlContinuationBlocks(lines, reserved, addMatch, addWarning, repositoryFullName);

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
    if (line.unclassifiedRunBlock) continue;
    if (line.truncated) {
      yamlAnchors.clear();
      if (foldedJobName) foldedJobName.unclassified = true;
      if (foldedUses) foldedUses = null;
      continue;
    }
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
        if (foldedJobName.firstContentLine === null) foldedJobName.leadingBlank = true;
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
      repositoryFullName,
      implicitCliHostUncertain,
    );
    const yamlFields = line.yamlScalarContent || line.yamlDataField ? [] : fieldsOutsideFlowData(line);
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
      if (!isStripChompBlockScalar(indicator)) {
        addWarning(
          "folded-job-name-unclassified",
          line.line,
          "A job name uses a block scalar without explicit strip chomping and was not classified by the bounded text scan.",
          line.raw,
        );
        continue;
      }
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
        leadingBlank: false,
      };
    }
  }

  if (foldedJobName) {
    finishFoldedJobName(
      foldedJobName,
      reserved,
      addMatch,
      addWarning,
      inputTruncated,
    );
  }

  for (const segment of splitScopes(lines)) {
    for (const window of boundedWindows(segment)) {
      inspectWindow(window, reserved, addMatch, addWarning, repositoryFullName, implicitCliHostUncertain);
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

  if (foldedJobName.leadingBlank) {
    addWarning(
      "folded-job-name-unclassified",
      foldedJobName.headerLine,
      "A folded job name has leading blank content and was not classified by the bounded text scan.",
      foldedJobName.headerRaw,
    );
    return;
  }

  const expression = foldedJobName.fragments.length === 1 ? foldedJobName.fragments[0] : null;
  if (expression === null) {
    if (foldedJobName.fragments.length > 1) {
      addWarning(
        "folded-job-name-unclassified",
        foldedJobName.headerLine,
        "A folded job name uses multiple body lines and was not classified by the bounded text scan.",
        foldedJobName.headerRaw,
      );
    }
    return;
  }
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

function inspectLineSignals(line, reserved, yamlAnchors, allowYamlAliases, addMatch, addWarning, repositoryFullName, implicitCliHostUncertain) {
  if (line.truncated) return;
  if (line.yamlScalarContent && line.yamlScalarOwnerKey !== "run") {
    if (hasExactToken(line.text, reserved) || isAmbiguous(line.text, new Map(), reserved)) {
      addWarning(
        "non-executable-gate-reference",
        line.line,
        "Non-run scalar data refers to gate-like text; input data flow is not classified by this scan.",
        line.raw,
      );
    }
    return;
  }
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
      : fieldsOutsideFlowData(line);
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
  const cliContext = cliContextExpression(line.text, repositoryFullName, implicitCliHostUncertain);
  if (cliContext && resolveSimpleLiteral(cliContext, new Map()) === reserved) {
    addMatch("reserved-status-context", line.line, line.raw);
  }
  const cliCheckRunName = cliCheckRunNameExpression(line.text, repositoryFullName, implicitCliHostUncertain);
  if (cliCheckRunName && resolveSimpleLiteral(cliCheckRunName, new Map()) === reserved) {
    addMatch("reserved-check-run-name", line.line, line.raw);
  }
  const curlSignal = line.continuedCurlCommandPart
    ? null
    : curlPublisherSignal(line.text, reserved, repositoryFullName);
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

function inspectWindow(window, reserved, addMatch, addWarning, repositoryFullName, implicitCliHostUncertain) {
  const literals = new Map();
  for (const line of window) {
    if (line.unclassifiedRunBlock) {
      literals.clear();
      continue;
    }
    if (line.truncated) {
      literals.clear();
      continue;
    }
    if (line.yamlScalarContent && line.yamlScalarOwnerKey !== "run") {
      literals.clear();
      continue;
    }
    if (
      !line.yamlScalarContent &&
      !line.yamlDataField &&
      !isRunCommandLine(line.text) &&
      !line.continuedCurlCommandPart
    ) {
      for (const field of fieldsOutsideFlowData(line)) {
        if (field.key === "uses") {
          if (line.selectorUseStarts?.has(field.start)) {
            inspectCaller(field.value, literals, line, addMatch, addWarning);
          }
          continue;
        }
        if (isContextField(field.key) || (isNameField(field.key) && line.jobNameField)) {
          inspectContext(field.key, field.value, literals, line, reserved, addMatch, addWarning, resolveYamlWindowLiteral);
        }
      }
    }
    for (const field of [
      ...(line.flowJobFields?.names ?? []),
      ...(line.inlineJobFields?.names ?? []),
    ]) {
      inspectContext("name", field.value, literals, line, reserved, addMatch, addWarning, resolveYamlWindowLiteral);
    }
    for (const field of [
      ...(line.flowJobFields?.uses ?? []),
      ...(line.inlineJobFields?.uses ?? []),
      ...(line.flowStepUses ?? []),
    ]) {
      inspectCaller(field.value, literals, line, addMatch, addWarning);
    }
    const cliContext = cliContextExpression(line.text, repositoryFullName, implicitCliHostUncertain);
    if (cliContext) {
      inspectContext("context", cliContext, literals, line, reserved, addMatch, addWarning);
    }
    const cliCheckRunName = cliCheckRunNameExpression(line.text, repositoryFullName, implicitCliHostUncertain);
    if (cliCheckRunName) {
      inspectContext("check-run-name", cliCheckRunName, literals, line, reserved, addMatch, addWarning);
    }
    const curlSignal = line.continuedCurlCommandPart
      ? null
      : curlPublisherSignal(line.text, reserved, repositoryFullName);
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

function inspectContext(
  key,
  expression,
  literals,
  line,
  reserved,
  addMatch,
  addWarning,
  resolveLiteral = resolveSimpleLiteral,
) {
  const value = resolveLiteral(expression, literals);
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
  return yamlFieldsOnLine(text).filter(
    ({ key }) => key.toLowerCase() === "uses" || isContextField(key) || isNameField(key),
  );
}

function fieldsOutsideFlowData(line) {
  // Known flow jobs/steps use their role-aware fields, not a nested text rescan.
  return line.workflowFlowCollection
    ? [
      ...(line.flowJobFields?.contexts ?? []),
      ...(line.inlineJobFields?.contexts ?? []),
      ...(line.flowStepContexts ?? []),
    ]
    : fieldsOnLine(line.text);
}

function yamlFieldsOnLine(text) {
  const fields = [];
  const pattern = /(?:^|[,{])\s*(?:-\s*)?(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_-]*))\s*:\s*/gu;
  for (const match of text.matchAll(pattern)) {
    const boundary = text[match.index];
    const state = yamlSyntaxState(text, match.index);
    if (state.quote !== null) continue;

    let containerStack = state.stack;
    if (boundary === "{") {
      containerStack = [...containerStack, "{"];
    } else if (boundary === ",") {
      if (containerStack.at(-1) !== "{") continue;
    } else if (containerStack.length > 0) {
      continue;
    }

    const key = match[1] ?? match[2] ?? match[3];
    const valueStart = match.index + match[0].length;
    const valueEnd = yamlFieldValueEnd(text, valueStart, containerStack);
    fields.push({
      key,
      value: text.slice(valueStart, valueEnd).trim(),
      start: match.index + match[0].lastIndexOf(key),
    });
  }
  return fields;
}

function yamlSyntaxState(text, end) {
  const stack = [];
  let quote = null;
  let escaped = false;
  for (let index = 0; index < end; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (quote === '"' && character === "\\") escaped = true;
      else if (character === quote) {
        if (quote === "'" && text[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "{" || character === "[") {
      stack.push(character);
    } else if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.at(-1) === expected) stack.pop();
    }
  }
  return { quote, stack };
}

function yamlFieldValueEnd(text, start, containerStack) {
  if (containerStack.length === 0) return text.length;

  const stack = [...containerStack];
  const containerDepth = stack.length;
  let quote = null;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (quote === '"' && character === "\\") escaped = true;
      else if (character === quote) {
        if (quote === "'" && text[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "{" || character === "[") {
      stack.push(character);
    } else if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.length === containerDepth && stack.at(-1) === expected) return index;
      if (stack.at(-1) === expected) stack.pop();
    } else if (character === "," && stack.length === containerDepth && stack.at(-1) === "{") {
      return index;
    }
  }
  return text.length;
}

function useFieldExpressions(text) {
  const pattern = /(?:^|[,{])\s*(?:-\s*)?(?:"uses"|'uses'|uses)\s*:\s*([^,}\n]*)/gu;
  return [...text.matchAll(pattern)].map((match) => match[1].trim());
}

function cliContextExpression(text, repositoryFullName, implicitCliHostUncertain) {
  const command = firstShellCommand(runCommand(text));
  const admission = cliApiSupportsFieldPublisher(command, implicitCliHostUncertain);
  if (admission === false) return null;
  const endpoint = cliApiEndpoint(command);
  if (!/^\/?repos\/[^/]+\/[^/]+\/statuses\/[^/?#]+$/iu.test(endpoint ?? "")) return null;
  if (isKnownForeignRepositoryEndpoint(endpoint, repositoryFullName)) return null;
  if ((admission.method ?? "POST") !== "POST") return null;
  return cliFieldExpression(command, "context");
}

function cliApiEndpoint(command) {
  const match = command.match(/^gh\s+api\s+(?:"([^"]*)"|'([^']*)'|([^\s]+))(?:\s|$)/iu);
  const endpoint = match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
  return endpoint?.startsWith("-") ? null : endpoint;
}

function cliApiSupportsFieldPublisher(command, implicitCliHostUncertain = false) {
  const arguments_ = shellWords(command);
  if (!arguments_ || arguments_[0] !== "gh" || arguments_[1] !== "api") return false;
  let hostname = null;
  let methodCount = 0;
  let method = null;
  const valueOptions = new Set(["-f", "-F", "--field", "--raw-field", "-H", "--header"]);
  for (let index = 2; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--input" || argument.startsWith("--input=")) return false;
    if (argument === "--hostname") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("-")) return false;
      if (hostname !== null && hostname.toLowerCase() !== value.toLowerCase()) return false;
      hostname = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--hostname=")) {
      const value = argument.slice("--hostname=".length);
      if (!value || (hostname !== null && hostname.toLowerCase() !== value.toLowerCase())) return false;
      hostname = value;
      continue;
    }
    if (argument === "-X" || argument === "--method") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("-") || ++methodCount > 1) return false;
      method = value.toUpperCase();
      index += 1;
      continue;
    }
    if (argument.startsWith("-X=") || argument.startsWith("--method=")) {
      const value = argument.slice(argument.indexOf("=") + 1);
      if (!value || ++methodCount > 1) return false;
      method = value.toUpperCase();
      continue;
    }
    if (argument.startsWith("-X") || argument.startsWith("--method")) return false;
    if (valueOptions.has(argument)) {
      if (arguments_[index + 1] === undefined) return false;
      index += 1;
      continue;
    }
    if (["-f=", "-F=", "--field=", "--raw-field=", "-H=", "--header="].some((prefix) => argument.startsWith(prefix))) continue;
    if (index !== 2) return false;
  }
  if (implicitCliHostUncertain && hostname === null) return false;
  return hostname === null || hostname.toLowerCase() === "github.com" ? { method } : false;
}

function cliCheckRunNameExpression(text, repositoryFullName, implicitCliHostUncertain) {
  const command = firstShellCommand(runCommand(text));
  const admission = cliApiSupportsFieldPublisher(command, implicitCliHostUncertain);
  if (admission === false) return null;
  const endpoint = cliApiEndpoint(command);
  if (isKnownForeignRepositoryEndpoint(endpoint, repositoryFullName)) return null;
  if (/^\/?repos\/[^/]+\/[^/]+\/check-runs$/iu.test(endpoint ?? "")) {
    if ((admission.method ?? "POST") !== "POST") return null;
  } else if (/^\/?repos\/[^/]+\/[^/]+\/check-runs\/[^/?#]+$/iu.test(endpoint ?? "")) {
    if (admission.method !== "PATCH") return null;
  } else {
    return null;
  }
  return cliFieldExpression(command, "name");
}

function curlPublisherSignal(text, reserved, repositoryFullName) {
  const command = firstShellCommand(runCommand(text));
  if (!/^curl(?:\s|$)/iu.test(command)) return null;
  if (hasShellLineContinuation(command)) return null;

  const arguments_ = shellWords(command);
  if (!arguments_ || arguments_[0] !== "curl") return null;
  let method = null;
  let target = null;
  const payloads = [];
  let reject = false;
  const valueOptions = new Set([
    "-X", "--request", "-H", "--header", "--data", "-d", "--data-raw",
    "--data-binary", "--data-urlencode", "--json", "--url",
  ]);
  const flagOptions = new Set([
    "-L", "--location", "-f", "--fail", "-s", "--silent", "-S", "--show-error",
    "--compressed", "-i", "--include", "-v", "--verbose", "--http1.1", "--http2",
    "-g", "--globoff", "-I", "--head", "--get",
  ]);
  const dataOptions = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--json"]);
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const equals = argument.indexOf("=");
    const option = equals > 0 ? argument.slice(0, equals) : argument;
    const inlineValue = equals > 0 ? argument.slice(equals + 1) : null;
    if (option === "--data-urlencode") return null;
    if (valueOptions.has(option)) {
      const value = inlineValue ?? arguments_[index + 1];
      if (value === undefined || (inlineValue === null && value.startsWith("-"))) return null;
      if (inlineValue === null) index += 1;
      if (option === "-X" || option === "--request") {
        if (method !== null) return null;
        method = value.toUpperCase();
      } else if (dataOptions.has(option)) {
        payloads.push(value);
      } else if (option === "--url") {
        if (target !== null) return null;
        target = value;
      } else if ((option === "-H" || option === "--header") && /^\s*host\s*[:;]/iu.test(value)) {
        return null;
      }
      continue;
    }
    if (flagOptions.has(argument)) {
      if (argument === "-I" || argument === "--head" || argument === "--get") reject = true;
      continue;
    }
    if (argument.startsWith("-")) return null;
    if (target !== null) return null;
    target = argument;
  }
  if (reject || method !== "POST" || target === null || payloads.length !== 1) return null;

  const apiPath = supportedGitHubApiPath(target);
  if (apiPath === null) return null;
  if (isKnownForeignRepositoryEndpoint(apiPath, repositoryFullName)) return null;
  const checkRunsEndpoint = /^\/repos\/[^/]+\/[^/]+\/check-runs$/iu.test(apiPath);
  const statusesEndpoint = /^\/repos\/[^/]+\/[^/]+\/statuses\/[^/]+$/iu.test(apiPath);
  if (!checkRunsEndpoint && !statusesEndpoint) return null;

  for (const payload of payloads) {
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

function isKnownForeignRepositoryEndpoint(endpoint, repositoryFullName) {
  if (typeof repositoryFullName !== "string") return false;
  const target = repositoryFullName.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u);
  const destination = endpoint?.match(/^\/?repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\//iu);
  if (!target || !destination) return false;
  return `${destination[1]}/${destination[2]}`.toLowerCase() !==
    `${target[1]}/${target[2]}`.toLowerCase();
}

function supportedGitHubApiPath(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  const authority = target.match(/^https:\/\/([^/?#]+)/iu)?.[1] ?? "";
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "api.github.com" ||
    authority.includes("@") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    return null;
  }
  return url.pathname;
}

function shellWords(command) {
  const words = [];
  let word = "";
  let quote = null;
  let escaped = false;
  let started = false;
  for (const character of command) {
    if (escaped) {
      word += character;
      escaped = false;
      started = true;
    } else if (character === "\\" && quote === '"') {
      return null;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote !== null) {
      if (character === quote) quote = null;
      else word += character;
      started = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += character;
      started = true;
    }
  }
  if (quote !== null || escaped) return null;
  if (started) words.push(word);
  return words;
}

function jsonStringField(payload, key) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.hasOwn(parsed, key) ||
    typeof parsed[key] !== "string"
  ) {
    return null;
  }
  return parsed[key];
}

function inspectCurlContinuationBlocks(lines, reserved, addMatch, addWarning, repositoryFullName) {
  let runBlockIndent = null;
  let runBlockHeaderChars = 0;
  let previousContinues = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.unclassifiedRunBlock || line.truncated || line.yamlDataField || (line.yamlScalarContent && line.yamlScalarOwnerKey !== "run")) {
      runBlockIndent = null;
      runBlockHeaderChars = 0;
      previousContinues = false;
      index += 1;
      continue;
    }
    if (!line.yamlScalarContent && isYamlDocumentBoundary(line.text)) {
      runBlockIndent = null;
      runBlockHeaderChars = 0;
      previousContinues = false;
      index += 1;
      continue;
    }
    const runHeader = line.yamlScalarContent || line.yamlDataField
      ? null
      : line.text.match(/^\s*(?:-\s*)?run\s*:\s*(.*)$/iu);
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
    if (/^curl(?:\s|$)/iu.test(initialCommand) && hasSingleQuotedTrailingBackslash(initialCommand)) {
      line.continuedCurlCommandPart = true;
      addWarning(
        "continued-curl-command-unclosed",
        line.line,
        "A curl command ends with a backslash inside a single-quoted argument and was not joined as a shell continuation.",
        line.raw,
      );
      previousContinues = false;
      index += 1;
      continue;
    }
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
        physical.unclassifiedRunBlock ||
        physical.truncated ||
        physical.yamlDataField ||
        (physical.yamlScalarContent && physical.yamlScalarOwnerKey !== "run") ||
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

    const signal = curlPublisherSignal(chunks.join(" "), reserved, repositoryFullName);
    if (signal) addMatch(signal.kind, firstLine.line, firstLine.raw);
    previousContinues = false;
    index = current;
  }
}

function hasShellLineContinuation(value) {
  const trailingSlashes = value.match(/\\+\s*$/u);
  if (!trailingSlashes || trailingSlashes[0].trimEnd().length % 2 !== 1) return false;
  return !isInsideSingleQuote(value, trailingSlashes.index);
}

function hasSingleQuotedTrailingBackslash(value) {
  const trailingSlashes = value.match(/\\+\s*$/u);
  return Boolean(
    trailingSlashes &&
    trailingSlashes[0].trimEnd().length % 2 === 1 &&
    isInsideSingleQuote(value, trailingSlashes.index),
  );
}

function isInsideSingleQuote(value, end) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < end; index += 1) {
    const character = value[index];
    if (quote === "'") {
      if (character === "'") quote = null;
    } else if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (quote === '"') {
      if (character === '"') quote = null;
    } else if (character === "'") {
      quote = "'";
    } else if (character === '"') {
      quote = '"';
    }
  }
  return quote === "'";
}

// Quoted YAML run scalars remain unclassified; this scan does not decode YAML.
function runCommand(text) {
  return text.match(/^\s*(?:-\s*)?run\s*:\s*(.*)$/iu)?.[1]?.trim() ?? text.trim();
}

// Descriptor redirections are an accepted warning-only coverage gap here.
// This bounded prefix scan does not parse shell redirection grammar; see the
// public workflow-scan risk boundary before adding new shell recognizers.
function firstShellCommand(command) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ";" || character === "&" || character === "|") {
      return command.slice(0, index).trim();
    }
  }
  return command.trim();
}

function cliFieldExpression(text, field) {
  const arguments_ = shellWords(text);
  if (!arguments_ || arguments_[0] !== "gh" || arguments_[1] !== "api") return null;
  const values = [];
  for (let index = 3; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (["-H", "--header", "-X", "--method", "--hostname"].includes(argument)) {
      index += 1;
      continue;
    }
    let value = null;
    if (["-f", "-F", "--field", "--raw-field"].includes(argument)) {
      value = arguments_[index + 1];
      index += 1;
    } else if (["-f=", "-F=", "--field=", "--raw-field="].some((prefix) => argument.startsWith(prefix))) {
      value = argument.slice(argument.indexOf("=") + 1);
    }
    if (typeof value === "string" && value.startsWith(`${field}=`)) {
      values.push(value.slice(value.indexOf("=") + 1));
    }
  }
  return values.length === 1 && !values[0].includes("$") ? JSON.stringify(values[0]) : null;
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
      ? { names: [], uses: [], steps: [], contexts: [], flowCollection: false, ambiguous: false }
      : flowStyleJobFields(line.text);
    line.workflowFlowCollection = line.flowJobFields.flowCollection;
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
        line.workflowFlowCollection ||= line.inlineJobFields.flowCollection;
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
        line.flowStepContexts = flowSteps.contexts;
        line.workflowFlowCollection ||= flowSteps.flowCollection;
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

function markUnknownRunBlocks(lines, reserved, addWarning) {
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    if (header.truncated || header.yamlDataField || header.yamlScalarContent) continue;
    const runHeader = header.text.match(/^\s*(?:-\s*)?run\s*:\s*(.*)$/iu);
    if (!runHeader || !isBlockScalarIndicator(stripYamlAnchor(runHeader[1].trim()))) continue;

    const blockLines = [header];
    let containsHereDocLikeText = false;
    const scalarIndicator = stripYamlAnchor(runHeader[1].trim());
    const isFoldedScalar = scalarIndicator.startsWith(">");
    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const body = lines[bodyIndex];
      if (!body.yamlScalarContent || body.yamlScalarOwnerKey !== "run") break;
      blockLines.push(body);
      if (body.raw.includes("<<")) containsHereDocLikeText = true;
    }
    if (!containsHereDocLikeText && !isFoldedScalar) continue;

    for (const line of blockLines) line.unclassifiedRunBlock = true;
    addWarning(
      "unclassified-run-block",
      header.line,
      "A run block contains here-document-like text or uses folded YAML style and was skipped by the bounded shell-text scan.",
      header.raw,
    );
    if (blockLines.some((line) => hasExactToken(line.raw, reserved))) {
      addWarning(
        "reserved-status-context-reference",
        header.line,
        "The reserved name appears in an unclassified run block; this text scan cannot confirm a status publisher.",
        header.raw,
      );
    }
    index += blockLines.length - 1;
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
  let scalarOwnerKey = null;
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
    if (line.truncated) {
      scalarKeyIndent = null;
      scalarOwnerKey = null;
      dataMappingIndents.length = 0;
      resetWorkflowYamlScope(workflow);
      continue;
    }
    if (
      isYamlDocumentBoundary(line.text) &&
      (scalarKeyIndent === null || indentationOf(line.text) <= scalarKeyIndent)
    ) {
      scalarKeyIndent = null;
      scalarOwnerKey = null;
      dataMappingIndents.length = 0;
      resetWorkflowYamlScope(workflow);
      continue;
    }
    if (!line.text.trim()) continue;

    const mapping = simpleYamlMapping(line.text);
    if (scalarKeyIndent !== null) {
      if (mapping && mapping.indent <= scalarKeyIndent) {
        scalarKeyIndent = null;
        scalarOwnerKey = null;
      } else {
        line.yamlScalarContent = true;
        line.yamlScalarOwnerKey = scalarOwnerKey;
        continue;
      }
    }

    const fieldIndent = mapping?.indent ?? indentationOf(line.text);
    while (dataMappingIndents.length && dataMappingIndents.at(-1) >= fieldIndent) {
      dataMappingIndents.pop();
    }
    line.yamlDataField = dataMappingIndents.length > 0;
    const workflowProperty = !line.yamlDataField && isWorkflowYamlProperty(line, mapping, workflow);
    const nestedJobProperty =
      workflow.jobsIndent !== null &&
      workflow.jobIndent !== null &&
      fieldIndent > workflow.jobIndent;

    const dataMappingValue = mapping
      ? stripYamlAnchor(`${mapping.value.trim()} `).trim()
      : "";
    const flowDataMapping =
      mapping &&
      dataMappingValue.startsWith("{") &&
      !parseFlowMap(dataMappingValue).ambiguous;
    if (
      !line.yamlDataField &&
      mapping &&
      (/^(?:env|with|outputs|secrets|strategy|container|services|defaults)$/iu.test(mapping.key) ||
        (mapping.key.toLowerCase() === "matrix" && nestedJobProperty)) &&
      (!dataMappingValue || flowDataMapping) &&
      (workflowProperty || nestedJobProperty)
    ) {
      if (flowDataMapping) line.yamlDataField = true;
      else dataMappingIndents.push(mapping.indent);
    }
    if (mapping && isBlockScalarIndicator(stripYamlAnchor(mapping.value))) {
      scalarKeyIndent = mapping.indent;
      scalarOwnerKey = mapping.key.toLowerCase();
      if (scalarOwnerKey === "run" && (line.yamlDataField || !workflowProperty)) scalarOwnerKey = null;
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
    line.yamlStepBoundary = true;
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
  const result = { names: [], uses: [], steps: [], contexts: [], flowCollection: false, ambiguous: false };
  const root = parseFlowMap(text);
  if (root.ambiguous) {
    result.ambiguous = /\bjobs\b/iu.test(text);
    return result;
  }
  const jobs = root.entries.find((field) => field.key.toLowerCase() === "jobs");
  if (!jobs) return result;
  result.contexts.push(...root.entries.filter((field) => isContextField(field.key)));

  const jobEntries = parseFlowMap(jobs.value);
  if (jobEntries.ambiguous) {
    result.ambiguous = true;
    return result;
  }
  result.flowCollection = jobs.value.trim().startsWith("{");
  for (const job of jobEntries.entries) {
    const fields = parseFlowMap(job.value);
    if (fields.ambiguous) {
      result.ambiguous = true;
      continue;
    }
    for (const field of fields.entries) {
      if (isNameField(field.key)) result.names.push(field);
      if (field.key.toLowerCase() === "uses") result.uses.push(field);
      if (isContextField(field.key)) result.contexts.push(field);
      if (field.key.toLowerCase() === "steps") {
        const steps = simpleFlowStepUses(field.value);
        result.steps.push(...steps.uses);
        result.contexts.push(...steps.contexts);
        result.ambiguous ||= steps.ambiguous;
      }
    }
  }
  return result;
}

function simpleInlineJobFields(value) {
  const result = { names: [], uses: [], steps: [], contexts: [], flowCollection: false, ambiguous: false };
  const fields = parseFlowMap(value);
  if (fields.ambiguous) {
    result.ambiguous = true;
    return result;
  }
  result.flowCollection = value.trim().startsWith("{");
  for (const field of fields.entries) {
    if (isNameField(field.key)) result.names.push(field);
    if (field.key.toLowerCase() === "uses") result.uses.push(field);
    if (isContextField(field.key)) result.contexts.push(field);
    if (field.key.toLowerCase() === "steps") {
      const steps = simpleFlowStepUses(field.value);
      result.steps = steps.uses;
      result.contexts.push(...steps.contexts);
      result.ambiguous ||= steps.ambiguous;
    }
  }
  return result;
}

function simpleFlowStepUses(value) {
  const collection = unwrapFlowCollection(value, "[");
  if (!collection.present) return { uses: [], contexts: [], flowCollection: false, ambiguous: false };
  if (collection.ambiguous) return { uses: [], contexts: [], flowCollection: false, ambiguous: true };
  const items = splitFlowParts(collection.body);
  if (!items) return { uses: [], contexts: [], flowCollection: false, ambiguous: true };
  const uses = [];
  const contexts = [];
  for (const item of items) {
    if (!item.trim().startsWith("{")) continue;
    const fields = parseFlowMap(item);
    if (fields.ambiguous) return { uses: [], contexts: [], flowCollection: false, ambiguous: true };
    for (const field of fields.entries) {
      if (field.key.toLowerCase() === "uses") uses.push(field);
      if (isContextField(field.key)) contexts.push(field);
    }
  }
  return { uses, contexts, flowCollection: true, ambiguous: false };
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
  for (const { value: fieldValue } of yamlFieldsOnLine(line.text)) {
    const match = fieldValue.match(/^&([A-Za-z_][A-Za-z0-9_-]*)\s+(.+)$/u);
    if (!match) continue;
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
  if (!value.startsWith("*")) return resolveYamlLiteral(value);

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

function resolveYamlLiteral(expression) {
  const value = expression.trim();
  if (!value || value.length > MAX_WINDOW_CHARS) return null;
  return literalAtom(value, new Map());
}

function isBlockScalarIndicator(value) {
  return /^[>|](?:[+-]?[1-9]?|[1-9]?[+-]?)\s*$/u.test(value);
}

function isStripChompBlockScalar(value) {
  return /^[>|](?:-[1-9]?|[1-9]-)\s*$/u.test(value);
}

function resolveSimpleLiteral(expression, literals, stripTerminators = true) {
  const value = stripTerminators ? expression.trim().replace(/[;,]\s*$/u, "").trim() : expression.trim();
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

function resolveYamlWindowLiteral(expression, literals) {
  return resolveSimpleLiteral(expression, literals, false);
}

function literalAtom(value, literals, allowBare = true) {
  const token = value.trim();
  if (literals.has(token)) return literals.get(token);
  if (token.length >= 2 && token[0] === token.at(-1) && (token[0] === "'" || token[0] === '"')) {
    const inner = token.slice(1, -1);
    // Escaped scalar decoding is an accepted coverage gap, not literal proof.
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
  const statements = [];
  let quote = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ";") {
      statements.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (quote !== null || escaped) return [];
  statements.push(text.slice(start));
  return statements.map((statement) => statement.trim()).filter(Boolean);
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
    const boundary =
      line.yamlStepBoundary ||
      (!line.yamlScalarContent && !line.yamlDataField && isScopeBoundary(line.text));
    if (scope.length && boundary) {
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
    /^ {2}[A-Za-z0-9_-]+:\s*$/u.test(text)
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
      window.push(
        line.text.length > remaining
          ? { ...line, text: line.text.slice(0, remaining), truncated: true }
          : line,
      );
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
    } else if (character === "#" && (index === 0 || /\s/u.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function safeExcerpt() {
  return "[source text omitted; inspect the reported workflow line]";
}
