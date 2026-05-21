import { invoke } from "@tauri-apps/api/core";

type JsonRecord = Record<string, unknown>;

const originalFetch = window.fetch.bind(window);
const isTauriRuntime = "__TAURI_INTERNALS__" in window;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const readJsonBody = async (init?: RequestInit): Promise<JsonRecord> => {
  if (!init?.body || typeof init.body !== "string") return {};
  return JSON.parse(init.body) as JsonRecord;
};

const invokeJson = async (command: string, args?: JsonRecord) => {
  try {
    const data = await invoke(command, args);
    return jsonResponse(data);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
};

if (isTauriRuntime) {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(rawUrl, window.location.origin);

    if (!url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    const body = await readJsonBody(init);
    const query = url.searchParams;

    switch (url.pathname) {
      case "/api/git/status":
        return invokeJson("git_status");
      case "/api/git/open":
        return invokeJson("git_open_repository", { path: body.path });
      case "/api/git/init":
        return invokeJson("git_init", { path: body.path });
      case "/api/git/clone":
        return invokeJson("git_clone", { repoUrl: body.repoUrl, targetPath: body.targetPath });
      case "/api/git/wipe":
        return invokeJson("git_wipe");
      case "/api/git/identity":
        return invokeJson("git_identity");
      case "/api/git/identity/set":
        return invokeJson("git_set_identity", { userName: body.userName, userEmail: body.userEmail });
      case "/api/git/stage":
        return invokeJson("git_stage", { file: body.file });
      case "/api/git/unstage":
        return invokeJson("git_unstage", { file: body.file });
      case "/api/git/commit":
        return invokeJson("git_commit", { message: body.message });
      case "/api/git/log":
        return invokeJson("git_log", {
          limit: Number(query.get("limit") || 300),
          skip: Number(query.get("skip") || 0),
          allBranches: query.get("allBranches") !== "false",
        });
      case "/api/git/diff":
        return invokeJson("git_diff", {
          file: query.get("file") || "",
          staged: query.get("staged") === "true",
          commit: query.get("commit") || undefined,
        });
      case "/api/git/branches":
        return invokeJson("git_branches");
      case "/api/git/branch/create":
        return invokeJson("git_branch_create", { name: body.name });
      case "/api/git/branch/checkout":
        return invokeJson("git_branch_checkout", { name: body.name });
      case "/api/git/branch/merge":
        return invokeJson("git_branch_merge", { name: body.name });
      case "/api/git/history":
        return invokeJson("git_history");
      case "/api/git/reset":
        return invokeJson("git_reset", { commit: body.commit, mode: body.mode });
      case "/api/git/revert":
        return invokeJson("git_revert", { commit: body.commit });
      case "/api/sandbox/files":
        return invokeJson("sandbox_files");
      case "/api/sandbox/files/write":
        return invokeJson("sandbox_file_write", { filePath: body.filePath, content: body.content });
      case "/api/sandbox/files/read":
        return invokeJson("sandbox_file_read", { filePath: query.get("filePath") || "" });
      case "/api/sandbox/files/delete":
        return invokeJson("sandbox_file_delete", { filePath: body.filePath });
      case "/api/git/stash":
        return invokeJson("git_stash");
      case "/api/git/stash/save":
        return invokeJson("git_stash_save", { message: body.message });
      case "/api/git/stash/pop":
        return invokeJson("git_stash_pop");
      case "/api/git/ai/commit-message":
        return invokeJson("git_ai_commit_message");
      case "/api/git/ai/explain-diff":
        return invokeJson("git_ai_explain_diff", { file: body.file, staged: body.staged });
      default:
        return jsonResponse({ error: `Unknown API route: ${url.pathname}` }, 404);
    }
  };
}
