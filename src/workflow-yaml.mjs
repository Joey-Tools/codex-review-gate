// This limited line-oriented lexer preserves simple plain/quoted mapping keys
// and block-scalar boundaries for workflow inventory callers. It is not a
// general YAML parser or validator; callers remain responsible for their own
// structural policies.

export function tokenizeWorkflowYaml(value) {
  if (typeof value !== "string") {
    throw new Error("workflow content must be text.");
  }
  assertCanonicalWorkflowLineEndings(value);
  const normalized = value.startsWith("\uFEFF") ? value.slice(1) : value;
  const lines = normalized.split(/\r?\n/u);
  const tokens = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const rawIndent = rawLine.match(/^ */u)[0].length;
    if (/^\s*\t/u.test(rawLine)) {
      throw new Error("workflow uses tab-indented YAML structure.");
    }
    const uncommented = stripYamlComment(rawLine.slice(rawIndent)).trimEnd();
    if (uncommented.trim() === "") {
      continue;
    }
    const token = {
      index,
      indent: rawIndent,
      text: uncommented,
      blockStyle: null,
      blockContent: [],
    };
    const mapping = parseWorkflowYamlMapping(token);
    if (mapping !== null && /^[|>][+-]?[1-9]?$|^[|>][1-9]?[+-]?$/u.test(mapping.value)) {
      token.blockStyle = mapping.value;
      const blockParentIndent = mapping.sequence ? rawIndent + 2 : rawIndent;
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const contentLine = lines[cursor];
        const contentIndent = contentLine.match(/^ */u)[0].length;
        if (contentLine.trim() !== "" && contentIndent <= blockParentIndent) {
          break;
        }
        token.blockContent.push(contentLine);
        index = cursor;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

export function parseWorkflowYamlMapping(token) {
  if (token === undefined || token === null) {
    return null;
  }
  let text = token.text;
  let sequence = false;
  if (text.startsWith("- ")) {
    sequence = true;
    text = text.slice(2);
  }
  const match = text.match(
    /^([A-Za-z_][A-Za-z0-9_-]*|"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)')\s*:\s*(.*?)\s*$/u,
  );
  return match === null
    ? null
    : { key: match[2] ?? match[3] ?? match[1], value: match[4], sequence };
}

function stripYamlComment(line) {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
    } else if (char === '"' && !singleQuoted && line[index - 1] !== "\\") {
      doubleQuoted = !doubleQuoted;
    } else if (
      char === "#" &&
      !singleQuoted &&
      !doubleQuoted &&
      (index === 0 || /[ \t]/u.test(line[index - 1]))
    ) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

function assertCanonicalWorkflowLineEndings(value) {
  if (/\r(?!\n)/u.test(value)) {
    throw new Error(
      "Workflow uses a bare CR YAML line break; security inventory accepts only LF or CRLF line endings.",
    );
  }
}
