use chrono::Local;
use serde::Serialize;
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::{Manager, State};
use ignore::WalkBuilder;

mod ai;
mod ai_settings;

#[derive(Debug, Serialize, Clone)]
struct CommandLog {
    timestamp: String,
    command: String,
    code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
struct CommandResult {
    stdout: String,
    stderr: String,
    code: i32,
}

struct AppState {
    repo_path: Mutex<Option<PathBuf>>,
    git_history: Mutex<Vec<CommandLog>>,
}

#[derive(Debug, Serialize)]
struct GitStatusResponse {
    initialized: bool,
    #[serde(rename = "currentBranch")]
    current_branch: String,
    #[serde(rename = "workspacePath")]
    workspace_path: Option<String>,
    files: Vec<GitFile>,
}

#[derive(Debug, Serialize)]
struct GitFile {
    path: String,
    status: String,
    x: String,
    y: String,
    staged: bool,
    modified: bool,
    #[serde(rename = "displayStatus")]
    display_status: String,
}

#[derive(Debug, Serialize)]
struct CommitNode {
    hash: String,
    parents: Vec<String>,
    author: String,
    date: String,
    message: String,
}

#[derive(Debug, Serialize)]
struct Branch {
    name: String,
    #[serde(rename = "isCurrent")]
    is_current: bool,
}

#[derive(Debug, Serialize)]
struct StashItem {
    line: String,
}

#[derive(Debug, Serialize)]
struct GitIdentity {
    #[serde(rename = "userName")]
    user_name: String,
    #[serde(rename = "userEmail")]
    user_email: String,
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| err.to_string())
}

fn is_git_repo(path: &Path) -> bool {
    path.join(".git").exists()
}

fn log_command(state: &State<'_, AppState>, command: String, code: i32, stdout: String, stderr: String) {
    let mut history = state.git_history.lock().expect("git history mutex poisoned");
    history.insert(
        0,
        CommandLog {
            timestamp: Local::now().format("%H:%M:%S").to_string(),
            command,
            code,
            stdout,
            stderr,
        },
    );
    if history.len() > 50 {
        history.pop();
    }
}

fn quote_arg(arg: &str) -> String {
    if arg.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:=@".contains(c)) {
        arg.to_string()
    } else {
        format!("{arg:?}")
    }
}

fn current_repo_path(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    state
        .repo_path
        .lock()
        .expect("repo path mutex poisoned")
        .clone()
        .ok_or_else(|| "No repository is open.".to_string())
}

fn set_repo_path(state: &State<'_, AppState>, path: PathBuf) {
    *state.repo_path.lock().expect("repo path mutex poisoned") = Some(path);
}

fn clear_repo_path(state: &State<'_, AppState>) {
    *state.repo_path.lock().expect("repo path mutex poisoned") = None;
}

fn run_process(state: &State<'_, AppState>, program: &str, args: &[&str], cwd: &Path) -> Result<CommandResult, String> {
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|err| format!("Failed to run git: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let code = output.status.code().unwrap_or(1);
    let command = format!(
        "{program} {}",
        args.iter().map(|arg| quote_arg(arg)).collect::<Vec<_>>().join(" ")
    );
    log_command(state, command, code, stdout.clone(), stderr.clone());
    Ok(CommandResult { stdout, stderr, code })
}

fn run_git(state: &State<'_, AppState>, args: &[&str]) -> Result<CommandResult, String> {
    let repo_path = current_repo_path(state)?;
    run_process(state, "git", args, &repo_path)
}

fn safe_repo_path(base: &Path, file_path: &str) -> Result<PathBuf, String> {
    let base = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let target = base.join(file_path);
    let parent = target.parent().unwrap_or(&base);
    let canonical_parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
    if !canonical_parent.starts_with(&base) {
        return Err("Access outside repository forbidden".to_string());
    }
    Ok(target)
}

fn git_error(result: CommandResult, fallback: &str) -> Result<CommandResult, String> {
    if result.code == 0 {
        Ok(result)
    } else {
        Err(if result.stderr.is_empty() { fallback.to_string() } else { result.stderr })
    }
}

#[tauri::command]
async fn git_status(state: State<'_, AppState>) -> Result<GitStatusResponse, String> {
    let repo_path = match current_repo_path(&state) {
        Ok(path) => path,
        Err(_) => {
            return Ok(GitStatusResponse {
                initialized: false,
                current_branch: "none".to_string(),
                workspace_path: None,
                files: vec![],
            });
        }
    };
    if !is_git_repo(&repo_path) {
        return Ok(GitStatusResponse {
            initialized: false,
            current_branch: "none".to_string(),
            workspace_path: Some(repo_path.to_string_lossy().to_string()),
            files: vec![],
        });
    }

    let branch_res = run_git(&state, &["branch", "--show-current"])?;
    let current_branch = if branch_res.code == 0 && !branch_res.stdout.is_empty() {
        branch_res.stdout
    } else {
        let rev_res = run_git(&state, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        if rev_res.code == 0 && !rev_res.stdout.is_empty() {
            rev_res.stdout
        } else {
            "main".to_string()
        }
    };

    let status_res = run_git(&state, &["status", "--porcelain"])?;
    let files = status_res
        .stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let x = line.chars().next().unwrap_or(' ').to_string();
            let y = line.chars().nth(1).unwrap_or(' ').to_string();
            let mut file_path = line.get(3..).unwrap_or("").trim().to_string();
            if let Some((_, new_path)) = file_path.split_once(" -> ") {
                file_path = new_path.trim().to_string();
            }
            let staged = x != " " && x != "?";
            let modified = y != " " || x == "?";
            let display_status = if x == "?" && y == "?" {
                "Untracked"
            } else if x == "A" {
                "Added"
            } else if x == "D" || y == "D" {
                "Deleted"
            } else if x == "U" || y == "U" {
                "Conflict"
            } else if staged && modified {
                "Partially Staged"
            } else if staged {
                "Staged"
            } else {
                "Modified"
            };
            GitFile {
                path: file_path,
                status: line.get(0..2).unwrap_or("").to_string(),
                x,
                y,
                staged,
                modified,
                display_status: display_status.to_string(),
            }
        })
        .collect();

    Ok(GitStatusResponse {
        initialized: true,
        current_branch,
        workspace_path: Some(repo_path.to_string_lossy().to_string()),
        files,
    })
}

#[tauri::command]
async fn git_open_repository(state: State<'_, AppState>, path: String) -> Result<serde_json::Value, String> {
    let repo_path = PathBuf::from(path.trim()).canonicalize().map_err(|err| err.to_string())?;
    if !repo_path.is_dir() {
        return Err("Repository path must be a directory.".to_string());
    }
    let result = run_process(&state, "git", &["rev-parse", "--show-toplevel"], &repo_path)?;
    if result.code != 0 {
        return Err(if result.stderr.is_empty() { "Selected folder is not a Git repository.".to_string() } else { result.stderr });
    }
    let top_level = PathBuf::from(result.stdout.trim()).canonicalize().unwrap_or(repo_path);
    set_repo_path(&state, top_level.clone());
    Ok(json!({ "success": true, "workspacePath": top_level.to_string_lossy().to_string() }))
}

#[tauri::command]
async fn git_init(state: State<'_, AppState>, path: String) -> Result<serde_json::Value, String> {
    let repo_path = PathBuf::from(path.trim());
    ensure_dir(&repo_path)?;
    let repo_path = repo_path.canonicalize().map_err(|err| err.to_string())?;
    let result = run_process(&state, "git", &["init", "-b", "main"], &repo_path)?;
    if result.code != 0 {
        git_error(run_process(&state, "git", &["init"], &repo_path)?, "Failed to initialize repository")?;
    }
    set_repo_path(&state, repo_path.clone());
    Ok(json!({ "success": true, "message": "Initialized local repository.", "workspacePath": repo_path.to_string_lossy().to_string() }))
}

#[tauri::command]
async fn git_wipe(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    clear_repo_path(&state);
    Ok(json!({ "success": true, "message": "Repository closed." }))
}

#[tauri::command]
async fn git_identity(state: State<'_, AppState>) -> Result<GitIdentity, String> {
    let name = run_git(&state, &["config", "--get", "user.name"])?.stdout;
    let email = run_git(&state, &["config", "--get", "user.email"])?.stdout;
    Ok(GitIdentity {
        user_name: name,
        user_email: email,
    })
}

#[tauri::command]
async fn git_set_identity(state: State<'_, AppState>, user_name: String, user_email: String) -> Result<serde_json::Value, String> {
    if user_name.trim().is_empty() {
        let _ = run_git(&state, &["config", "--unset", "user.name"])?;
    } else {
        git_error(run_git(&state, &["config", "user.name", user_name.trim()])?, "Failed to set user.name")?;
    }

    if user_email.trim().is_empty() {
        let _ = run_git(&state, &["config", "--unset", "user.email"])?;
    } else {
        git_error(run_git(&state, &["config", "user.email", user_email.trim()])?, "Failed to set user.email")?;
    }

    Ok(json!({ "success": true, "message": "Git identity updated." }))
}

#[tauri::command]
async fn git_clone(state: State<'_, AppState>, repo_url: String, target_path: String) -> Result<serde_json::Value, String> {
    if !repo_url.starts_with("https://") {
        return Err("Invalid repository URL. Please provide a valid public HTTPS clone URL.".to_string());
    }
    let target = PathBuf::from(target_path.trim());
    if target.as_os_str().is_empty() {
        return Err("Local target folder is required.".to_string());
    }
    if target.exists() {
        if !target.is_dir() {
            return Err("Target path already exists and is not a folder.".to_string());
        }
        if target.read_dir().map_err(|err| err.to_string())?.next().is_some() {
            return Err("Target folder already exists and is not empty.".to_string());
        }
    }
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    ensure_dir(parent)?;
    let target_arg = target.to_string_lossy().to_string();
    git_error(run_process(&state, "git", &["clone", &repo_url, &target_arg], parent)?, "Clone failed")?;
    let repo_path = target.canonicalize().map_err(|err| err.to_string())?;
    set_repo_path(&state, repo_path.clone());
    Ok(json!({ "success": true, "message": "Repository cloned successfully.", "workspacePath": repo_path.to_string_lossy().to_string() }))
}

#[tauri::command]
async fn git_stage(state: State<'_, AppState>, file: Option<String>) -> Result<serde_json::Value, String> {
    let file = file.unwrap_or_else(|| ".".to_string());
    git_error(run_git(&state, &["add", &file])?, "Failed to stage")?;
    Ok(json!({ "success": true, "message": format!("Staged {file}") }))
}

#[tauri::command]
async fn git_unstage(state: State<'_, AppState>, file: Option<String>) -> Result<serde_json::Value, String> {
    let file = file.unwrap_or_else(|| ".".to_string());
    if file == "." {
        git_error(run_git(&state, &["reset", "HEAD"])?, "Failed to unstage")?;
    } else {
        git_error(run_git(&state, &["reset", "HEAD", "--", &file])?, "Failed to unstage")?;
    }
    Ok(json!({ "success": true, "message": format!("Unstaged {file}") }))
}

#[tauri::command]
async fn git_commit(state: State<'_, AppState>, message: String) -> Result<serde_json::Value, String> {
    if message.trim().is_empty() {
        return Err("Commit message is required".to_string());
    }
    let result = git_error(run_git(&state, &["commit", "-m", message.trim()])?, "No changes to commit")?;
    Ok(json!({ "success": true, "message": result.stdout }))
}

#[tauri::command]
async fn git_log(state: State<'_, AppState>, limit: Option<usize>, skip: Option<usize>, all_branches: Option<bool>) -> Result<serde_json::Value, String> {
    let repo_path = match current_repo_path(&state) {
        Ok(path) => path,
        Err(_) => return Ok(json!({ "commits": Vec::<CommitNode>::new() })),
    };
    if !is_git_repo(&repo_path) {
        return Ok(json!({ "commits": Vec::<CommitNode>::new() }));
    }
    let limit = limit.unwrap_or(300).clamp(1, 2000);
    let skip = skip.unwrap_or(0);
    let max_count = format!("--max-count={}", limit + 1);
    let skip_arg = format!("--skip={skip}");
    let mut args = vec![
        "log",
        "--topo-order",
        "--decorate=short",
        "--pretty=format:%h|%p|%an|%ad|%s",
        "--date=format-local:%Y-%m-%d %H:%M",
        max_count.as_str(),
        skip_arg.as_str(),
    ];
    if all_branches.unwrap_or(true) {
        args.insert(1, "--all");
    }
    let log_res = run_git(&state, &args)?;
    if log_res.code != 0 {
        return Ok(json!({ "commits": Vec::<CommitNode>::new() }));
    }
    let mut commits = log_res
        .stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<_> = line.split('|').collect();
            CommitNode {
                hash: parts.first().unwrap_or(&"").trim().to_string(),
                parents: parts.get(1).unwrap_or(&"").split_whitespace().map(String::from).collect(),
                author: parts.get(2).unwrap_or(&"").trim().to_string(),
                date: parts.get(3).unwrap_or(&"").trim().to_string(),
                message: parts.get(4).unwrap_or(&"").trim().to_string(),
            }
        })
        .collect::<Vec<_>>();
    let has_more = commits.len() > limit;
    if has_more {
        commits.truncate(limit);
    }
    Ok(json!({ "commits": commits, "hasMore": has_more }))
}

#[tauri::command]
async fn git_diff(state: State<'_, AppState>, file: String, staged: Option<bool>, commit: Option<String>) -> Result<serde_json::Value, String> {
    let result = if let Some(commit) = commit {
        run_git(&state, &["show", &commit, "--", &file])?
    } else if staged.unwrap_or(false) {
        run_git(&state, &["diff", "--cached", "--", &file])?
    } else {
        run_git(&state, &["diff", "--", &file])?
    };
    Ok(json!({ "diff": if result.stdout.is_empty() { result.stderr } else { result.stdout } }))
}

#[tauri::command]
async fn git_branches(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let repo_path = match current_repo_path(&state) {
        Ok(path) => path,
        Err(_) => return Ok(json!({ "branches": Vec::<Branch>::new() })),
    };
    if !is_git_repo(&repo_path) {
        return Ok(json!({ "branches": Vec::<Branch>::new() }));
    }
    let branches_res = run_git(&state, &["branch"])?;
    if branches_res.code != 0 {
        return Ok(json!({ "branches": [{ "name": "main", "isCurrent": true }] }));
    }
    let branches = branches_res
        .stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let is_current = line.starts_with('*');
            let name = line.trim_start_matches('*').trim().to_string();
            Branch { name, is_current }
        })
        .collect::<Vec<_>>();
    Ok(json!({ "branches": branches }))
}

#[tauri::command]
async fn git_branch_create(state: State<'_, AppState>, name: String) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("Branch name is required".to_string());
    }
    git_error(run_git(&state, &["branch", name.trim()])?, "Failed to create branch")?;
    Ok(json!({ "success": true, "message": format!("Created branch {}", name.trim()) }))
}

#[tauri::command]
async fn git_branch_checkout(state: State<'_, AppState>, name: String) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("Branch name is required".to_string());
    }
    let result = git_error(run_git(&state, &["checkout", name.trim()])?, "Checkout error")?;
    let message = if result.stdout.is_empty() { format!("Switched to branch {}", name.trim()) } else { result.stdout };
    Ok(json!({ "success": true, "message": message }))
}

#[tauri::command]
async fn git_branch_merge(state: State<'_, AppState>, name: String) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("Branch name is required".to_string());
    }
    let active = run_git(&state, &["branch", "--show-current"])?.stdout;
    let active = if active.is_empty() { "current".to_string() } else { active };
    let message = format!("Merge branch '{}' into {active}", name.trim());
    let result = run_git(&state, &["merge", "--no-ff", name.trim(), "-m", &message])?;
    if result.code != 0 {
        return Ok(json!({
            "success": false,
            "conflict": true,
            "message": if result.stderr.is_empty() { result.stdout } else { result.stderr }
        }));
    }
    Ok(json!({ "success": true, "conflict": false, "message": result.stdout }))
}

#[tauri::command]
async fn git_history(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let history = state.git_history.lock().expect("git history mutex poisoned").clone();
    Ok(json!({ "history": history }))
}

#[tauri::command]
async fn git_reset(state: State<'_, AppState>, commit: String, mode: Option<String>) -> Result<serde_json::Value, String> {
    if commit.trim().is_empty() {
        return Err("Commit hash is required".to_string());
    }
    let reset_mode = if mode.as_deref() == Some("soft") { "--soft" } else { "--hard" };
    git_error(run_git(&state, &["reset", reset_mode, commit.trim()])?, "Reset command failed")?;
    Ok(json!({ "success": true, "message": format!("Successfully reset to commit {} with {reset_mode}!", commit.trim()) }))
}

#[tauri::command]
async fn git_revert(state: State<'_, AppState>, commit: String) -> Result<serde_json::Value, String> {
    if commit.trim().is_empty() {
        return Err("Commit hash is required".to_string());
    }
    git_error(run_git(&state, &["revert", commit.trim(), "--no-edit"])?, "Revert command failed")?;
    Ok(json!({ "success": true, "message": format!("Successfully reverted commit {}!", commit.trim()) }))
}

#[tauri::command]
async fn sandbox_files(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let repo_path = match current_repo_path(&state) {
        Ok(path) => path,
        Err(_) => return Ok(json!({ "files": Vec::<String>::new() })),
    };
    // Safety cap so a repo without a .gitignore (e.g. a checked-in node_modules)
    // can't flood the UI with a giant array and freeze the renderer.
    const MAX_FILES: usize = 5000;

    let mut files = Vec::new();
    let mut truncated = false;
    // WalkBuilder honors .gitignore / .ignore / global gitignore and skips hidden
    // entries (including .git) by default, so ignored/derived dirs like node_modules
    // are never descended into.
    let walker = WalkBuilder::new(&repo_path).build();
    for entry in walker.filter_map(Result::ok) {
        let path = entry.path();
        if path == repo_path {
            continue;
        }
        if entry.file_type().map_or(false, |ft| ft.is_file()) {
            files.push(path.strip_prefix(&repo_path).map_err(|err| err.to_string())?.to_string_lossy().to_string());
            if files.len() >= MAX_FILES {
                truncated = true;
                break;
            }
        }
    }
    files.sort();
    Ok(json!({ "files": files, "truncated": truncated }))
}

#[tauri::command]
async fn sandbox_file_write(state: State<'_, AppState>, file_path: String, content: Option<String>) -> Result<serde_json::Value, String> {
    let repo_path = current_repo_path(&state)?;
    let target = safe_repo_path(&repo_path, &file_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&target, content.unwrap_or_default()).map_err(|err| err.to_string())?;
    Ok(json!({ "success": true, "message": format!("Successfully wrote file {file_path}") }))
}

#[tauri::command]
async fn sandbox_file_read(state: State<'_, AppState>, file_path: String) -> Result<serde_json::Value, String> {
    let repo_path = current_repo_path(&state)?;
    let target = safe_repo_path(&repo_path, &file_path)?;
    if !target.exists() {
        return Err("File not found".to_string());
    }
    let content = fs::read_to_string(&target).map_err(|err| err.to_string())?;
    Ok(json!({ "content": content }))
}

#[tauri::command]
async fn sandbox_file_delete(state: State<'_, AppState>, file_path: String) -> Result<serde_json::Value, String> {
    let repo_path = current_repo_path(&state)?;
    let target = safe_repo_path(&repo_path, &file_path)?;
    if !target.exists() {
        return Err("File not found".to_string());
    }
    fs::remove_file(&target).map_err(|err| err.to_string())?;
    Ok(json!({ "success": true, "message": format!("Deleted {file_path}") }))
}

#[tauri::command]
async fn git_stash(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let repo_path = match current_repo_path(&state) {
        Ok(path) => path,
        Err(_) => return Ok(json!({ "stashes": Vec::<StashItem>::new() })),
    };
    if !is_git_repo(&repo_path) {
        return Ok(json!({ "stashes": Vec::<StashItem>::new() }));
    }
    let result = run_git(&state, &["stash", "list"])?;
    if result.code != 0 {
        return Ok(json!({ "stashes": Vec::<StashItem>::new() }));
    }
    let stashes = result.stdout.lines().filter(|line| !line.is_empty()).map(|line| StashItem { line: line.to_string() }).collect::<Vec<_>>();
    Ok(json!({ "stashes": stashes }))
}

#[tauri::command]
async fn git_stash_save(state: State<'_, AppState>, message: Option<String>) -> Result<serde_json::Value, String> {
    let result = if let Some(message) = message.filter(|msg| !msg.trim().is_empty()) {
        run_git(&state, &["stash", "push", "-m", message.trim()])?
    } else {
        run_git(&state, &["stash"])?
    };
    git_error(result, "Stash failed").map(|result| json!({ "success": true, "message": result.stdout }))
}

#[tauri::command]
async fn git_stash_pop(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    git_error(run_git(&state, &["stash", "pop"])?, "Stash pop failed").map(|result| json!({ "success": true, "message": result.stdout }))
}

#[tauri::command]
async fn git_ai_commit_message(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let diff = run_git(&state, &["diff", "--cached"])?.stdout;
    if diff.is_empty() {
        return Ok(json!({ "message": "", "error": "No changes are staged! Stage some modifications first to let AI generate a message." }));
    }
    let cfg = ai_settings::load()?;
    let prompt = format!("You are an expert Git GUI assistant. Analyze the following cached/staged git diff and write a beautifully structured Conventional Commit message (e.g., 'feat(auth): add login validation' or 'fix(calculator): resolve division by zero').\nVerify that the message represents only the actual modifications in the code. Keep it brief (ideally under 72 characters for the header). Include bullet points below if there are multiple substantial changes.\n\nDo not include markdown code block formatting--just return the plain text commit message.\n\nStaged Diff:\n{diff}");
    let message = ai::ai_generate(
        cfg.provider,
        &cfg.model,
        cfg.api_key.as_deref(),
        cfg.endpoint.as_deref(),
        &prompt,
        Some("You are a professional commit analyst that writes Conventional Commit messages based on code diffs."),
    )
    .await?;
    Ok(json!({ "message": if message.is_empty() { "feat: update files".to_string() } else { message } }))
}

#[tauri::command]
async fn git_ai_explain_diff(state: State<'_, AppState>, file: String, staged: Option<bool>) -> Result<serde_json::Value, String> {
    if file.trim().is_empty() {
        return Err("file is required".to_string());
    }
    let diff = if staged.unwrap_or(false) {
        run_git(&state, &["diff", "--cached", "--", &file])?.stdout
    } else {
        run_git(&state, &["diff", "--", &file])?.stdout
    };
    if diff.is_empty() {
        return Ok(json!({ "explanation": "No dynamic differences detected on this file." }));
    }
    let cfg = ai_settings::load()?;
    let prompt = format!("As a senior software architect, analyze this diff from git on file \"{file}\" and explain the code changes in incredibly simple, scannable human terms.\nDetail the logical modifications, point out what was added or removed, and explain why this change would be made. Feel free to use brief markdown formatting with bolding or bullet points.\nKeep the answer concise and highly readable.\n\nGit Diff:\n{diff}");
    let explanation = ai::ai_generate(
        cfg.provider,
        &cfg.model,
        cfg.api_key.as_deref(),
        cfg.endpoint.as_deref(),
        &prompt,
        None,
    )
    .await?;
    Ok(json!({ "explanation": if explanation.is_empty() { "No explanation could be compiled.".to_string() } else { explanation } }))
}

#[tauri::command]
async fn ai_settings_get() -> Result<serde_json::Value, String> {
    let cfg = ai_settings::load()?;
    Ok(json!({
        "provider": cfg.provider.as_key_suffix(),
        "model": cfg.model,
        "hasKey": ai_settings::has_key(cfg.provider),
        "endpoint": cfg.endpoint,
    }))
}

#[tauri::command]
async fn ai_settings_provider_state(provider: String) -> Result<serde_json::Value, String> {
    let provider = ai::AiProvider::from_str(&provider)?;
    let (model, has_key, endpoint) = ai_settings::provider_state(provider);
    Ok(json!({ "model": model, "hasKey": has_key, "endpoint": endpoint }))
}

#[tauri::command]
async fn ai_settings_set(
    provider: String,
    model: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<serde_json::Value, String> {
    if model.trim().is_empty() {
        return Err("model must not be empty".to_string());
    }
    let provider = ai::AiProvider::from_str(&provider)?;
    ai_settings::save(provider, &model, api_key.as_deref(), endpoint.as_deref())?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
async fn ai_settings_clear_key(provider: String) -> Result<serde_json::Value, String> {
    let provider = ai::AiProvider::from_str(&provider)?;
    ai_settings::clear_key(provider)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
async fn ai_test_connection() -> Result<serde_json::Value, String> {
    let cfg = ai_settings::load()?;
    match ai::ai_generate(
        cfg.provider,
        &cfg.model,
        cfg.api_key.as_deref(),
        cfg.endpoint.as_deref(),
        "ping",
        Some("Reply with the single word: pong"),
    )
    .await
    {
        Ok(_) => Ok(json!({ "ok": true })),
        Err(message) => Ok(json!({ "ok": false, "message": message })),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AppState {
                repo_path: Mutex::new(None),
                git_history: Mutex::new(Vec::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git_status,
            git_open_repository,
            git_init,
            git_wipe,
            git_identity,
            git_set_identity,
            git_clone,
            git_stage,
            git_unstage,
            git_commit,
            git_log,
            git_diff,
            git_branches,
            git_branch_create,
            git_branch_checkout,
            git_branch_merge,
            git_history,
            git_reset,
            git_revert,
            sandbox_files,
            sandbox_file_write,
            sandbox_file_read,
            sandbox_file_delete,
            git_stash,
            git_stash_save,
            git_stash_pop,
            git_ai_commit_message,
            git_ai_explain_diff,
            ai_settings_get,
            ai_settings_provider_state,
            ai_settings_set,
            ai_settings_clear_key,
            ai_test_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
