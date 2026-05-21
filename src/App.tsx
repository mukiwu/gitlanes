import React, { useState, useEffect } from "react";
import { 
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  GitBranch, 
  GitCommit, 
  Plus, 
  RefreshCw, 
  Check, 
  X, 
  AlertTriangle, 
  File, 
  Sparkles, 
  Inbox, 
  Play, 
  HelpCircle,
  GitPullRequest,
  BookOpen,
  Eye,
  GitMerge,
  Languages,
  Settings,
  Trash2,
  User
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { GitFile, CommitNode, Branch, StashItem } from "./types";
import { GitGraph } from "./components/GitGraph";
import { CodeEditor } from "./components/CodeEditor";
import { DiffViewer } from "./components/DiffViewer";

type Language = "en" | "zh";

interface ManagedRepo {
  path: string;
  name: string;
}

const REPOS_STORAGE_KEY = "gitlanes.repos";
const LANGUAGE_STORAGE_KEY = "gitlanes.language";
const LEGACY_REPOS_STORAGE_KEY = "git-gui.repos";
const LEGACY_LANGUAGE_STORAGE_KEY = "git-gui.language";
const COMMIT_PAGE_SIZE = 300;

const translations = {
  en: {
    appTitle: "GitLanes",
    openRepo: "Open A Git Repository",
    openRepoDescription: "Work with a real local repository, initialize a folder, or clone a remote repository into a local folder.",
    openLocalFolder: "Open Local Repository Folder:",
    open: "Open",
    clone: "Clone",
    init: "Init",
    cloneRepo: "Clone Repository:",
    initFolder: "Initialize Local Folder:",
    targetMustBeEmpty: "Target folder must be empty or not exist yet.",
    orClone: "OR CLONE",
    orInit: "OR INIT",
    repositories: "Repositories",
    noRepositories: "No saved repositories",
    active: "Active",
    removeFromSidebar: "Remove from sidebar",
    switchRepo: "Switch / open repository",
    openNew: "Open / Clone / Init",
    gitIdentity: "Git Identity",
    userName: "user.name",
    userEmail: "user.email",
    saveIdentity: "Save Identity",
    closeRepo: "Close Repository",
    closeRepoTitle: "Close Repository?",
    closeRepoMessage: "This closes the current repository in the app. It will not delete local files or Git history.",
    refresh: "Refresh repository changes",
    checkout: "Checkout:",
    merge: "Merge",
    mergeWith: "Merge with...",
    stageAll: "Stage All",
    unstageAll: "Unstage All",
    workingClean: "Working directory clean",
    editFilesHint: "Edit files or use code modifiers to write new commits.",
    createBranch: "Create New Branch",
    commitment: "Commitment",
    commitChanges: "COMMIT CHANGES",
    terminalReady: "Terminal ready. Execute Git operations in the GUI to stream command telemetry logs here...",
    simulationActive: "Repository Active",
    refreshedAt: "Git Workspace - Refreshed at",
    opened: "Repository opened successfully",
    identitySaved: "Git identity saved.",
    create: "Create",
    indexStageControl: "Index Stage Control",
    unstagedChanges: "Unstaged Changes",
    stagedChanges: "Staged Changes",
    gitStashes: "Git Stashes",
    popStash: "Pop Stash",
    stashPlaceholder: "Stash label message...",
    stash: "Stash",
    geminiSuggestion: "Gemini Suggestion",
    commitPlaceholder: "Write conventional commit message...",
    commitLabel: "Commit",
    closeLog: "Close Log",
    authorLabel: "Author",
    dateLabel: "Date",
    subjectLabel: "Subject Description",
    workspaceActions: "Workspace Actions",
    workspaceTitle: "Workspace",
    emptyFolder: "Empty folder",
    codeEditorTitle: "Workspace Code Editor",
    codeEditorHint: "Select an existing file in the left column or click the + button to write something. Saving updates the file and creates untracked or modified tags.",
    cliHistory: "Git CLI Command History & Output Stream",
    graphTitle: "Interactive Commit History (DAG)",
    graphEmptyTitle: "No commit logs found",
    graphEmptyHint: "Make changes, stage them in the file explorer, and commit with a message on the sidebar to create the first node in this graph.",
    loadMoreCommits: "Load 300 more commits",
    toastFolderPickerError: "Could not open folder picker.",
    toastLoadMoreFailed: "Failed to load more commits.",
    toastOpenRepoFailed: "Open repository failed.",
    toastSaveIdentityFailed: "Failed to save Git identity.",
    toastEnterLocalFolder: "Please enter a local folder path",
    toastInitFailed: "Init failed.",
    toastEnterCloneUrl: "Please enter a valid clone URL",
    toastEnterTargetFolder: "Please enter a local target folder",
    toastCloneFailed: "Failed to clone repository.",
    toastRepoClosed: "Repository closed.",
    toastWipeFailed: "Failed to wipe workspace.",
    toastStagedAll: "Staged all working files",
    toastUnstagedAll: "Unstaged all indexed files",
    toastStashed: "Stashed local modifications",
    toastStashPopped: "Popped latest stash back to workspace",
    toastEnterCommitMessage: "Please enter a commit message",
    toastCommitRecorded: "Commit recorded in repository DAG log!",
    toastCommitFailed: "Failed to commit. Ensure changes are staged.",
    toastNoFilesStaged: "No files staged! Add or stage some modifications first before generating AI messages.",
    toastAiCommitDone: "Gemini compiled a standard conventional commit message based on staged diff changes!",
    toastAiCommitFailed: "Could not generate commit message.",
    toastResetFailed: "Failed to reset.",
    toastRevertFailed: "Failed to revert commit.",
    toastMergeConflict: "MERGE CONFLICT! Auto-merge failed. Please resolve conflicts in staged files.",
    toastStagedFile: (f: string) => `Staged ${f} changes successfully`,
    toastUnstagedFile: (f: string) => `Unstaged ${f} changes`,
    toastBranchCreated: (b: string) => `Branch "${b}" created!`,
    toastSwitchedBranch: (b: string) => `Switched workspace to branch "${b}"`,
    toastMerged: (from: string, to: string) => `Successfully merged "${from}" into "${to}"!`,
    toastResetDone: (mode: string, hash: string) => `Successfully performed git reset ${mode} to ${hash}`,
    toastReverted: (hash: string) => `Successfully reverted commit ${hash}!`,
    toastCheckedOut: (hash: string) => `Successfully checked out HEAD to commit ${hash}`,
    confirmCheckoutTitle: (hash: string) => `Hard Checkout HEAD to Commit ${hash}?`,
    confirmCheckoutMessage: "Are you sure you want to hard checkout HEAD to this commit? Warning: Stashed and uncommitted modifications in this repository will be overwritten.",
    confirmCheckoutBtn: "Confirm Checkout",
    confirmHardResetTitle: (hash: string) => `Hard Reset HEAD to Commit ${hash}?`,
    confirmHardResetMessage: "WARNING: This runs 'git reset --hard'. Any modified/uncommitted playground codes and files WILL be deleted permanently to match this commit state.",
    confirmHardResetBtn: "Confirm Hard Reset",
    confirmSoftResetTitle: (hash: string) => `Soft Reset HEAD to Commit ${hash}?`,
    confirmSoftResetMessage: "This runs 'git reset --soft'. Your active modifications are kept, but the HEAD is moved back to this commit so you can re-commit changes.",
    confirmSoftResetBtn: "Confirm Soft Reset",
    confirmRevertTitle: (hash: string) => `Revert Commit ${hash}?`,
    confirmRevertMessage: "This runs 'git revert --no-edit'. A new commit will be automatically created that cleanly rollbacks / cancels the edits in this selected commit.",
    confirmRevertBtn: "Confirm Revert",
  },
  zh: {
    appTitle: "GitLanes",
    openRepo: "開啟 Git 儲存庫",
    openRepoDescription: "使用真實的本地儲存庫、初始化資料夾，或 clone 遠端儲存庫到本地資料夾。",
    openLocalFolder: "開啟本地儲存庫資料夾：",
    open: "開啟",
    clone: "Clone",
    init: "初始化",
    cloneRepo: "Clone 儲存庫：",
    initFolder: "初始化本地資料夾：",
    targetMustBeEmpty: "目標資料夾必須是空的，或尚未存在。",
    orClone: "或 CLONE",
    orInit: "或初始化",
    repositories: "儲存庫",
    noRepositories: "尚未加入儲存庫",
    active: "目前",
    removeFromSidebar: "從側邊欄移除",
    switchRepo: "切換／開啟儲存庫",
    openNew: "開啟／Clone／初始化",
    gitIdentity: "Git 身分",
    userName: "user.name",
    userEmail: "user.email",
    saveIdentity: "儲存身分",
    closeRepo: "關閉儲存庫",
    closeRepoTitle: "關閉儲存庫？",
    closeRepoMessage: "這只會在 App 中關閉目前儲存庫，不會刪除本地檔案或 Git 歷史記錄。",
    refresh: "重新整理儲存庫狀態",
    checkout: "切換：",
    merge: "合併",
    mergeWith: "合併...",
    stageAll: "全部暫存",
    unstageAll: "全部取消暫存",
    workingClean: "工作目錄乾淨",
    editFilesHint: "編輯檔案或使用程式碼修改工具來建立 commit。",
    createBranch: "建立新分支",
    commitment: "Commit",
    commitChanges: "COMMIT 變更",
    terminalReady: "終端機已就緒。透過介面執行 Git 操作後，指令記錄會顯示在這裡...",
    simulationActive: "儲存庫使用中",
    refreshedAt: "Git 工作區 - 更新時間",
    opened: "儲存庫已開啟",
    identitySaved: "Git 身分已儲存。",
    create: "建立",
    indexStageControl: "暫存控制",
    unstagedChanges: "未暫存變更",
    stagedChanges: "已暫存變更",
    gitStashes: "Git Stash",
    popStash: "取出 Stash",
    stashPlaceholder: "Stash 標籤訊息...",
    stash: "Stash",
    geminiSuggestion: "Gemini 建議",
    commitPlaceholder: "輸入 conventional commit 訊息...",
    commitLabel: "Commit",
    closeLog: "關閉",
    authorLabel: "作者",
    dateLabel: "日期",
    subjectLabel: "說明",
    workspaceActions: "工作區操作",
    workspaceTitle: "工作區",
    emptyFolder: "空資料夾",
    codeEditorTitle: "工作區程式編輯器",
    codeEditorHint: "在左欄選擇現有檔案，或點 + 按鈕新增內容。儲存後會更新檔案並標記為未追蹤或已修改。",
    cliHistory: "Git CLI 指令記錄與輸出",
    graphTitle: "互動式 Commit 歷史 (DAG)",
    graphEmptyTitle: "找不到 commit 記錄",
    graphEmptyHint: "編輯檔案、在檔案清單中 stage，並在側邊欄輸入訊息送出 commit，即可建立圖譜中的第一個節點。",
    loadMoreCommits: "再載入 300 筆 commit",
    toastFolderPickerError: "無法開啟資料夾選擇器。",
    toastLoadMoreFailed: "載入更多 commit 失敗。",
    toastOpenRepoFailed: "開啟儲存庫失敗。",
    toastSaveIdentityFailed: "儲存 Git 身分失敗。",
    toastEnterLocalFolder: "請輸入本地資料夾路徑",
    toastInitFailed: "初始化失敗。",
    toastEnterCloneUrl: "請輸入有效的 clone 網址",
    toastEnterTargetFolder: "請輸入本地目標資料夾",
    toastCloneFailed: "clone 儲存庫失敗。",
    toastRepoClosed: "已關閉儲存庫。",
    toastWipeFailed: "清除工作區失敗。",
    toastStagedAll: "已 stage 所有工作檔案",
    toastUnstagedAll: "已取消 stage 所有索引檔案",
    toastStashed: "已 stash 本地修改",
    toastStashPopped: "已將最新的 stash 取回工作區",
    toastEnterCommitMessage: "請輸入 commit 訊息",
    toastCommitRecorded: "Commit 已記錄到儲存庫！",
    toastCommitFailed: "Commit 失敗。請確認變更已 stage。",
    toastNoFilesStaged: "尚未 stage 任何檔案！請先 stage 一些修改再產生 AI 訊息。",
    toastAiCommitDone: "Gemini 已根據已 stage 的 diff 產生 conventional commit 訊息！",
    toastAiCommitFailed: "無法產生 commit 訊息。",
    toastResetFailed: "Reset 失敗。",
    toastRevertFailed: "Revert commit 失敗。",
    toastMergeConflict: "合併衝突！自動合併失敗，請在 stage 的檔案中解決衝突。",
    toastStagedFile: (f: string) => `已成功 stage ${f}`,
    toastUnstagedFile: (f: string) => `已取消 stage ${f}`,
    toastBranchCreated: (b: string) => `已建立分支「${b}」！`,
    toastSwitchedBranch: (b: string) => `已切換工作區到分支「${b}」`,
    toastMerged: (from: string, to: string) => `已成功將「${from}」合併進「${to}」！`,
    toastResetDone: (mode: string, hash: string) => `已成功對 ${hash} 執行 git reset ${mode}`,
    toastReverted: (hash: string) => `已成功 revert commit ${hash}！`,
    toastCheckedOut: (hash: string) => `已成功將 HEAD checkout 到 commit ${hash}`,
    confirmCheckoutTitle: (hash: string) => `將 HEAD 強制 checkout 到 commit ${hash}？`,
    confirmCheckoutMessage: "確定要將 HEAD 強制 checkout 到這個 commit 嗎？警告：此儲存庫中 stash 與未 commit 的修改將被覆蓋。",
    confirmCheckoutBtn: "確認 Checkout",
    confirmHardResetTitle: (hash: string) => `將 HEAD 硬重置到 commit ${hash}？`,
    confirmHardResetMessage: "警告：這會執行 'git reset --hard'。任何已修改／未 commit 的程式碼與檔案將被永久刪除，以符合此 commit 狀態。",
    confirmHardResetBtn: "確認硬重置",
    confirmSoftResetTitle: (hash: string) => `將 HEAD 軟重置到 commit ${hash}？`,
    confirmSoftResetMessage: "這會執行 'git reset --soft'。你目前的修改會保留，但 HEAD 會移回此 commit，讓你可以重新 commit。",
    confirmSoftResetBtn: "確認軟重置",
    confirmRevertTitle: (hash: string) => `Revert commit ${hash}？`,
    confirmRevertMessage: "這會執行 'git revert --no-edit'。系統會自動建立一個新 commit，乾淨地回復／取消此 commit 的變更。",
    confirmRevertBtn: "確認 Revert",
  },
};

const repoNameFromPath = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;

const readStoredRepos = (): ManagedRepo[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPOS_STORAGE_KEY) || localStorage.getItem(LEGACY_REPOS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((repo) => typeof repo.path === "string" && typeof repo.name === "string") : [];
  } catch {
    return [];
  }
};

export default function App() {
  const [language, setLanguage] = useState<Language>(() => ((localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY)) === "zh" ? "zh" : "en"));
  const t = translations[language];

  // Repository state
  const [isRepoInitialized, setIsRepoInitialized] = useState<boolean>(false);
  const [workspacePath, setWorkspacePath] = useState<string>("");
  const [managedRepos, setManagedRepos] = useState<ManagedRepo[]>(readStoredRepos);
  const [isRepoSidebarCollapsed, setIsRepoSidebarCollapsed] = useState<boolean>(false);
  const [isRepoPanelOpen, setIsRepoPanelOpen] = useState<boolean>(false);
  const [currentBranch, setCurrentBranch] = useState<string>("main");
  const [gitFiles, setGitFiles] = useState<GitFile[]>([]);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState<boolean>(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stashes, setStashes] = useState<StashItem[]>([]);
  
  // Workspace files (all physical files)
  const [sandboxFiles, setSandboxFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  // Command logs telemetry
  const [cmdHistory, setCmdHistory] = useState<any[]>([]);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(true);

  // Focus view states
  const [selectedCommit, setSelectedCommit] = useState<CommitNode | null>(null);
  const [diffTarget, setDiffTarget] = useState<{ path: string; staged: boolean } | null>(null);
  
  // Form input states
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [newBranchName, setNewBranchName] = useState<string>("");
  const [mergeTargetBranch, setMergeTargetBranch] = useState<string>("");
  const [stashMessage, setStashMessage] = useState<string>("");
  
  // UI loaders/errors
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccess, setApiSuccess] = useState<string | null>(null);

  // Repository selector inputs
  const [openPath, setOpenPath] = useState<string>("");
  const [initPath, setInitPath] = useState<string>("");
  const [cloneUrl, setCloneUrl] = useState<string>("");
  const [cloneTargetPath, setCloneTargetPath] = useState<string>("");
  const [gitUserName, setGitUserName] = useState<string>("");
  const [gitUserEmail, setGitUserEmail] = useState<string>("");

  // Custom confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    confirmStyle?: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const requestConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmText = "Confirm",
    confirmStyle = "bg-rose-600 hover:bg-rose-500"
  ) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      },
      confirmText,
      confirmStyle,
    });
  };

  const handlePickOpenFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Git Repository Folder",
      });
      if (typeof selected === "string") {
        setOpenPath(selected);
      }
    } catch (err: any) {
      showToast(err.message || t.toastFolderPickerError, true);
    }
  };

  const persistRepos = (repos: ManagedRepo[]) => {
    setManagedRepos(repos);
    localStorage.setItem(REPOS_STORAGE_KEY, JSON.stringify(repos));
  };

  const addManagedRepo = (path: string) => {
    if (!path) return;
    setManagedRepos((prev) => {
      const nextRepo = { path, name: repoNameFromPath(path) };
      const next = [nextRepo, ...prev.filter((repo) => repo.path !== path)];
      localStorage.setItem(REPOS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Load latest state from server
  const refreshState = async () => {
    try {
      // 1. Get overall Git Status
      const statusRes = await fetch("/api/git/status");
      if (!statusRes.ok) throw new Error("Could not load repo status");
      const statusData = await statusRes.json();
      
      setIsRepoInitialized(statusData.initialized);
      setWorkspacePath(statusData.workspacePath || "");
      if (statusData.initialized) {
        addManagedRepo(statusData.workspacePath || "");
        setCurrentBranch(statusData.currentBranch);
        setGitFiles(statusData.files);

        // 2. Load commits hierarchy
        const logRes = await fetch(`/api/git/log?limit=${COMMIT_PAGE_SIZE}&skip=0&allBranches=true`);
        const logData = await logRes.json();
        setCommits(logData.commits || []);
        setHasMoreCommits(Boolean(logData.hasMore));

        // 3. Load branches list
        const branchRes = await fetch("/api/git/branches");
        const branchData = await branchRes.json();
        setBranches(branchData.branches || []);

        // 4. Load stash list
        const stashRes = await fetch("/api/git/stash");
        const stashData = await stashRes.json();
        setStashes(stashData.stashes || []);

        const identityRes = await fetch("/api/git/identity");
        if (identityRes.ok) {
          const identityData = await identityRes.json();
          setGitUserName(identityData.userName || "");
          setGitUserEmail(identityData.userEmail || "");
        }
      } else {
        setGitFiles([]);
        setCommits([]);
        setHasMoreCommits(false);
        setBranches([]);
        setStashes([]);
        setSandboxFiles([]);
        setGitUserName("");
        setGitUserEmail("");
      }

      // 5. Always load physical workspace files
      const sandboxRes = await fetch("/api/sandbox/files");
      const sandboxData = await sandboxRes.json();
      setSandboxFiles(sandboxData.files || []);

      // 6. Load command log history
      const historyRes = await fetch("/api/git/history");
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setCmdHistory(historyData.history || []);
      }

    } catch (err: any) {
      setApiError("Backend connection error: " + (err.message || String(err)));
    }
  };

  const handleLoadMoreCommits = async () => {
    try {
      const logRes = await fetch(`/api/git/log?limit=${COMMIT_PAGE_SIZE}&skip=${commits.length}&allBranches=true`);
      const logData = await logRes.json();
      setCommits((prev) => [...prev, ...(logData.commits || [])]);
      setHasMoreCommits(Boolean(logData.hasMore));
    } catch (err: any) {
      showToast(err.message || t.toastLoadMoreFailed, true);
    }
  };

  useEffect(() => {
    refreshState();
  }, []);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  // Quick success helper
  const showToast = (message: string, isErr = false) => {
    if (isErr) {
      setApiError(message);
      setApiSuccess(null);
    } else {
      setApiSuccess(message);
      setApiError(null);
    }
    setTimeout(() => {
      setApiError(null);
      setApiSuccess(null);
    }, 4000);
  };

  const openRepositoryPath = async (path: string, successMessage = t.opened) => {
    const res = await fetch("/api/git/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to open repository");
    addManagedRepo(data.workspacePath || path);
    showToast(successMessage);
    setSelectedCommit(null);
    setDiffTarget(null);
    setActiveFile(null);
    await refreshState();
  };

  const handleSwitchRepo = async (repo: ManagedRepo) => {
    setIsActionLoading(true);
    try {
      await openRepositoryPath(repo.path, `${t.opened}: ${repo.name}`);
    } catch (err: any) {
      showToast(err.message || t.toastOpenRepoFailed, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRemoveManagedRepo = (path: string) => {
    const next = managedRepos.filter((repo) => repo.path !== path);
    persistRepos(next);
  };

  const handleSaveIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/identity/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName: gitUserName, userEmail: gitUserEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save Git identity");
      showToast(t.identitySaved);
      await refreshState();
    } catch (err: any) {
      showToast(err.message || t.toastSaveIdentityFailed, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  // 1. Open an existing local repository
  const handleOpenRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openPath.trim()) {
      showToast(language === "zh" ? "請輸入本地 repository 資料夾路徑" : "Please enter a local repository folder path", true);
      return;
    }
    setIsActionLoading(true);
    try {
      await openRepositoryPath(openPath.trim());
      setOpenPath("");
    } catch (err: any) {
      showToast(err.message || t.toastOpenRepoFailed, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  // 1b. Initialize a local repository in a chosen folder
  const handleInitRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initPath.trim()) {
      showToast(t.toastEnterLocalFolder, true);
      return;
    }
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: initPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to initialize");
      
      addManagedRepo(data.workspacePath || initPath.trim());
      showToast(language === "zh" ? "本地 Git repository 已初始化" : "Local Git repository initialized!");
      setInitPath("");
      await refreshState();
    } catch (err: any) {
      showToast(err.message || t.toastInitFailed, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  // 1c. Clone a public remote repository into a local folder
  const handleCloneRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneUrl.trim()) {
      showToast(t.toastEnterCloneUrl, true);
      return;
    }
    if (!cloneTargetPath.trim()) {
      showToast(t.toastEnterTargetFolder, true);
      return;
    }
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: cloneUrl.trim(), targetPath: cloneTargetPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clone failed");

      addManagedRepo(data.workspacePath || cloneTargetPath.trim());
      showToast(language === "zh" ? "Repository 已 clone 並開啟" : "Repository cloned and opened successfully!");
      setCloneUrl("");
      setCloneTargetPath("");
      await refreshState();
    } catch (err: any) {
      showToast(err.message || t.toastCloneFailed, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  // 1d. Close the current repository without deleting files
  const handleWipeRepo = async () => {
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/wipe", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Wipe failed");

      showToast(t.toastRepoClosed);
      setSelectedCommit(null);
      setActiveFile(null);
      await refreshState();
    } catch (err: any) {
      showToast(err.message || t.toastWipeFailed, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  // 2. Stage/Unstage interactions
  const handleStageFile = async (filePath: string) => {
    try {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: filePath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to stage");
      }
      showToast(t.toastStagedFile(filePath));
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleStageAll = async () => {
    try {
      const res = await fetch("/api/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "." }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      showToast(t.toastStagedAll);
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleUnstageFile = async (filePath: string) => {
    try {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: filePath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      showToast(t.toastUnstagedFile(filePath));
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  const handleUnstageAll = async () => {
    try {
      const res = await fetch("/api/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "." }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      showToast(t.toastUnstagedAll);
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    }
  };

  // 3. Create & Checkout branches
  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim()) return;
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/branch/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBranchName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create branch");
      
      showToast(t.toastBranchCreated(newBranchName));
      setNewBranchName("");
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCheckoutBranch = async (branchName: string) => {
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/branch/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: branchName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout error");
      
      showToast(t.toastSwitchedBranch(branchName));
      setSelectedCommit(null);
      setDiffTarget(null);
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleMergeBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeTargetBranch) return;
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/branch/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: mergeTargetBranch }),
      });
      const data = await res.json();
      if (data.conflict) {
        showToast(t.toastMergeConflict, true);
      } else if (!res.ok) {
        throw new Error(data.error || "Merge error");
      } else {
        showToast(t.toastMerged(mergeTargetBranch, currentBranch));
      }
      setMergeTargetBranch("");
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  // 4. Stashes
  const handleSaveStash = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/stash/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: stashMessage.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      showToast(t.toastStashed);
      setStashMessage("");
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handlePopStash = async () => {
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/stash/pop", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      showToast(t.toastStashPopped);
      refreshState();
    } catch (err: any) {
      showToast(err.message, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  // 5. Commit with Gemini AI Message generation
  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) {
      showToast(t.toastEnterCommitMessage, true);
      return;
    }
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: commitMessage.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed");

      showToast(t.toastCommitRecorded);
      setCommitMessage("");
      refreshState();
    } catch (err: any) {
      showToast(err.message || t.toastCommitFailed, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleAiSuggestedCommitMessage = async () => {
    const stagedFiles = gitFiles.filter(f => f.staged);
    if (stagedFiles.length === 0) {
      showToast(t.toastNoFilesStaged, true);
      return;
    }

    setIsAiLoading(true);
    try {
      const res = await fetch("/api/git/ai/commit-message", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Could not invoke Gemini API.");
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setCommitMessage(data.message);
      showToast(t.toastAiCommitDone);
    } catch (err: any) {
      showToast(err.message || t.toastAiCommitFailed, true);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleGitReset = async (commitHash: string, mode: "hard" | "soft") => {
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: commitHash, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      showToast(t.toastResetDone(mode === "soft" ? "--soft" : "--hard", commitHash));
      setSelectedCommit(null);
      await refreshState();
    } catch (err: any) {
      showToast(err.message || t.toastResetFailed, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleGitRevert = async (commitHash: string) => {
    setIsActionLoading(true);
    try {
      const res = await fetch("/api/git/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: commitHash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Revert failed");
      showToast(t.toastReverted(commitHash));
      setSelectedCommit(null);
      await refreshState();
    } catch (err: any) {
      showToast(err.message || t.toastRevertFailed, true);
    } finally {
      setIsActionLoading(false);
    }
  };

  const renderRepoSidebar = () => (
    <aside className={`${isRepoSidebarCollapsed ? "w-12" : "w-[280px]"} h-full bg-slate-950 border-r border-slate-900 shrink-0 transition-all duration-200 flex flex-col`}>
      <div className="h-12 px-3 border-b border-slate-900 flex items-center justify-between">
        {!isRepoSidebarCollapsed && (
          <span className="text-[11px] font-mono font-bold uppercase text-slate-400 tracking-wider">{t.repositories}</span>
        )}
        <button
          onClick={() => setIsRepoSidebarCollapsed(!isRepoSidebarCollapsed)}
          title={isRepoSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800"
        >
          {isRepoSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {!isRepoSidebarCollapsed && (
        <>
          <div className="p-2 flex-1 overflow-y-auto">
            {managedRepos.length === 0 ? (
              <div className="p-3 text-[11px] font-mono text-slate-600 text-center">{t.noRepositories}</div>
            ) : (
              <div className="space-y-1">
                {managedRepos.map((repo) => {
                  const isActive = repo.path === workspacePath;
                  return (
                    <div
                      key={repo.path}
                      className={`group flex items-center gap-2 px-2 py-2 rounded border cursor-pointer transition-colors ${
                        isActive
                          ? "bg-cyan-950/30 border-cyan-900/60"
                          : "bg-slate-900/30 border-slate-900 hover:bg-slate-800/50 hover:border-slate-700"
                      }`}
                      onClick={() => handleSwitchRepo(repo)}
                    >
                      <div className="min-w-0 flex-1 text-left" title={repo.path}>
                        <span className="block text-xs font-semibold text-slate-200 truncate">{repo.name}</span>
                        <span className="block text-[10px] font-mono text-slate-600 truncate">{repo.path}</span>
                      </div>
                      {isActive && <span className="text-[9px] text-cyan-400 font-mono uppercase">{t.active}</span>}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveManagedRepo(repo.path);
                        }}
                        title={t.removeFromSidebar}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-950/30 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {isRepoInitialized && (
            <form onSubmit={handleSaveIdentity} className="p-3 border-t border-slate-900 bg-slate-950/80">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-[10px] font-mono font-bold uppercase text-slate-500">{t.gitIdentity}</span>
              </div>
              <div className="space-y-2">
                <input
                  value={gitUserName}
                  onChange={(e) => setGitUserName(e.target.value)}
                  placeholder={t.userName}
                  className="w-full bg-slate-900 text-slate-200 border border-slate-800 rounded font-mono text-[11px] px-2 py-1.5 focus:outline-none focus:border-cyan-500"
                />
                <input
                  value={gitUserEmail}
                  onChange={(e) => setGitUserEmail(e.target.value)}
                  placeholder={t.userEmail}
                  className="w-full bg-slate-900 text-slate-200 border border-slate-800 rounded font-mono text-[11px] px-2 py-1.5 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-mono font-bold py-1.5 rounded border border-slate-700"
                >
                  {t.saveIdentity}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </aside>
  );

  // Render repository picker if no repository is open yet
  const renderRepoPanel = () => (
    <>
      {/* Click-away backdrop */}
      <div className="fixed inset-0 z-40" onClick={() => setIsRepoPanelOpen(false)} />
      <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 w-[460px] max-w-[80vw] max-h-[75vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-lg shadow-2xl scrollbar-thin">
        {/* Repository switcher */}
        <div className="p-2 border-b border-slate-800">
          <div className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">{t.repositories}</div>
          {managedRepos.length === 0 ? (
            <div className="p-3 text-[11px] font-mono text-slate-600 text-center">{t.noRepositories}</div>
          ) : (
            <div className="space-y-1">
              {managedRepos.map((repo) => {
                const isActive = repo.path === workspacePath;
                return (
                  <div
                    key={repo.path}
                    className={`group flex items-center gap-2 px-2 py-2 rounded border cursor-pointer transition-colors ${
                      isActive
                        ? "bg-cyan-950/30 border-cyan-900/60"
                        : "bg-slate-900/30 border-slate-900 hover:bg-slate-800/50 hover:border-slate-700"
                    }`}
                    onClick={() => {
                      handleSwitchRepo(repo);
                      setIsRepoPanelOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1" title={repo.path}>
                      <span className="block text-xs font-semibold text-slate-200 truncate">{repo.name}</span>
                      <span className="block text-[10px] font-mono text-slate-600 truncate">{repo.path}</span>
                    </div>
                    {isActive && <span className="text-[9px] text-cyan-400 font-mono uppercase shrink-0">{t.active}</span>}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveManagedRepo(repo.path);
                      }}
                      title={t.removeFromSidebar}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-950/30 cursor-pointer shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Open / Clone / Init */}
        <div className="p-3 space-y-3 border-b border-slate-800">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">{t.openNew}</div>

          <form onSubmit={handleOpenRepo} className="space-y-1.5">
            <label className="block text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.openLocalFolder}</label>
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="/Users/you/projects/repository"
                value={openPath}
                onChange={(e) => setOpenPath(e.target.value)}
                className="flex-1 min-w-0 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-cyan-500 placeholder-slate-700"
              />
              <button
                type="button"
                onClick={handlePickOpenFolder}
                title={t.open}
                className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 border border-slate-700/80 p-2 rounded cursor-pointer transition-all shrink-0"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
              <button
                type="submit"
                disabled={isActionLoading}
                className="bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-slate-100 text-xs font-bold font-mono px-3 rounded cursor-pointer transition-all shrink-0"
              >
                {t.open}
              </button>
            </div>
          </form>

          <form onSubmit={handleCloneRepo} className="space-y-1.5">
            <label className="block text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.cloneRepo}</label>
            <input
              type="text"
              placeholder="https://github.com/user/repository.git"
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-cyan-500 placeholder-slate-700"
            />
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="/Users/you/projects/repository"
                value={cloneTargetPath}
                onChange={(e) => setCloneTargetPath(e.target.value)}
                className="flex-1 min-w-0 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-cyan-500 placeholder-slate-700"
              />
              <button
                type="submit"
                disabled={isActionLoading}
                className="bg-purple-700 hover:bg-purple-600 active:scale-95 text-slate-100 text-xs font-bold font-mono px-3 rounded cursor-pointer transition-all shrink-0 flex items-center space-x-1"
              >
                <GitPullRequest className="h-3.5 w-3.5" />
                <span>{t.clone}</span>
              </button>
            </div>
          </form>

          <form onSubmit={handleInitRepo} className="space-y-1.5">
            <label className="block text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.initFolder}</label>
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="/Users/you/projects/new-repository"
                value={initPath}
                onChange={(e) => setInitPath(e.target.value)}
                className="flex-1 min-w-0 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-xs px-2 py-1.5 focus:outline-none focus:border-cyan-500 placeholder-slate-700"
              />
              <button
                type="submit"
                disabled={isActionLoading}
                className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-100 text-xs font-bold font-mono px-3 rounded cursor-pointer transition-all shrink-0"
              >
                {t.init}
              </button>
            </div>
          </form>
        </div>

        {/* Git identity */}
        <form onSubmit={handleSaveIdentity} className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <User className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-[10px] font-mono font-bold uppercase text-slate-500">{t.gitIdentity}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={gitUserName}
              onChange={(e) => setGitUserName(e.target.value)}
              placeholder={t.userName}
              className="flex-1 min-w-0 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-[11px] px-2 py-1.5 focus:outline-none focus:border-cyan-500"
            />
            <input
              value={gitUserEmail}
              onChange={(e) => setGitUserEmail(e.target.value)}
              placeholder={t.userEmail}
              className="flex-1 min-w-0 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-[11px] px-2 py-1.5 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-mono px-3 py-1.5 rounded border border-slate-700 cursor-pointer shrink-0"
            >
              {t.saveIdentity}
            </button>
          </div>
        </form>
      </div>
    </>
  );

  if (!isRepoInitialized) {
    return (
      <div id="gitlanes-init-page" className={`${language === "zh" ? "lang-zh" : "lang-en"} h-full w-full bg-slate-950 text-slate-100 flex flex-col justify-between font-sans`}>
        <header className="px-6 py-4 bg-slate-900 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <GitBranch className="h-5 w-5 text-cyan-400 animate-pulse" />
            <h1 className="text-slate-200 font-bold font-sans tracking-tight text-sm uppercase">{t.appTitle}</h1>
          </div>
          <button
            onClick={() => setLanguage(language === "en" ? "zh" : "en")}
            className="flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-100 font-mono border border-slate-800 px-2 py-1 rounded"
          >
            <Languages className="h-3.5 w-3.5" />
            <span>{language === "en" ? "中文" : "EN"}</span>
          </button>
        </header>

        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-y-0 left-0 z-20">
            {renderRepoSidebar()}
          </div>
        <main className="h-full flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-cyan-500 via-emerald-500 to-purple-500" />

            <div className="flex justify-center mb-4">
              <div className="p-3 bg-cyan-950/50 border border-cyan-800/60 rounded-full">
                <GitBranch className="h-8 w-8 text-cyan-400" />
              </div>
            </div>

            <div className="text-center mb-6">
              <h2 className="text-slate-100 font-bold text-lg">{t.openRepo}</h2>
              <p className="text-slate-400 text-xs mt-1.5 leading-relaxed">
                {t.openRepoDescription}
              </p>
            </div>

            <form onSubmit={handleOpenRepo} className="space-y-3 mb-5">
              <label className="block text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.openLocalFolder}</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="/Users/you/projects/repository"
                  value={openPath}
                  onChange={(e) => setOpenPath(e.target.value)}
                  className="flex-1 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-xs px-2.5 py-2 focus:outline-none focus:border-cyan-500 placeholder-slate-700"
                />
                <button
                  type="button"
                  onClick={handlePickOpenFolder}
                  title="Choose folder"
                  className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 border border-slate-700/80 p-2 rounded cursor-pointer transition-all shrink-0"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-slate-100 text-xs font-bold font-mono px-3.5 rounded cursor-pointer transition-all flex items-center space-x-1 shrink-0"
                >
                  {isActionLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <span>{t.open}</span>}
                </button>
              </div>
            </form>

            <div className="relative my-5 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-800" />
              </div>
              <span className="relative px-3 bg-slate-900 text-slate-500 font-mono text-[9px] uppercase tracking-wider">{t.orClone}</span>
            </div>

            <form onSubmit={handleCloneRepo} className="space-y-3">
              <label className="block text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.cloneRepo}</label>
              <div className="grid gap-2">
                <input
                  type="text"
                  placeholder="https://github.com/user/repository.git"
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-xs px-2.5 py-2 focus:outline-none focus:border-cyan-500 placeholder-slate-700"
                />
                <input
                  type="text"
                  placeholder="/Users/you/projects/repository"
                  value={cloneTargetPath}
                  onChange={(e) => setCloneTargetPath(e.target.value)}
                  className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-xs px-2.5 py-2 focus:outline-none focus:border-cyan-500 placeholder-slate-700"
                />
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="bg-purple-700 hover:bg-purple-600 active:scale-95 text-slate-100 text-xs font-bold font-mono px-3.5 py-2 rounded cursor-pointer transition-all flex items-center justify-center space-x-1"
                >
                  {isActionLoading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <GitPullRequest className="h-3.5 w-3.5" />
                      <span>{t.clone}</span>
                    </>
                  )}
                </button>
              </div>
              <span className="block text-[10px] text-slate-500 font-mono italic">
                {t.targetMustBeEmpty}
              </span>
            </form>

            <div className="relative my-5 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-800" />
              </div>
              <span className="relative px-3 bg-slate-900 text-slate-500 font-mono text-[9px] uppercase tracking-wider">{t.orInit}</span>
            </div>

            <form onSubmit={handleInitRepo} className="space-y-3">
              <label className="block text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.initFolder}</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="/Users/you/projects/new-repository"
                  value={initPath}
                  onChange={(e) => setInitPath(e.target.value)}
                  className="flex-1 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-xs px-2.5 py-2 focus:outline-none focus:border-cyan-500 placeholder-slate-700"
                />
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-100 text-xs font-bold font-mono px-3.5 rounded cursor-pointer transition-all flex items-center space-x-1 shrink-0"
                >
                  {isActionLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <span>{t.init}</span>}
                </button>
              </div>
            </form>
          </div>
        </main>
        </div>

        <footer className="py-4 text-center border-t border-slate-900 bg-slate-950 text-[11px] text-slate-600 font-mono">
          Powered by Tauri, local Git, and Gemini
        </footer>
      </div>
    );
  }

  // Find the files currently staged or modified
  const stagedFiles = gitFiles.filter((f) => f.staged);
  const modifiedFiles = gitFiles.filter((f) => f.modified);

  return (
    <div id="gitlanes-dashboard" className={`${language === "zh" ? "lang-zh" : "lang-en"} h-full w-full overflow-hidden bg-slate-950 text-slate-100 flex font-sans select-none`}>
      <div className="flex-1 min-w-0 flex flex-col">
      
      {/* Toast banner displays */}
      {(apiError || apiSuccess) && (
        <div className="fixed top-4 right-4 z-50 animate-bounce">
          {apiError ? (
            <div className="bg-rose-950 border border-rose-800 text-rose-300 rounded-lg px-4 py-2.5 shadow-xl flex items-center space-x-2.5 max-w-sm select-text">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
              <span className="text-xs font-medium leading-tight">{apiError}</span>
            </div>
          ) : (
            <div className="bg-emerald-950 border border-emerald-800 text-emerald-300 rounded-lg px-4 py-2.5 shadow-xl flex items-center space-x-2.5 max-w-sm select-text">
              <Check className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-medium leading-tight">{apiSuccess}</span>
            </div>
          )}
        </div>
      )}

      {/* Main workspace nav bar */}
      <nav id="workspace-nav" className="px-6 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center shrink-0 gap-4">
        <div className="flex-1 min-w-0" />
        <div className="relative flex items-center min-w-0 shrink">
          <button
            onClick={() => setIsRepoPanelOpen((v) => !v)}
            title={t.switchRepo}
            className="flex items-center space-x-2 bg-slate-950 border border-slate-800 hover:border-slate-600 px-3 py-1.5 rounded-md cursor-pointer transition-colors min-w-0"
          >
            <GitBranch className="h-4 w-4 text-cyan-400 animate-pulse shrink-0" />
            <span className="text-cyan-400 font-mono font-bold text-xs uppercase tracking-wider shrink-0">{currentBranch}</span>
            <span className="text-slate-500 font-mono text-xs truncate max-w-[420px]">{workspacePath}</span>
            <ChevronDown className={`h-3.5 w-3.5 text-slate-500 shrink-0 transition-transform ${isRepoPanelOpen ? "rotate-180" : ""}`} />
          </button>
          {isRepoPanelOpen && renderRepoPanel()}
        </div>

        {/* Action controllers: Branches, checkout & merges */}
        <div className="flex-1 min-w-0 flex items-center justify-end space-x-3 flex-wrap">
          <button
            onClick={() => setLanguage(language === "en" ? "zh" : "en")}
            className="flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-100 font-mono border border-slate-800 px-2 py-1 rounded bg-slate-950"
          >
            <Languages className="h-3.5 w-3.5" />
            <span>{language === "en" ? "中文" : "EN"}</span>
          </button>

          {/* Quick status refresher */}
          <button
            onClick={refreshState}
            title={t.refresh}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 rounded border border-slate-700/80 transition-all cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          {/* Checkout Selector */}
          <div className="flex items-center space-x-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800">
            <span className="text-[10px] text-slate-500 font-mono font-bold uppercase">{t.checkout}</span>
            <select
              value={currentBranch}
              onChange={(e) => handleCheckoutBranch(e.target.value)}
              className="bg-transparent text-slate-200 border-none outline-none font-mono text-xs cursor-pointer focus:ring-0 py-0"
            >
              {branches.map(b => (
                <option key={b.name} value={b.name} className="bg-slate-900 text-slate-200">
                  {b.name} {b.isCurrent ? "(current)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Merge Trigger */}
          {branches.length > 1 && (
            <form onSubmit={handleMergeBranch} className="flex items-center space-x-1 border border-slate-800 p-0.5 rounded bg-slate-950">
              <select
                value={mergeTargetBranch}
                onChange={(e) => setMergeTargetBranch(e.target.value)}
                className="bg-transparent text-slate-200 border-none outline-none font-mono text-xs cursor-pointer focus:ring-0 max-w-[120px] py-0"
                required
              >
                <option value="" className="bg-slate-900 text-slate-500">{t.mergeWith}</option>
                {branches.filter(b => b.name !== currentBranch).map(b => (
                  <option key={b.name} value={b.name} className="bg-slate-900 text-slate-200">{b.name}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!mergeTargetBranch}
                className="bg-purple-950 hover:bg-purple-900 border border-purple-800 text-purple-400 text-[10px] font-mono leading-none px-2.5 py-1.5 rounded transition-all cursor-pointer"
              >
                {t.merge}
              </button>
            </form>
          )}

          {/* Re-init / Wipe simulation repo */}
          <button
            onClick={() => {
              requestConfirm(
                t.closeRepoTitle,
                t.closeRepoMessage,
                handleWipeRepo,
                t.closeRepo,
                "bg-slate-700 hover:bg-slate-600"
              );
            }}
            className="text-[10px] text-rose-400 hover:text-rose-300 font-mono hover:underline pl-2 border-l border-slate-800 cursor-pointer"
          >
            {t.closeRepo}
          </button>
        </div>
      </nav>

      <div id="dashboard-columns-panel" className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left column sidebar for local files index and staging list */}
        <div className="w-full lg:w-[325px] border-r border-slate-900 bg-slate-950/40 p-4 overflow-y-auto flex flex-col shrink-0">
          
          {/* 1. Branch Creator widget */}
          <div className="mb-5 bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
            <h4 className="text-slate-300 font-semibold text-xs mb-2 flex items-center space-x-1.5">
              <Plus className="h-3.5 w-3.5 text-cyan-400" />
              <span>{t.createBranch}</span>
            </h4>
            <form onSubmit={handleCreateBranch} className="flex space-x-2">
              <input
                type="text"
                placeholder="branch-name..."
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                className="flex-1 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-xs px-2.5 py-1.5 focus:outline-none focus:border-cyan-500 placeholder-slate-600"
              />
              <button
                type="submit"
                className="bg-cyan-600 hover:bg-cyan-500 text-slate-100 text-xs font-mono font-bold px-2 rounded cursor-pointer transition-colors"
              >
                {t.create}
              </button>
            </form>
          </div>

          {/* 2. Staging and Working tree modification tracking */}
          <div className="mb-5 flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-slate-500">{t.indexStageControl}</span>
              <div className="flex space-x-2">
                {gitFiles.length > 0 && (
                  <>
                    <button
                      onClick={handleStageAll}
                      className="text-[10px] text-emerald-400 font-mono hover:underline"
                    >
                      {t.stageAll}
                    </button>
                    <button
                      onClick={handleUnstageAll}
                      className="text-[10px] text-amber-500 font-mono hover:underline"
                    >
                      {t.unstageAll}
                    </button>
                  </>
                )}
              </div>
            </div>

            {gitFiles.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-900/10 border border-dashed border-slate-800 rounded-lg">
                <Check className="h-8 w-8 text-slate-700 mb-2" />
                <p className="text-slate-500 text-[11px] font-mono">{t.workingClean}</p>
                <p className="text-slate-600 text-[10px] max-w-[200px] mt-1">
                  {t.editFilesHint}
                </p>
              </div>
            ) : (
              <div className="space-y-4 overflow-y-auto">
                {/* Unstaged / Working Tree block */}
                {modifiedFiles.length > 0 && (
                  <div>
                    <span className="text-[10px] text-amber-400 font-mono font-bold block mb-1">{t.unstagedChanges} ({modifiedFiles.length})</span>
                    <div className="space-y-1 bg-slate-950/60 p-1.5 rounded-lg border border-slate-850">
                      {modifiedFiles.map((file) => (
                        <div key={file.path} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-slate-900/30 hover:bg-slate-900/80 transition-colors">
                          <div className="flex items-center space-x-2 truncate pr-2">
                            <span className="text-[9px] px-1 bg-amber-950 text-amber-400 rounded font-semibold shrink-0 uppercase">
                              {file.displayStatus === "Untracked" ? "U" : "M"}
                            </span>
                            <span className="font-mono text-[11px] text-slate-300 truncate" title={file.path}>{file.path}</span>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              onClick={() => setDiffTarget({ path: file.path, staged: false })}
                              title="Compare code diffs"
                              className="p-1 text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleStageFile(file.path)}
                              className="text-[10px] text-emerald-400 bg-emerald-950/20 border border-emerald-900 px-1.5 py-0.5 rounded hover:bg-emerald-900/40 transition-colors cursor-pointer font-mono"
                            >
                              Stage
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Staged Changes block */}
                {stagedFiles.length > 0 && (
                  <div>
                    <span className="text-[10px] text-emerald-400 font-mono font-bold block mb-1">{t.stagedChanges} ({stagedFiles.length})</span>
                    <div className="space-y-1 bg-slate-950/60 p-1.5 rounded-lg border border-slate-850">
                      {stagedFiles.map((file) => (
                        <div key={file.path} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-slate-900/30 hover:bg-slate-900/80 transition-colors">
                          <div className="flex items-center space-x-2 truncate pr-2">
                            <span className="text-[9px] px-1 bg-emerald-950 text-emerald-400 rounded font-semibold shrink-0 uppercase">staged</span>
                            <span className="font-mono text-[11px] text-slate-300 truncate" title={file.path}>{file.path}</span>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              onClick={() => setDiffTarget({ path: file.path, staged: true })}
                              title="Compare cached diffs"
                              className="p-1 text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleUnstageFile(file.path)}
                              className="text-[10px] text-amber-400 bg-amber-950/20 border border-amber-900 px-1.5 py-0.5 rounded hover:bg-amber-950/40 transition-colors cursor-pointer font-mono"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Stashes dashboard */}
          <div className="mb-5 border-t border-slate-900 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-slate-500">{t.gitStashes} ({stashes.length})</span>
              {stashes.length > 0 && (
                <button
                  onClick={handlePopStash}
                  className="text-[10px] text-teal-400 hover:underline font-mono"
                >
                  {t.popStash}
                </button>
              )}
            </div>

            <form onSubmit={handleSaveStash} className="flex space-x-1.5 mb-2">
              <input
                type="text"
                placeholder={t.stashPlaceholder}
                value={stashMessage}
                onChange={(e) => setStashMessage(e.target.value)}
                className="flex-1 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-[10px] px-2 py-1 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] px-2 py-1 rounded font-mono"
              >
                {t.stash}
              </button>
            </form>

            {stashes.length > 0 && (
              <div className="space-y-1 bg-slate-950/40 p-2 rounded-lg border border-slate-800 font-mono text-[10px] max-h-[80px] overflow-y-auto">
                {stashes.map((s, index) => (
                  <div key={index} className="text-slate-400 truncate">
                    {s.line}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4. Commitment Controller panel */}
          <div className="border-t border-slate-900 pt-4 mt-auto select-none">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-slate-500">{t.commitment}</span>
              <button
                type="button"
                onClick={handleAiSuggestedCommitMessage}
                disabled={isAiLoading}
                className="flex items-center space-x-1 text-amber-400 hover:text-amber-300 font-mono text-[11px] tracking-wide"
              >
                {isAiLoading ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                    <span>{t.geminiSuggestion}</span>
                  </>
                )}
              </button>
            </div>

            <form onSubmit={handleCommit} className="space-y-2">
              <textarea
                placeholder={t.commitPlaceholder}
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                className="w-full h-[64px] bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 font-mono text-xs resize-none placeholder-slate-700"
                required
              />
              <button
                type="submit"
                disabled={isActionLoading}
                className="w-full bg-cyan-600 hover:bg-cyan-500 text-slate-100 text-xs font-mono font-bold py-2 rounded shadow-md cursor-pointer transition-colors flex items-center justify-center space-x-2"
              >
                <GitCommit className="h-4 w-4" />
                <span>{t.commitChanges}</span>
              </button>
            </form>
          </div>

        </div>

        {/* Center/main workspace dashboard columns */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden gap-4">
          
          {/* Top Panel: Git history DAG graph and node analysis */}
          <div className="h-[43%] min-h-[220px]">
            <GitGraph
              commits={commits}
              currentBranch={currentBranch}
              selectedCommit={selectedCommit}
              hasMore={hasMoreCommits}
              onLoadMore={handleLoadMoreCommits}
              labels={{
                title: t.graphTitle,
                emptyTitle: t.graphEmptyTitle,
                emptyHint: t.graphEmptyHint,
                loadMore: t.loadMoreCommits,
              }}
              onSelectCommit={(commit) => {
                setSelectedCommit(commit);
                setDiffTarget(null); // click a commit clears instant diff targets
              }}
            />
          </div>

          {/* Bottom Panel: Split screen (Code editor / Diff viewer / Commit Details) */}
          <div className="flex-1 overflow-hidden min-h-[300px]">
            {diffTarget ? (
              <DiffViewer
                file={diffTarget.path}
                staged={diffTarget.staged}
                onClose={() => setDiffTarget(null)}
              />
            ) : selectedCommit ? (
              /* Selected commit historical inspector panel */
              <div className="h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
                  <div className="flex items-center space-x-2">
                    <GitCommit className="h-4 w-4 text-cyan-400" />
                    <span className="text-slate-200 font-semibold text-xs font-mono">{t.commitLabel}: {selectedCommit.hash}</span>
                  </div>
                  <button
                    onClick={() => setSelectedCommit(null)}
                    className="text-slate-500 hover:text-slate-300 text-xs font-mono font-bold cursor-pointer"
                  >
                    {t.closeLog}
                  </button>
                </div>

                <div className="flex-1 p-5 overflow-auto space-y-4">
                  <div className="grid grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-lg border border-slate-800">
                    <div>
                      <span className="text-[10px] text-slate-500 block font-mono font-bold uppercase">{t.authorLabel}</span>
                      <span className="text-slate-350 text-xs font-mono">{selectedCommit.author}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block font-mono font-bold uppercase">{t.dateLabel}</span>
                      <span className="text-slate-350 text-xs font-mono">{selectedCommit.date}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[10px] text-slate-500 block font-mono font-bold uppercase">{t.subjectLabel}</span>
                      <pre className="text-slate-200 text-xs font-semibold font-mono whitespace-pre-wrap bg-slate-950 p-2 border border-slate-900 rounded mt-1">{selectedCommit.message}</pre>
                    </div>
                  </div>

                  <div>
                    <h5 className="text-slate-400 text-xs font-bold font-mono uppercase tracking-wider mb-2">{t.workspaceActions}</h5>
                    <div className="flex flex-wrap gap-2.5">
                      <button
                        onClick={() => {
                          requestConfirm(
                            t.confirmCheckoutTitle(selectedCommit.hash),
                            t.confirmCheckoutMessage,
                            async () => {
                              setIsActionLoading(true);
                              try {
                                const res = await fetch("/api/git/branch/checkout", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ name: selectedCommit.hash }),
                                });
                                if (!res.ok) throw new Error("Hard checkout error");
                                showToast(t.toastCheckedOut(selectedCommit.hash));
                                setSelectedCommit(null);
                                refreshState();
                              } catch (err: any) {
                                showToast(err.message, true);
                              } finally {
                                setIsActionLoading(false);
                              }
                            },
                            t.confirmCheckoutBtn,
                            "bg-amber-600 hover:bg-amber-500"
                          );
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono px-3.5 py-2 rounded-md transition-colors cursor-pointer"
                      >
                        Checkout Commit [{selectedCommit.hash}]
                      </button>

                      <button
                        onClick={() => {
                          requestConfirm(
                            t.confirmHardResetTitle(selectedCommit.hash),
                            t.confirmHardResetMessage,
                            () => handleGitReset(selectedCommit.hash, "hard"),
                            t.confirmHardResetBtn,
                            "bg-rose-600 hover:bg-rose-500"
                          );
                        }}
                        className="bg-rose-950/40 border border-rose-800 hover:bg-rose-900/60 text-rose-300 text-xs font-mono px-3.5 py-2 rounded-md transition-colors cursor-pointer"
                      >
                        Reset --hard
                      </button>

                      <button
                        onClick={() => {
                          requestConfirm(
                            t.confirmSoftResetTitle(selectedCommit.hash),
                            t.confirmSoftResetMessage,
                            () => handleGitReset(selectedCommit.hash, "soft"),
                            t.confirmSoftResetBtn,
                            "bg-cyan-600 hover:bg-cyan-500"
                          );
                        }}
                        className="bg-cyan-950/45 border border-cyan-800 hover:bg-cyan-900/50 text-cyan-300 text-xs font-mono px-3.5 py-2 rounded-md transition-colors cursor-pointer"
                      >
                        Reset --soft
                      </button>

                      <button
                        onClick={() => {
                          requestConfirm(
                            t.confirmRevertTitle(selectedCommit.hash),
                            t.confirmRevertMessage,
                            () => handleGitRevert(selectedCommit.hash),
                            t.confirmRevertBtn,
                            "bg-purple-600 hover:bg-purple-500"
                          );
                        }}
                        className="bg-purple-950/45 border border-purple-800 hover:bg-purple-900/50 text-purple-300 text-xs font-mono px-3.5 py-2 rounded-md transition-colors cursor-pointer"
                      >
                        Revert Commit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Standard code editor panel */
              <CodeEditor
                files={sandboxFiles}
                activeFile={activeFile}
                onSelectFile={(f) => setActiveFile(f)}
                onFileUpdated={refreshState}
                gitFiles={gitFiles}
                labels={{
                  workspace: t.workspaceTitle,
                  emptyFolder: t.emptyFolder,
                  editorTitle: t.codeEditorTitle,
                  editorHint: t.codeEditorHint,
                }}
              />
            )}
          </div>

          {/* Live Git Terminal Console & command line telemetry */}
          <div className="bg-slate-950 border border-slate-900 rounded-lg flex flex-col overflow-hidden select-text">
            <div className={`flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-850`}>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs font-bold text-slate-400">$</span>
                <h4 className="text-slate-300 font-bold text-xs font-mono tracking-wide uppercase">{t.cliHistory}</h4>
                {cmdHistory.length > 0 && (
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono font-semibold">
                    {cmdHistory.length} logs
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsTerminalOpen(!isTerminalOpen)}
                className="text-slate-500 hover:text-slate-300 font-mono text-[11px] font-bold border border-slate-800 hover:border-slate-700 px-2 py-0.5 rounded transition-all cursor-pointer select-none"
              >
                {isTerminalOpen ? "Collapse [ - ]" : "Expand [ + ]"}
              </button>
            </div>

            {isTerminalOpen && (
              <div className="h-32 min-h-[120px] overflow-y-auto p-3 bg-slate-950 font-mono text-xs text-slate-300 space-y-3.5 scrollbar-thin">
                {cmdHistory.length === 0 ? (
                  <div className="h-full flex items-center justify-center p-4 text-center">
                    <span className="text-slate-500 text-xs italic">
                      {t.terminalReady}
                    </span>
                  </div>
                ) : (
                  cmdHistory.map((item, index) => (
                    <div key={index} className="border-b border-slate-900/40 pb-2.5 last:border-0 last:pb-0">
                      <div className="flex items-start md:items-center justify-between gap-2.5 text-slate-400 text-[11px] mb-1">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-cyan-500 font-bold font-mono">$</span>
                          <span className="text-slate-200 select-all font-semibold font-mono">{item.command}</span>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          <span className="text-[10px] text-slate-600">{item.timestamp}</span>
                          {item.code === 0 ? (
                            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-1 py-0.1 rounded uppercase">
                              Success
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold text-rose-400 bg-rose-950/40 border border-rose-900 px-1 py-0.1 rounded uppercase">
                              Error
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* stdout & stderr block */}
                      {(item.stdout || item.stderr) && (
                        <pre className={`p-2 bg-slate-900/60 rounded text-[11px] overflow-x-auto whitespace-pre-wrap leading-relaxed border border-slate-900 ${
                          item.code !== 0 ? "text-rose-300 border-rose-950/50" : "text-slate-400"
                        }`}>
                          {item.stdout || item.stderr}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

        </div>

      </div>

      <footer className="px-6 py-3 bg-slate-950 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-600 font-mono shrink-0">
        <div className="flex items-center space-x-2">
          <span>{t.simulationActive}</span>
          <span className="inline-block h-1.5 w-1.5 bg-emerald-500 rounded-full animate-ping" />
        </div>
        <span>{t.refreshedAt} {new Date().toLocaleTimeString()}</span>
      </footer>

      {/* Custom Confirmation Dialog Overlay */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-500 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold font-mono text-slate-100 uppercase tracking-wide">
                  {confirmModal.title}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-2.5 leading-relaxed">
                  {confirmModal.message}
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end space-x-3 border-t border-slate-850 pt-4">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs px-4 py-2 rounded-lg border border-slate-700/50 cursor-pointer transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`font-semibold font-mono text-xs text-slate-100 px-4 py-2 rounded-lg shadow-md cursor-pointer transition-all ${confirmModal.confirmStyle || "bg-rose-600 hover:bg-rose-500"}`}
              >
                {confirmModal.confirmText || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
