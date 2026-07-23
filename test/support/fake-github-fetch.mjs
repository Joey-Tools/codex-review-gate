import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.FAKE_GITHUB_STATE_PATH;
let state = statePath ? JSON.parse(readFileSync(statePath, "utf8")) : null;

if (statePath) {
  Date.now = () => state.now;

  globalThis.fetch = async function fakeFetch(input, options = {}) {
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    const path = url.pathname;
    const query = Object.fromEntries(url.searchParams);
    const body = parseRequestBody(options.body);

    state.requestLog ||= [];
    state.requestLog.push({ method, path, query, body });

    const fault = consumeRouteFault(method, path, url.search);
    if (fault) {
      save();
      if (fault.throwFetch) {
        const message =
          typeof fault.throwFetch === "string" ? fault.throwFetch : "fake route fetch failure";
        throw new TypeError(message);
      }
      return response(fault.body, fault.status ?? 500, {
        headers: fault.headers,
        rawText: fault.rawText,
      });
    }

    try {
      const result = handle({ method, path, query, body });
      save();
      return response(result.body, result.status ?? 200, {
        headers: result.headers,
        rawText: result.rawText,
      });
    } catch (error) {
      save();
      return response({ message: error.stack || error.message }, 500);
    }
  };

  process.on("exit", save);
}

function handle({ method, path, query, body }) {
  const repoBase = `/repos/${state.owner}/${state.repo}`;
  const prNumber = state.prNumber;

  if (method === "GET" && path === `${repoBase}/pulls`) {
    const pullRequests = state.pullRequests || (state.pullRequest ? [state.pullRequest] : []);
    return { body: paginateCollection(pullRequests, query) };
  }

  if (method === "GET" && path === `${repoBase}/pulls/${prNumber}`) {
    state.pullLoads ||= 0;
    state.pullLoads += 1;
    return { body: state.pullRequest };
  }

  if (method === "GET" && path === `${repoBase}/issues/${prNumber}/comments`) {
    if (positiveInteger(query.page, 1) === 1) {
      state.snapshotLoads ||= 0;
      state.snapshotLoads += 1;
      applySnapshotHooks();
    }
    return { body: paginateCollection(state.issueComments || [], query) };
  }

  if (method === "GET" && path === `${repoBase}/issues/${prNumber}/reactions`) {
    return { body: paginateCollection(state.issueReactions || [], query) };
  }

  if (method === "GET" && path === `${repoBase}/pulls/${prNumber}/comments`) {
    return { body: paginateCollection(state.reviewComments || [], query) };
  }

  if (method === "GET" && path === `${repoBase}/pulls/${prNumber}/reviews`) {
    return { body: paginateCollection(state.reviews || [], query) };
  }

  const commentReactionsMatch = path.match(
    new RegExp(`^${escapeRegExp(repoBase)}/issues/comments/(\\d+)/reactions$`),
  );
  if (method === "GET" && commentReactionsMatch) {
    return {
      body: paginateCollection(state.commentReactions?.[commentReactionsMatch[1]] || [], query),
    };
  }

  if (method === "POST" && path === `${repoBase}/issues/${prNumber}/comments`) {
    const id = state.nextCommentId;
    state.nextCommentId += 1;
    const comment = {
      id,
      body: body.body,
      created_at: nextIso(),
      html_url: `https://github.example/${state.owner}/${state.repo}/pull/${prNumber}#issuecomment-${id}`,
      user: { login: "github-actions[bot]" },
    };
    state.issueComments ||= [];
    state.issueComments.push(comment);
    return { body: comment, status: 201 };
  }

  const patchCommentMatch = path.match(new RegExp(`^${escapeRegExp(repoBase)}/issues/comments/(\\d+)$`));
  if (method === "PATCH" && patchCommentMatch) {
    const id = Number(patchCommentMatch[1]);
    const comment = state.issueComments.find((candidate) => candidate.id === id);
    if (!comment) {
      return { body: { message: "not found" }, status: 404 };
    }
    comment.body = body.body;
    return { body: comment };
  }

  const commitStatusesMatch = path.match(
    new RegExp(`^${escapeRegExp(repoBase)}/commits/(.+)/statuses$`),
  );
  if (method === "GET" && commitStatusesMatch) {
    const sha = decodePathComponent(commitStatusesMatch[1]);
    return { body: paginateCollection(commitStatusesFor(sha), query) };
  }

  const compareMatch = path.match(
    new RegExp(`^${escapeRegExp(repoBase)}/compare/([0-9a-fA-F]{40})\\.\\.\\.([0-9a-fA-F]{40})$`),
  );
  if (method === "GET" && compareMatch) {
    const baseSha = compareMatch[1].toLowerCase();
    const headSha = compareMatch[2].toLowerCase();
    const comparison = state.compareResults?.[`${baseSha}...${headSha}`];
    if (!comparison) {
      return { body: { message: `comparison ${baseSha}...${headSha} not found` }, status: 404 };
    }
    return { body: comparison };
  }

  const commitMatch = path.match(new RegExp(`^${escapeRegExp(repoBase)}/commits/(.+)$`));
  if (method === "GET" && commitMatch) {
    const ref = decodePathComponent(commitMatch[1]);
    const resolutions = state.commitResolutions || {};
    if (!Object.hasOwn(resolutions, ref)) {
      return { body: { message: `commit ${ref} not found` }, status: 404 };
    }
    const resolution = resolutions[ref];
    return {
      body:
        resolution && typeof resolution === "object" && !Array.isArray(resolution)
          ? resolution
          : { sha: resolution },
    };
  }

  const statusMatch = path.match(new RegExp(`^${escapeRegExp(repoBase)}/statuses/(.+)$`));
  if (method === "POST" && statusMatch) {
    state.statuses ||= [];
    state.statuses.push({
      sha: decodePathComponent(statusMatch[1]),
      body,
    });
    return { body: { id: state.statuses.length }, status: 201 };
  }

  if (method === "POST" && path === "/graphql") {
    if (state.failNextReviewThreads) {
      state.failNextReviewThreads = false;
      return {
        body: {
          errors: [{ message: "GraphQL reviewThreads query failed for test" }],
        },
      };
    }

    const variables = body?.variables || {};
    if (variables.threadId !== undefined && variables.threadId !== null) {
      const threadId = String(variables.threadId);
      const pages = threadCommentPagesFor(threadId);
      const connection = pages
        ? selectConnectionPage(pages, variables.after, `thread-${threadId}-comments`)
        : fallbackThreadComments(threadId);
      return {
        body: {
          data: {
            node: {
              comments: connection,
            },
          },
        },
      };
    }

    const pages = state.reviewThreadPages;
    const connection = pages
      ? selectConnectionPage(pages, variables.after, "review-threads")
      : {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: state.reviewThreads || [],
        };
    connection.nodes = connection.nodes.map(withInitialThreadComments);

    return {
      body: {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: connection,
            },
          },
        },
      },
    };
  }

  return { body: { message: `${method} ${path} not implemented` }, status: 404 };
}

function applySnapshotHooks() {
  for (const hook of state.snapshotHooks || []) {
    if (hook.used || hook.count !== state.snapshotLoads) {
      continue;
    }
    hook.used = true;
    switch (hook.action) {
      case "pushIssueComment":
        state.issueComments ||= [];
        state.issueComments.push(hook.value);
        break;
      case "removeIssueComment":
        removeIssueComment(hook);
        break;
      case "replaceIssueComment":
        replaceIssueComment(hook);
        break;
      case "pushReviewComment":
        state.reviewComments ||= [];
        state.reviewComments.push(hook.value);
        break;
      case "setPullHead":
        setPullHead(hook);
        break;
      case "setThreadResolved":
        setThreadResolved(hook);
        break;
      case "routeFault":
        enqueueRouteFault(hook);
        break;
    }
  }
}

function nextIso() {
  const value = new Date(state.now).toISOString().replace(".000Z", "Z");
  state.now += 1000;
  return value;
}

function response(value, status = 200, { headers = {}, rawText } = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers || {}).map(([name, headerValue]) => [
      name.toLowerCase(),
      String(headerValue),
    ]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText(status),
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name).toLowerCase()) ?? null;
      },
    },
    async text() {
      if (rawText !== undefined) {
        return String(rawText);
      }
      return value === undefined ? "" : JSON.stringify(value);
    },
  };
}

function save() {
  if (statePath) {
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
}

function statusText(status) {
  return status >= 200 && status < 300 ? "OK" : "Error";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRequestBody(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    value = String(value);
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function paginateCollection(values, query = {}) {
  const page = positiveInteger(query.page, 1);
  const perPage = positiveInteger(query.per_page, 30);
  const start = (page - 1) * perPage;
  return values.slice(start, start + perPage);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function commitStatusesFor(sha) {
  const explicit = state.commitStatuses;
  if (Array.isArray(explicit)) {
    const matching = explicit.filter((entry) => !entry?.sha || entry.sha === sha);
    return [
      ...postedCommitStatusesFor(sha),
      ...matching.map((entry, index) => normalizeCommitStatus(entry, sha, index + 1)),
    ];
  }
  if (explicit && typeof explicit === "object" && Object.hasOwn(explicit, sha)) {
    const configured = explicit[sha];
    const entries = Array.isArray(configured) ? configured : configured?.statuses || [];
    return entries.map((entry, index) => normalizeCommitStatus(entry, sha, index + 1));
  }

  return postedCommitStatusesFor(sha);
}

function postedCommitStatusesFor(sha) {
  return (state.statuses || [])
    .map((entry, index) => ({ entry, id: index + 1 }))
    .filter(({ entry }) => entry.sha === sha)
    .reverse()
    .map(({ entry, id }) => normalizeCommitStatus(entry, sha, id));
}

function normalizeCommitStatus(entry, sha, id) {
  if (entry?.body && typeof entry.body === "object") {
    return {
      id: entry.id ?? id,
      sha: entry.sha ?? sha,
      ...entry.body,
    };
  }
  return {
    id: entry?.id ?? id,
    sha: entry?.sha ?? sha,
    ...(entry || {}),
  };
}

function selectConnectionPage(rawPages, after, cursorPrefix) {
  const pages = Array.isArray(rawPages) ? rawPages : rawPages?.pages || [];
  const normalized = pages.map((page, index) =>
    normalizeConnectionPage(page, index, pages.length, cursorPrefix),
  );
  const index = connectionPageIndex(pages, normalized, after, cursorPrefix);
  if (index < 0 || index >= normalized.length) {
    return {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [],
    };
  }
  return normalized[index];
}

function normalizeConnectionPage(page, index, pageCount, cursorPrefix) {
  let nodes;
  let pageInfo;
  if (Array.isArray(page)) {
    nodes = page;
    pageInfo = {};
  } else if (page && typeof page === "object" && Array.isArray(page.nodes)) {
    nodes = page.nodes;
    pageInfo = page.pageInfo || {};
  } else {
    nodes = page ? [page] : [];
    pageInfo = {};
  }

  const hasNextPage = pageInfo.hasNextPage ?? index < pageCount - 1;
  return {
    pageInfo: {
      ...pageInfo,
      hasNextPage,
      endCursor:
        pageInfo.endCursor !== undefined && (pageInfo.endCursor !== null || !hasNextPage)
          ? pageInfo.endCursor
          : hasNextPage
            ? `${cursorPrefix}:${index + 1}`
            : null,
    },
    nodes,
  };
}

function connectionPageIndex(rawPages, normalizedPages, after, cursorPrefix) {
  if (after === undefined || after === null) {
    return 0;
  }
  for (let index = 1; index < normalizedPages.length; index += 1) {
    const rawPage = rawPages[index];
    if (rawPage?.after === after || normalizedPages[index - 1].pageInfo.endCursor === after) {
      return index;
    }
  }
  const match = String(after).match(
    new RegExp(`^${escapeRegExp(cursorPrefix)}:(\\d+)$`),
  );
  return match ? Number(match[1]) : -1;
}

function threadCommentPagesFor(threadId) {
  const configured = state.threadCommentPages;
  if (!configured) {
    return null;
  }
  if (!Array.isArray(configured)) {
    return configured[threadId] ?? null;
  }

  const entry = configured.find((candidate) => String(candidate?.threadId) === threadId);
  if (entry) {
    return entry.pages || entry.comments || [];
  }
  const looksLikeDirectPages = configured.every(
    (candidate) =>
      Array.isArray(candidate) ||
      (candidate &&
        typeof candidate === "object" &&
        (Array.isArray(candidate.nodes) || candidate.pageInfo)),
  );
  return looksLikeDirectPages ? configured : null;
}

function withInitialThreadComments(thread) {
  const pages = threadCommentPagesFor(String(thread.id));
  return {
    ...thread,
    comments: pages
      ? selectConnectionPage(pages, null, `thread-${thread.id}-comments`)
      : {
          ...(thread.comments || {}),
          pageInfo: thread.comments?.pageInfo || {
            hasNextPage: false,
            endCursor: null,
          },
          nodes: thread.comments?.nodes || [],
        },
  };
}

function fallbackThreadComments(threadId) {
  const thread = allReviewThreads().find((candidate) => String(candidate?.id) === threadId);
  return (
    {
      ...(thread?.comments || {}),
      pageInfo: thread?.comments?.pageInfo || {
        hasNextPage: false,
        endCursor: null,
      },
      nodes: thread?.comments?.nodes || [],
    }
  );
}

function allReviewThreads() {
  const threads = [...(state.reviewThreads || [])];
  const pages = Array.isArray(state.reviewThreadPages)
    ? state.reviewThreadPages
    : state.reviewThreadPages?.pages || [];
  for (const page of pages) {
    if (Array.isArray(page)) {
      threads.push(...page);
    } else if (Array.isArray(page?.nodes)) {
      threads.push(...page.nodes);
    } else if (page) {
      threads.push(page);
    }
  }
  return threads;
}

function consumeRouteFault(method, path, search) {
  const routeFaults = state.routeFaults;
  if (!routeFaults || typeof routeFaults !== "object") {
    return null;
  }

  const routeWithQuery = `${path}${search}`;
  const keys = [
    `${method} ${routeWithQuery}`,
    routeWithQuery,
    `${method} ${path}`,
    path,
  ];
  for (const key of keys) {
    const queue = routeFaults[key];
    if (!Array.isArray(queue) || queue.length === 0) {
      continue;
    }
    const fault = queue.shift();
    return typeof fault === "number" ? { status: fault } : fault || {};
  }
  return null;
}

function removeIssueComment(hook) {
  const id = issueCommentHookId(hook);
  const index = (state.issueComments || []).findIndex(
    (comment) => String(comment.id) === String(id),
  );
  if (index >= 0) {
    state.issueComments.splice(index, 1);
  }
}

function replaceIssueComment(hook) {
  const replacement = hook.replacement ?? hook.value;
  const id = hook.id ?? hook.commentId ?? replacement?.id;
  const index = (state.issueComments || []).findIndex(
    (comment) => String(comment.id) === String(id),
  );
  if (index >= 0) {
    state.issueComments[index] =
      replacement && typeof replacement === "object"
        ? { ...state.issueComments[index], ...replacement }
        : replacement;
  }
}

function issueCommentHookId(hook) {
  if (hook.id !== undefined) {
    return hook.id;
  }
  if (hook.commentId !== undefined) {
    return hook.commentId;
  }
  return hook.value?.id ?? hook.value;
}

function setPullHead(hook) {
  const value = hook.value;
  const sha =
    hook.sha ??
    hook.headSha ??
    (typeof value === "string" ? value : value?.sha ?? value?.headSha);
  if (sha !== undefined && state.pullRequest) {
    state.pullRequest.head ||= {};
    state.pullRequest.head.sha = sha;
  }
}

function setThreadResolved(hook) {
  const value = hook.value;
  const threadId = hook.threadId ?? hook.id ?? value?.id ?? value?.threadId;
  const isResolved =
    hook.isResolved ??
    hook.resolved ??
    (typeof value === "boolean" ? value : value?.isResolved ?? true);
  for (const thread of allReviewThreads()) {
    if (String(thread?.id) === String(threadId)) {
      thread.isResolved = isResolved;
    }
  }
}

function enqueueRouteFault(hook) {
  const value = hook.value;
  const method = hook.method ?? value?.method;
  const path = hook.path ?? value?.path;
  const route =
    hook.route ??
    hook.key ??
    value?.route ??
    value?.key ??
    (path ? `${method ? `${method} ` : ""}${path}` : null);
  if (!route) {
    return;
  }

  let faults = hook.faults ?? value?.faults ?? hook.fault ?? value?.fault;
  if (faults === undefined) {
    if (value && typeof value === "object") {
      const { method: _method, path: _path, route: _route, ...fault } = value;
      faults = fault;
    } else {
      const {
        action: _action,
        count: _count,
        used: _used,
        method: _method,
        path: _path,
        route: _route,
        key: _key,
        value: _value,
        ...fault
      } = hook;
      faults = Object.keys(fault).length > 0 ? fault : value;
    }
  }
  state.routeFaults ||= {};
  state.routeFaults[route] ||= [];
  state.routeFaults[route].push(...(Array.isArray(faults) ? faults : [faults]));
}

function decodePathComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
