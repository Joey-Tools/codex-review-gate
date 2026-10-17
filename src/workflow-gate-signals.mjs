const DEFAULT_RESERVED_CHECK_NAME = "codex/github-review-gate";
const MAX_INPUT_CHARS = 256 * 1024;
const MAX_LINES = 4096;
const MAX_LINE_CHARS = 4096;
const MAX_WINDOW_LINES = 16;
const MAX_WINDOW_CHARS = 2048;
const MAX_FINDINGS = 32;

const ACTION_CALLERS = [
  /^JoeyTeng\/codex-review-gate-action(?:\/\.github\/workflows\/codex-review-gate\.ya?ml)?@[^\s,}"']+$/iu,
  /^Joey-Tools\/codex-review-gate(?:\/\.github\/workflows\/[^@\s,}"']+)?@[^\s,}"']+$/iu,
];

/**
 * Best-effort segmented text heuristic, not a workflow parser or security proof.
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
    return { line: index + 1, raw: limited, text: stripComments(limited) };
  });
  markYamlJobNameFields(lines);

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
  for (const line of lines) {
    if (foldedJobName) {
      if (!line.text.trim()) {
        foldedJobName.remaining -= 1;
      } else if (indentationOf(line.text) > foldedJobName.indent) {
        const expression = line.text.trim();
        if (resolveSimpleLiteral(expression, new Map()) === reserved) {
          addMatch("reserved-job-name", line.line, line.raw);
        } else if (isDynamic(expression) || isAmbiguous(expression, new Map(), reserved)) {
          addWarning(
            isDynamic(expression) ? "dynamic-context-not-confirmed" : "ambiguous-reserved-context",
            line.line,
            "A folded job name may refer to the reserved check, but literal composition could not be confirmed.",
            line.raw,
          );
        }
        foldedJobName.remaining -= 1;
      } else {
        foldedJobName = null;
      }
      if (foldedJobName && foldedJobName.remaining <= 0) foldedJobName = null;
    }
    if (foldedUses) {
      if (!line.text.trim()) {
        foldedUses.remaining -= 1;
      } else if (indentationOf(line.text) > foldedUses.indent) {
        addCallerMatch(resolveSimpleLiteral(line.text.trim(), new Map()), line, addMatch);
        foldedUses.remaining -= 1;
      } else {
        foldedUses = null;
      }
      if (foldedUses && foldedUses.remaining <= 0) foldedUses = null;
    }
    if (!line.text.trim()) continue;
    inspectLineSignals(line, reserved, addMatch, addWarning);
    const uses = fieldsOnLine(line.text).find((field) => field.key === "uses");
    if (uses && isBlockScalarIndicator(uses.value)) {
      foldedUses = { indent: indentationOf(line.text), remaining: 4 };
    }
    const name = fieldsOnLine(line.text).find((field) => isNameField(field.key));
    if (line.jobNameField && name && isBlockScalarIndicator(name.value)) {
      foldedJobName = { indent: indentationOf(line.text), remaining: 4 };
    }
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

function inspectLineSignals(line, reserved, addMatch, addWarning) {
  const fields = fieldsOnLine(line.text);
  for (const field of fields) {
    if (field.key === "uses") {
      const value = resolveSimpleLiteral(stripYamlAnchor(field.value), new Map());
      addCallerMatch(value, line, addMatch);
    } else if (isContextField(field.key) || (isNameField(field.key) && line.jobNameField)) {
      if (resolveSimpleLiteral(field.value, new Map()) === reserved) {
        addMatch(field.key.toLowerCase() === "name" ? "reserved-job-name" : "reserved-status-context", line.line, line.raw);
      }
    }
  }
  const flowJobNames = flowStyleJobNameFields(line.text);
  for (const field of flowJobNames) {
    if (resolveSimpleLiteral(field.value, new Map()) === reserved) {
      addMatch("reserved-job-name", line.line, line.raw);
    }
  }
  const cliContext = cliContextExpression(line.text);
  if (cliContext && resolveSimpleLiteral(cliContext, new Map()) === reserved) {
    addMatch("reserved-status-context", line.line, line.raw);
  }
  const cliCheckRunName = cliCheckRunNameExpression(line.text);
  if (cliCheckRunName && resolveSimpleLiteral(cliCheckRunName, new Map()) === reserved) {
    addMatch("reserved-check-run-name", line.line, line.raw);
  }
  const exactFieldHandled = fields.some(
    (field) =>
      (isContextField(field.key) || (isNameField(field.key) && line.jobNameField)) &&
      resolveSimpleLiteral(field.value, new Map()) === reserved,
  ) || flowJobNames.some((field) => resolveSimpleLiteral(field.value, new Map()) === reserved);
  const exactCliHandled =
    (cliContext !== null && resolveSimpleLiteral(cliContext, new Map()) === reserved) ||
    (cliCheckRunName !== null && resolveSimpleLiteral(cliCheckRunName, new Map()) === reserved);
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
    for (const field of fieldsOnLine(line.text)) {
      if (field.key === "uses") {
        inspectCaller(field.value, literals, line, addMatch, addWarning);
      } else if (isContextField(field.key) || (isNameField(field.key) && line.jobNameField)) {
        inspectContext(field.key, field.value, literals, line, reserved, addMatch, addWarning);
      }
    }
    for (const field of flowStyleJobNameFields(line.text)) {
      inspectContext("name", field.value, literals, line, reserved, addMatch, addWarning);
    }
    const cliContext = cliContextExpression(line.text);
    if (cliContext) {
      inspectContext("context", cliContext, literals, line, reserved, addMatch, addWarning);
    }
    const cliCheckRunName = cliCheckRunNameExpression(line.text);
    if (cliCheckRunName) {
      inspectContext("check-run-name", cliCheckRunName, literals, line, reserved, addMatch, addWarning);
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
    /codex-review-gate-action|Joey-Tools\/codex-review-gate|JoeyTeng/iu.test(expression)
  ) {
    addWarning(
      "ambiguous-codex-review-gate-caller",
      line.line,
      "A uses selector may refer to a Codex review gate caller, but literal composition could not be confirmed.",
      line.raw,
    );
  }
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
    if (key.toLowerCase() === "uses" || isContextField(key) || isNameField(key)) fields.push({ key, value });
  }
  return fields;
}

function cliContextExpression(text) {
  return cliFieldExpression(text, "context");
}

function cliCheckRunNameExpression(text) {
  if (!/\/check-runs(?:[/?#\s]|$)/iu.test(text)) return null;
  return cliFieldExpression(text, "name");
}

function cliFieldExpression(text, field) {
  const wholeField = text.match(
    new RegExp(`(?:^|\\s)(?:-f|--field)(?:\\s+|=)\\s*(['"])${field}=([^'"]*)\\1`, "iu"),
  );
  if (wholeField) return `${wholeField[1]}${wholeField[2]}${wholeField[1]}`;
  const fieldValue = text.match(
    new RegExp(
      `(?:^|\\s)(?:-f|--field)(?:\\s+|=)\\s*${field}=(?:"([^"]*)"|'([^']*)'|([^\\s'"]+))`,
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
  let jobsIndent = null;
  let jobIndent = null;
  let jobPropertyIndent = null;
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const indent = indentationOf(line.text);
    const text = line.text.trim();
    const key = simpleYamlKey(text);
    if (key?.toLowerCase() === "jobs" && /^\s*$/u.test(text.slice(text.indexOf(":") + 1))) {
      jobsIndent = indent;
      jobIndent = null;
      jobPropertyIndent = null;
      continue;
    }
    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      jobPropertyIndent = null;
      continue;
    }
    if (jobIndent === null || indent === jobIndent) {
      if (key !== null) {
        jobIndent = indent;
        jobPropertyIndent = null;
      }
      continue;
    }
    if (jobPropertyIndent === null) jobPropertyIndent = indent;
    if (indent === jobPropertyIndent && key?.toLowerCase() === "name") {
      line.jobNameField = true;
    }
  }
}

function simpleYamlKey(text) {
  const match = text.match(/^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*:/u);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function flowStyleJobNameFields(text) {
  const jobs = /\bjobs\s*:\s*\{\s*[A-Za-z0-9_-]+\s*:\s*\{([^{}]*)\}/u.exec(text);
  if (!jobs) return [];
  return fieldsOnLine(jobs[1]).filter((field) => isNameField(field.key));
}

function stripYamlAnchor(value) {
  return value.replace(/^&[A-Za-z_][A-Za-z0-9_-]*\s+/u, "");
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
