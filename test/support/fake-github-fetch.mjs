import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.FAKE_GITHUB_STATE_PATH;
let state = statePath ? JSON.parse(readFileSync(statePath, "utf8")) : null;

if (statePath) {
  Date.now = () => state.now;

  globalThis.fetch = async function fakeFetch(input, options = {}) {
    const url = new URL(String(input));
    const method = options.method || "GET";
    const path = url.pathname;
    const body = options.body ? JSON.parse(String(options.body)) : null;

    try {
      const result = handle({ method, path, body });
      save();
      return response(result.body, result.status || 200);
    } catch (error) {
      save();
      return response({ message: error.stack || error.message }, 500);
    }
  };

  process.on("exit", save);
}

function handle({ method, path, body }) {
  const repoBase = `/repos/${state.owner}/${state.repo}`;
  const prNumber = state.prNumber;

  if (method === "GET" && path === `${repoBase}/pulls`) {
    return { body: [state.pullRequest] };
  }

  if (method === "GET" && path === `${repoBase}/pulls/${prNumber}`) {
    state.pullLoads += 1;
    return { body: state.pullRequest };
  }

  if (method === "GET" && path === `${repoBase}/issues/${prNumber}/comments`) {
    state.snapshotLoads += 1;
    applySnapshotHooks();
    return { body: state.issueComments };
  }

  if (method === "GET" && path === `${repoBase}/issues/${prNumber}/reactions`) {
    return { body: state.issueReactions };
  }

  if (method === "GET" && path === `${repoBase}/pulls/${prNumber}/comments`) {
    return { body: state.reviewComments };
  }

  if (method === "GET" && path === `${repoBase}/pulls/${prNumber}/reviews`) {
    return { body: state.reviews };
  }

  const commentReactionsMatch = path.match(
    new RegExp(`^${escapeRegExp(repoBase)}/issues/comments/(\\d+)/reactions$`),
  );
  if (method === "GET" && commentReactionsMatch) {
    return { body: state.commentReactions[commentReactionsMatch[1]] || [] };
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

  const statusMatch = path.match(new RegExp(`^${escapeRegExp(repoBase)}/statuses/(.+)$`));
  if (method === "POST" && statusMatch) {
    state.statuses.push({
      sha: decodeURIComponent(statusMatch[1]),
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

    return {
      body: {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: state.reviewThreads,
              },
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
    if (hook.action === "pushReviewComment") {
      state.reviewComments.push(hook.value);
    }
  }
}

function nextIso() {
  const value = new Date(state.now).toISOString().replace(".000Z", "Z");
  state.now += 1000;
  return value;
}

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText(status),
    headers: {
      get() {
        return null;
      },
    },
    async text() {
      return JSON.stringify(value);
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
