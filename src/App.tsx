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
  DownloadCloud,
  Download,
  Upload,
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
import { AiSettingsModal, AiSettingsLabels } from "./components/AiSettingsModal";
import { CommitContextMenu, CommitContextMenuItem } from "./components/CommitContextMenu";
import { CommitInputModal } from "./components/CommitInputModal";

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
    settings: "Settings",
    settingsLanguage: "Language",
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
    geminiSuggestion: "AI Suggestion",
    commitPlaceholder: "Write conventional commit message...",
    commitLabel: "Commit",
    closeLog: "Close Log",
    authorLabel: "Author",
    dateLabel: "Date",
    subjectLabel: "Subject Description",
    workspaceTitle: "Workspace",
    emptyFolder: "Empty folder",
    codeEditorTitle: "Workspace Code Editor",
    codeEditorHint: "Select an existing file in the left column or click the + button to write something. Saving updates the file and creates untracked or modified tags.",
    graphTitle: "Interactive Commit History (DAG)",
    maximizeGraph: "Maximize the commit graph (collapse the panels below)",
    restoreGraph: "Restore the layout",
    collapseWorkspace: "Collapse the workspace panel",
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
    toastAiCommitDone: "AI compiled a standard conventional commit message based on staged diff changes!",
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
    confirmCheckoutMessage: "Switches your working copy to this commit to inspect it (detached HEAD) — you won't be on any branch. New commits made here can be lost unless you create a branch to keep them.",
    confirmCheckoutBtn: "Confirm Checkout",
    confirmHardResetTitle: (hash: string) => `Hard Reset HEAD to Commit ${hash}?`,
    confirmHardResetMessage: "⚠️ Moves your current branch back to this commit and DISCARDS every commit after it as well as any uncommitted changes. This cannot be undone — please be sure.",
    confirmHardResetBtn: "Confirm Hard Reset",
    confirmSoftResetTitle: (hash: string) => `Soft Reset HEAD to Commit ${hash}?`,
    confirmSoftResetMessage: "Moves your current branch back to this commit, but keeps all your working changes and staged files. Often used to re-shape recent commits.",
    confirmSoftResetBtn: "Confirm Soft Reset",
    confirmRevertTitle: (hash: string) => `Revert Commit ${hash}?`,
    confirmRevertMessage: "Creates a new commit that undoes the changes from this commit — like reversing what it did. History is kept intact, so this is a safe way to undo.",
    confirmRevertBtn: "Confirm Revert",
    aiSettings: "AI Settings",
    aiSettingsTitle: "AI Settings",
    aiProvider: "Provider",
    aiModel: "Model",
    aiCustomModel: "Custom…",
    aiApiKey: "API Key",
    aiEndpoint: "Endpoint URL",
    aiClearKey: "Clear",
    aiTest: "Test Connection",
    aiTesting: "Testing…",
    aiTestOk: "Connection succeeded",
    aiCancel: "Cancel",
    aiSave: "Save",
    aiKeyStoredHint: "A key is stored. Leave blank to keep it.",
    toastSetupAiFirst: "Please set up an AI provider first.",
    changedFiles: "Changed Files",
    noChangedFiles: "No file changes in this commit.",
    selectFileForDiff: "Select a file to view its diff.",
    menuCheckout: "Checkout this commit",
    menuCherryPick: "Cherry-pick onto current branch",
    menuRevert: "Revert this commit",
    menuResetSoft: "Reset --soft to here",
    menuResetHard: "Reset --hard to here",
    menuCreateTag: "Create tag here…",
    menuCreateBranch: "Create branch here…",
    menuCopySha: "Copy SHA",
    menuCopyMessage: "Copy message",
    menuDeleteTag: "Delete tag",
    menuDeleteBranch: "Delete branch",
    menuForceDeleteBranch: "Force delete branch",
    tagModalTitle: "Create Tag",
    tagNameLabel: "Tag name",
    tagMessageLabel: "Message (optional — annotated tag)",
    branchModalTitle: "Create Branch",
    branchNameLabel: "Branch name",
    modalConfirm: "Create",
    modalCancel: "Cancel",
    confirmCherryPickTitle: (hash: string) => `Cherry-pick commit ${hash}?`,
    confirmCherryPickMessage: (hash: string) => `Copies the changes from commit ${hash} and applies them onto your current branch as a new commit. The original commit stays where it is. If the changes conflict, you'll need to resolve them manually.`,
    confirmCherryPickBtn: "Cherry-pick",
    confirmDeleteTagTitle: (name: string) => `Delete tag ${name}?`,
    confirmDeleteTagMessage: (name: string) => `Deletes the tag ${name}. A tag is just a bookmark pointing at a commit — removing it doesn't affect any commit or your code.`,
    confirmDeleteTagBtn: "Delete tag",
    confirmDeleteBranchTitle: (name: string) => `Delete branch ${name}?`,
    confirmDeleteBranchMessage: (name: string) => `Deletes the branch ${name}. If this branch hasn't been merged elsewhere, git will block it to warn you (so you don't lose work).`,
    confirmDeleteBranchBtn: "Delete branch",
    confirmForceDeleteBranchTitle: (name: string) => `Force delete branch ${name}?`,
    confirmForceDeleteBranchMessage: (name: string) => `⚠️ FORCE-deletes the branch ${name} even if it hasn't been merged. Any commits that exist only on this branch may be lost. Please be sure.`,
    confirmForceDeleteBranchBtn: "Force delete",
    toastCherryPicked: "Cherry-pick applied to current branch.",
    toastTagCreated: (name: string) => `Tag ${name} created.`,
    toastBranchCreatedAt: (name: string) => `Branch ${name} created and checked out.`,
    toastCopiedSha: "Commit SHA copied to clipboard.",
    toastCopiedMessage: "Commit message copied to clipboard.",
    toastCopyFailed: "Copy failed.",
    toastTagDeleted: (name: string) => `Tag ${name} deleted.`,
    toastBranchDeleted: (name: string) => `Branch ${name} deleted.`,
    menuCheckoutBranch: "Checkout this branch",
    menuMergeBranch: "Merge into current branch",
    menuRenameBranch: "Rename branch…",
    menuCopyBranchName: "Copy branch name",
    renameModalTitle: "Rename Branch",
    renameNewNameLabel: "New branch name",
    confirmMergeBranchTitle: (name: string) => `Merge branch ${name}?`,
    confirmMergeBranchMessage: (name: string) => `Merges the changes from branch ${name} into your current branch. If both sides changed the same lines you'll get conflicts to resolve manually.`,
    confirmMergeBranchBtn: "Merge",
    toastBranchMerged: (name: string) => `Branch ${name} merged into current branch.`,
    toastBranchRenamed: (name: string) => `Branch renamed to ${name}.`,
    toastCopiedBranch: "Branch name copied to clipboard.",
    pull: "Pull",
    push: "Push",
    fetch: "Fetch",
    aheadBehindTip: "Commits ahead / behind the remote",
    toastPullDone: "Pulled latest changes from remote.",
    toastPushDone: "Pushed to remote.",
    toastFetchDone: "Fetched remote updates.",
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
    settings: "設定",
    settingsLanguage: "介面語言",
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
    geminiSuggestion: "AI 建議",
    commitPlaceholder: "輸入 conventional commit 訊息...",
    commitLabel: "Commit",
    closeLog: "關閉",
    authorLabel: "作者",
    dateLabel: "日期",
    subjectLabel: "說明",
    workspaceTitle: "工作區",
    emptyFolder: "空資料夾",
    codeEditorTitle: "工作區程式編輯器",
    codeEditorHint: "在左欄選擇現有檔案，或點 + 按鈕新增內容。儲存後會更新檔案並標記為未追蹤或已修改。",
    graphTitle: "互動式 Commit 歷史 (DAG)",
    maximizeGraph: "最大化 commit 線圖（收起下方區塊）",
    restoreGraph: "還原版面",
    collapseWorkspace: "收合工作區面板",
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
    toastAiCommitDone: "AI 已根據已 stage 的 diff 產生 conventional commit 訊息！",
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
    confirmCheckoutMessage: "會切換到這個 commit 的狀態來檢視（detached HEAD）——你會暫時不在任何分支上。在這個狀態下做的新 commit，要記得另外開分支才能保存，否則可能會遺失。",
    confirmCheckoutBtn: "確認 Checkout",
    confirmHardResetTitle: (hash: string) => `將 HEAD 硬重置到 commit ${hash}？`,
    confirmHardResetMessage: "⚠️ 會把目前分支移回這個 commit，並且「丟棄」這個 commit 之後的所有 commit，以及尚未提交的改動。這個動作無法復原，請確認。",
    confirmHardResetBtn: "確認硬重置",
    confirmSoftResetTitle: (hash: string) => `將 HEAD 軟重置到 commit ${hash}？`,
    confirmSoftResetMessage: "會把目前分支的指標移回這個 commit，但你工作區和已 stage 的檔案改動都會保留下來。常用來把後面幾個 commit 重新整理成一個。",
    confirmSoftResetBtn: "確認軟重置",
    confirmRevertTitle: (hash: string) => `Revert commit ${hash}？`,
    confirmRevertMessage: "會新增一個 commit 來「抵銷」這個 commit 的變更，等於把它做的事反向做一次。歷史會完整保留，是安全的還原方式。",
    confirmRevertBtn: "確認 Revert",
    aiSettings: "AI 設定",
    aiSettingsTitle: "AI 設定",
    aiProvider: "供應商",
    aiModel: "模型",
    aiCustomModel: "自訂…",
    aiApiKey: "API Key",
    aiEndpoint: "Endpoint URL",
    aiClearKey: "清除",
    aiTest: "測試連線",
    aiTesting: "測試中…",
    aiTestOk: "連線成功",
    aiCancel: "取消",
    aiSave: "儲存",
    aiKeyStoredHint: "已儲存金鑰，留空則保留現有金鑰。",
    toastSetupAiFirst: "請先設定 AI provider。",
    changedFiles: "更動的檔案",
    noChangedFiles: "這個 commit 沒有檔案更動。",
    selectFileForDiff: "選擇檔案以檢視 diff。",
    menuCheckout: "Checkout 到這個 commit",
    menuCherryPick: "Cherry-pick 到目前分支",
    menuRevert: "Revert 這個 commit",
    menuResetSoft: "Reset --soft 到這裡",
    menuResetHard: "Reset --hard 到這裡",
    menuCreateTag: "在這裡打 tag…",
    menuCreateBranch: "從這裡開分支…",
    menuCopySha: "複製 SHA",
    menuCopyMessage: "複製訊息",
    menuDeleteTag: "刪除 tag",
    menuDeleteBranch: "刪除分支",
    menuForceDeleteBranch: "強制刪除分支",
    tagModalTitle: "建立 Tag",
    tagNameLabel: "Tag 名稱",
    tagMessageLabel: "訊息（選填 — 會建立 annotated tag）",
    branchModalTitle: "建立分支",
    branchNameLabel: "分支名稱",
    modalConfirm: "建立",
    modalCancel: "取消",
    confirmCherryPickTitle: (hash: string) => `Cherry-pick commit ${hash}？`,
    confirmCherryPickMessage: (hash: string) => `會把 commit ${hash} 的變更「複製」一份套用到你目前的分支，產生一個新的 commit。原本的 commit 不會被移動。如果內容有衝突，需要你手動解決。`,
    confirmCherryPickBtn: "Cherry-pick",
    confirmDeleteTagTitle: (name: string) => `刪除 tag ${name}？`,
    confirmDeleteTagMessage: (name: string) => `會刪除標籤 ${name}。標籤只是指向某個 commit 的書籤，刪掉它不會影響任何 commit 或程式碼。`,
    confirmDeleteTagBtn: "刪除 tag",
    confirmDeleteBranchTitle: (name: string) => `刪除分支 ${name}？`,
    confirmDeleteBranchMessage: (name: string) => `會刪除分支 ${name}。如果這個分支的內容還沒被合併到別的分支，git 會擋下來提醒你（避免遺失工作）。`,
    confirmDeleteBranchBtn: "刪除分支",
    confirmForceDeleteBranchTitle: (name: string) => `強制刪除分支 ${name}？`,
    confirmForceDeleteBranchMessage: (name: string) => `⚠️ 會「強制」刪除分支 ${name}，即使它還沒被合併。這個分支上只存在於它身上、還沒合併的 commit 可能會遺失。請確認。`,
    confirmForceDeleteBranchBtn: "強制刪除",
    toastCherryPicked: "已 cherry-pick 到目前分支。",
    toastTagCreated: (name: string) => `已建立 tag ${name}。`,
    toastBranchCreatedAt: (name: string) => `已建立並切換到分支 ${name}。`,
    toastCopiedSha: "已複製 commit SHA 到剪貼簿。",
    toastCopiedMessage: "已複製 commit 訊息到剪貼簿。",
    toastCopyFailed: "複製失敗。",
    toastTagDeleted: (name: string) => `已刪除 tag ${name}。`,
    toastBranchDeleted: (name: string) => `已刪除分支 ${name}。`,
    menuCheckoutBranch: "切換到這個分支",
    menuMergeBranch: "合併進目前分支",
    menuRenameBranch: "重新命名分支…",
    menuCopyBranchName: "複製分支名稱",
    renameModalTitle: "重新命名分支",
    renameNewNameLabel: "新的分支名稱",
    confirmMergeBranchTitle: (name: string) => `合併分支 ${name}？`,
    confirmMergeBranchMessage: (name: string) => `會把分支 ${name} 的變更合併進你目前的分支。如果兩邊改到同一處會產生衝突，需要你手動解決。`,
    confirmMergeBranchBtn: "合併",
    toastBranchMerged: (name: string) => `已將分支 ${name} 合併進目前分支。`,
    toastBranchRenamed: (name: string) => `分支已重新命名為 ${name}。`,
    toastCopiedBranch: "已複製分支名稱到剪貼簿。",
    pull: "Pull",
    push: "Push",
    fetch: "Fetch",
    aheadBehindTip: "領先 / 落後遠端的 commit 數",
    toastPullDone: "已從遠端拉取最新變更。",
    toastPushDone: "已推送到遠端。",
    toastFetchDone: "已抓取遠端更新。",
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
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState<boolean>(false);
  const [currentBranch, setCurrentBranch] = useState<string>("main");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [aheadBehind, setAheadBehind] = useState<{ hasUpstream: boolean; ahead: number; behind: number }>({ hasUpstream: false, ahead: 0, behind: 0 });
  const [gitFiles, setGitFiles] = useState<GitFile[]>([]);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState<boolean>(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stashes, setStashes] = useState<StashItem[]>([]);
  
  // Workspace files (all physical files)
  const [sandboxFiles, setSandboxFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  // Command logs telemetry
  const [isGraphMaximized, setIsGraphMaximized] = useState<boolean>(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState<boolean>(true);

  // Focus view states
  const [selectedCommit, setSelectedCommit] = useState<CommitNode | null>(null);
  const [contextMenu, setContextMenu] = useState<{ commit: CommitNode; x: number; y: number } | null>(null);
  const [refMenu, setRefMenu] = useState<{ refName: string; kind: string; x: number; y: number } | null>(null);
  const [renameModal, setRenameModal] = useState<{ branch: string } | null>(null);
  const [inputModal, setInputModal] = useState<{ mode: "tag" | "branch"; commit: CommitNode } | null>(null);
  const [diffTarget, setDiffTarget] = useState<{ path: string; staged: boolean } | null>(null);
  const [commitFiles, setCommitFiles] = useState<{ status: string; path: string }[]>([]);
  const [commitDiffFile, setCommitDiffFile] = useState<string | null>(null);
  
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
        setAheadBehind({
          hasUpstream: !!statusData.hasUpstream,
          ahead: statusData.ahead ?? 0,
          behind: statusData.behind ?? 0,
        });
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

  // Load the changed-file list whenever a commit is selected.
  useEffect(() => {
    if (!selectedCommit) {
      setCommitFiles([]);
      setCommitDiffFile(null);
      return;
    }
    setCommitDiffFile(null);
    fetch("/api/git/commit/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit: selectedCommit.hash }),
    })
      .then((res) => res.json())
      .then((data) => {
        const files = Array.isArray(data.files) ? data.files : [];
        setCommitFiles(files);
        // Auto-open the first file's diff so the right panel isn't empty.
        if (files.length > 0) setCommitDiffFile(files[0].path);
      })
      .catch(() => setCommitFiles([]));
  }, [selectedCommit]);

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

  // 5. Commit with AI message generation
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

    try {
      const settingsRes = await fetch("/api/ai/settings");
      if (!settingsRes.ok) throw new Error("Could not load AI settings");
      const settings = await settingsRes.json();
      if (!settings.hasKey) {
        showToast(t.toastSetupAiFirst, true);
        setIsAiSettingsOpen(true);
        return;
      }
    } catch {
      showToast(t.toastSetupAiFirst, true);
      setIsAiSettingsOpen(true);
      return;
    }

    setIsAiLoading(true);
    try {
      const res = await fetch("/api/git/ai/commit-message", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not invoke AI provider.");
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

  const handleCherryPick = (commit: CommitNode) => {
    requestConfirm(
      t.confirmCherryPickTitle(commit.hash),
      t.confirmCherryPickMessage(commit.hash),
      async () => {
        try {
          const res = await fetch("/api/git/cherry-pick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commit: commit.hash }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Cherry-pick failed");
          showToast(t.toastCherryPicked);
          refreshState();
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "Cherry-pick failed", true);
        }
      },
      t.confirmCherryPickBtn,
      "bg-amber-600 hover:bg-amber-500"
    );
  };

  const handleCreateTag = async (commit: CommitNode, name: string, message: string) => {
    try {
      const res = await fetch("/api/git/tag/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, commit: commit.hash, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create tag");
      showToast(t.toastTagCreated(name));
      refreshState();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to create tag", true);
    }
  };

  const handleCreateBranchAt = async (commit: CommitNode, name: string) => {
    try {
      const res = await fetch("/api/git/branch/create-at", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, commit: commit.hash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create branch");
      showToast(t.toastBranchCreatedAt(name));
      setSelectedCommit(null);
      refreshState();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to create branch", true);
    }
  };

  const handleCopy = async (text: string, kind: "sha" | "message") => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(kind === "sha" ? t.toastCopiedSha : t.toastCopiedMessage);
    } catch {
      showToast(t.toastCopyFailed, true);
    }
  };

  const handleDeleteTag = (name: string) => {
    requestConfirm(
      t.confirmDeleteTagTitle(name),
      t.confirmDeleteTagMessage(name),
      async () => {
        try {
          const res = await fetch("/api/git/tag/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to delete tag");
          showToast(t.toastTagDeleted(name));
          refreshState();
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "Failed to delete tag", true);
        }
      },
      t.confirmDeleteTagBtn,
      "bg-rose-600 hover:bg-rose-500"
    );
  };

  const handleDeleteBranch = (name: string, force: boolean) => {
    requestConfirm(
      force ? t.confirmForceDeleteBranchTitle(name) : t.confirmDeleteBranchTitle(name),
      force ? t.confirmForceDeleteBranchMessage(name) : t.confirmDeleteBranchMessage(name),
      async () => {
        try {
          const res = await fetch("/api/git/branch/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, force }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to delete branch");
          showToast(t.toastBranchDeleted(name));
          refreshState();
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "Failed to delete branch", true);
        }
      },
      force ? t.confirmForceDeleteBranchBtn : t.confirmDeleteBranchBtn,
      "bg-rose-600 hover:bg-rose-500"
    );
  };

  const handleMergeBranchFromMenu = (name: string) => {
    requestConfirm(
      t.confirmMergeBranchTitle(name),
      t.confirmMergeBranchMessage(name),
      async () => {
        try {
          const res = await fetch("/api/git/branch/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Merge failed");
          showToast(t.toastBranchMerged(name));
          refreshState();
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "Merge failed", true);
        }
      },
      t.confirmMergeBranchBtn,
      "bg-cyan-600 hover:bg-cyan-500"
    );
  };

  const handleRenameBranch = async (oldName: string, newName: string) => {
    try {
      const res = await fetch("/api/git/branch/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldName, newName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rename failed");
      showToast(t.toastBranchRenamed(newName));
      refreshState();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Rename failed", true);
    }
  };

  const handleCopyBranchName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      showToast(t.toastCopiedBranch);
    } catch {
      showToast(t.toastCopyFailed, true);
    }
  };

  const runSync = async (path: string, okToast: string, failFallback: string) => {
    setIsSyncing(true);
    try {
      const res = await fetch(path, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || failFallback);
      showToast(okToast);
      refreshState();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : failFallback, true);
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePull = () => runSync("/api/git/pull", t.toastPullDone, "Pull failed");
  const handlePush = () => runSync("/api/git/push", t.toastPushDone, "Push failed");
  const handleFetch = () => runSync("/api/git/fetch", t.toastFetchDone, "Fetch failed");

  const renderRepoSidebar = () => (
    <aside className={`${isRepoSidebarCollapsed ? "w-12" : "w-[280px]"} h-full bg-slate-950 border-r border-slate-900 shrink-0 transition-all duration-200 flex flex-col`}>
      <div className="h-12 px-3 border-b border-slate-900 flex items-center justify-between">
        {!isRepoSidebarCollapsed && (
          <span className="text-[12px] font-mono font-bold uppercase text-slate-400 tracking-wider">{t.repositories}</span>
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
              <div className="p-3 text-[12px] font-mono text-slate-600 text-center">{t.noRepositories}</div>
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
                        <span className="block text-[12px] font-mono text-slate-600 truncate">{repo.path}</span>
                      </div>
                      {isActive && <span className="text-[12px] text-cyan-400 font-mono uppercase">{t.active}</span>}
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
                <span className="text-[12px] font-mono font-bold uppercase text-slate-500">{t.gitIdentity}</span>
              </div>
              <div className="space-y-2">
                <input
                  value={gitUserName}
                  onChange={(e) => setGitUserName(e.target.value)}
                  placeholder={t.userName}
                  className="w-full bg-slate-900 text-slate-200 border border-slate-800 rounded font-mono text-[12px] px-2 py-1.5 focus:outline-none focus:border-cyan-500"
                />
                <input
                  value={gitUserEmail}
                  onChange={(e) => setGitUserEmail(e.target.value)}
                  placeholder={t.userEmail}
                  className="w-full bg-slate-900 text-slate-200 border border-slate-800 rounded font-mono text-[12px] px-2 py-1.5 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-[12px] font-mono font-bold py-1.5 rounded border border-slate-700"
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
          <div className="px-2 py-1 text-[12px] font-mono font-bold uppercase tracking-wider text-slate-500">{t.repositories}</div>
          {managedRepos.length === 0 ? (
            <div className="p-3 text-[12px] font-mono text-slate-600 text-center">{t.noRepositories}</div>
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
                      <span className="block text-[12px] font-mono text-slate-600 truncate">{repo.path}</span>
                    </div>
                    {isActive && <span className="text-[12px] text-cyan-400 font-mono uppercase shrink-0">{t.active}</span>}
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
          <div className="text-[12px] font-mono font-bold uppercase tracking-wider text-slate-500">{t.openNew}</div>

          <form onSubmit={handleOpenRepo} className="space-y-1.5">
            <label className="block text-[12px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.openLocalFolder}</label>
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
            <label className="block text-[12px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.cloneRepo}</label>
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
            <label className="block text-[12px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.initFolder}</label>
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
            <span className="text-[12px] font-mono font-bold uppercase text-slate-500">{t.gitIdentity}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={gitUserName}
              onChange={(e) => setGitUserName(e.target.value)}
              placeholder={t.userName}
              className="flex-1 min-w-0 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-[12px] px-2 py-1.5 focus:outline-none focus:border-cyan-500"
            />
            <input
              value={gitUserEmail}
              onChange={(e) => setGitUserEmail(e.target.value)}
              placeholder={t.userEmail}
              className="flex-1 min-w-0 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-[12px] px-2 py-1.5 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[12px] font-mono px-3 py-1.5 rounded border border-slate-700 cursor-pointer shrink-0"
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
            className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-slate-100 font-mono border border-slate-800 px-2 py-1 rounded"
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
              <label className="block text-[12px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.openLocalFolder}</label>
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
              <span className="relative px-3 bg-slate-900 text-slate-500 font-mono text-[12px] uppercase tracking-wider">{t.orClone}</span>
            </div>

            <form onSubmit={handleCloneRepo} className="space-y-3">
              <label className="block text-[12px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.cloneRepo}</label>
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
              <span className="block text-[12px] text-slate-500 font-mono italic">
                {t.targetMustBeEmpty}
              </span>
            </form>

            <div className="relative my-5 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-800" />
              </div>
              <span className="relative px-3 bg-slate-900 text-slate-500 font-mono text-[12px] uppercase tracking-wider">{t.orInit}</span>
            </div>

            <form onSubmit={handleInitRepo} className="space-y-3">
              <label className="block text-[12px] font-mono text-slate-400 font-bold uppercase tracking-wider">{t.initFolder}</label>
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

        <footer className="py-4 text-center border-t border-slate-900 bg-slate-950 text-[12px] text-slate-600 font-mono">
          Powered by Tauri, local Git, and AI
        </footer>
      </div>
    );
  }

  const buildCommitMenuItems = (commit: CommitNode): CommitContextMenuItem[] => [
    {
      key: "checkout",
      label: t.menuCheckout,
      onSelect: () => requestConfirm(
        t.confirmCheckoutTitle(commit.hash),
        t.confirmCheckoutMessage,
        async () => {
          setIsActionLoading(true);
          try {
            const res = await fetch("/api/git/branch/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: commit.hash }),
            });
            if (!res.ok) throw new Error("Hard checkout error");
            showToast(t.toastCheckedOut(commit.hash));
            setSelectedCommit(null);
            refreshState();
          } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : "Checkout failed", true);
          } finally {
            setIsActionLoading(false);
          }
        },
        t.confirmCheckoutBtn,
        "bg-amber-600 hover:bg-amber-500"
      ),
    },
    { key: "cherry", label: t.menuCherryPick, onSelect: () => handleCherryPick(commit) },
    {
      key: "revert",
      label: t.menuRevert,
      onSelect: () => requestConfirm(
        t.confirmRevertTitle(commit.hash),
        t.confirmRevertMessage,
        () => handleGitRevert(commit.hash),
        t.confirmRevertBtn,
        "bg-purple-600 hover:bg-purple-500"
      ),
    },
    {
      key: "soft",
      label: t.menuResetSoft,
      dividerBefore: true,
      onSelect: () => requestConfirm(
        t.confirmSoftResetTitle(commit.hash),
        t.confirmSoftResetMessage,
        () => handleGitReset(commit.hash, "soft"),
        t.confirmSoftResetBtn,
        "bg-cyan-600 hover:bg-cyan-500"
      ),
    },
    {
      key: "hard",
      label: t.menuResetHard,
      danger: true,
      onSelect: () => requestConfirm(
        t.confirmHardResetTitle(commit.hash),
        t.confirmHardResetMessage,
        () => handleGitReset(commit.hash, "hard"),
        t.confirmHardResetBtn,
        "bg-rose-600 hover:bg-rose-500"
      ),
    },
    { key: "tag", label: t.menuCreateTag, dividerBefore: true, onSelect: () => setInputModal({ mode: "tag", commit }) },
    { key: "branch", label: t.menuCreateBranch, onSelect: () => setInputModal({ mode: "branch", commit }) },
    { key: "copysha", label: t.menuCopySha, dividerBefore: true, onSelect: () => handleCopy(commit.hash, "sha") },
    { key: "copymsg", label: t.menuCopyMessage, onSelect: () => handleCopy(commit.message, "message") },
  ];

  const buildRefMenuItems = (refName: string, kind: string): CommitContextMenuItem[] => {
    if (kind === "tag") {
      return [{ key: "deltag", label: `${t.menuDeleteTag} ${refName}`, danger: true, onSelect: () => handleDeleteTag(refName) }];
    }
    if (kind === "head") {
      // Current branch: checkout-self / merge-self / delete-self don't apply.
      return [
        { key: "rename", label: t.menuRenameBranch, onSelect: () => setRenameModal({ branch: refName }) },
        { key: "copy", label: t.menuCopyBranchName, onSelect: () => handleCopyBranchName(refName) },
      ];
    }
    // other local branch
    return [
      { key: "checkout", label: t.menuCheckoutBranch, onSelect: () => handleCheckoutBranch(refName) },
      { key: "merge", label: t.menuMergeBranch, onSelect: () => handleMergeBranchFromMenu(refName) },
      { key: "rename", label: t.menuRenameBranch, dividerBefore: true, onSelect: () => setRenameModal({ branch: refName }) },
      { key: "copy", label: t.menuCopyBranchName, onSelect: () => handleCopyBranchName(refName) },
      { key: "delbranch", label: `${t.menuDeleteBranch} ${refName}`, dividerBefore: true, onSelect: () => handleDeleteBranch(refName, false) },
      { key: "forcedel", label: `${t.menuForceDeleteBranch} ${refName}`, danger: true, onSelect: () => handleDeleteBranch(refName, true) },
    ];
  };

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
      <nav id="workspace-nav" className="relative px-6 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-end shrink-0 gap-3">
        {/* Branch / repo selector — absolutely centered so it stays mid-header as the window widens */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center min-w-0 max-w-[40%] z-10">
          <button
            onClick={() => setIsRepoPanelOpen((v) => !v)}
            title={t.switchRepo}
            className="flex items-center space-x-2 bg-slate-950 border border-slate-800 hover:border-slate-600 px-3 py-1.5 rounded-md cursor-pointer transition-colors min-w-0 max-w-full"
          >
            <GitBranch className="h-4 w-4 text-cyan-400 animate-pulse shrink-0" />
            <span className="text-cyan-400 font-mono font-bold text-xs uppercase tracking-wider shrink-0">{currentBranch}</span>
            {aheadBehind.hasUpstream && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
              <span className="flex items-center gap-1 text-[12px] font-mono shrink-0" title={t.aheadBehindTip}>
                {aheadBehind.ahead > 0 && <span className="text-emerald-400">↑{aheadBehind.ahead}</span>}
                {aheadBehind.behind > 0 && <span className="text-amber-400">↓{aheadBehind.behind}</span>}
              </span>
            )}
            <span className="text-slate-500 font-mono text-xs truncate min-w-0">{workspacePath}</span>
            <ChevronDown className={`h-3.5 w-3.5 text-slate-500 shrink-0 transition-transform ${isRepoPanelOpen ? "rotate-180" : ""}`} />
          </button>
          {isRepoPanelOpen && renderRepoPanel()}
        </div>

        {/* Action controllers: checkout, merge & settings (right-aligned, above the centered selector) */}
        <div className="flex items-center justify-end gap-3 shrink-0 z-20">
          {/* Pull / Push / Fetch sync buttons */}
          <button
            onClick={handlePull}
            disabled={isSyncing}
            title={t.pull}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 rounded border border-slate-700/80 transition-all cursor-pointer disabled:opacity-50 text-[12px] font-mono"
          >
            {isSyncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span>{t.pull}</span>
          </button>
          <button
            onClick={handlePush}
            disabled={isSyncing}
            title={t.push}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 rounded border border-slate-700/80 transition-all cursor-pointer disabled:opacity-50 text-[12px] font-mono"
          >
            {isSyncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            <span>{t.push}</span>
          </button>
          <button
            onClick={handleFetch}
            disabled={isSyncing}
            title={t.fetch}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 rounded border border-slate-700/80 transition-all cursor-pointer disabled:opacity-50 text-[12px] font-mono"
          >
            {isSyncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
            <span>{t.fetch}</span>
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
          <div className="flex items-center space-x-1.5 bg-slate-950 px-2 py-1 rounded border border-slate-800 shrink-0">
            <span className="text-[12px] text-slate-500 font-mono font-bold uppercase whitespace-nowrap">{t.checkout}</span>
            <select
              value={currentBranch}
              onChange={(e) => handleCheckoutBranch(e.target.value)}
              className="bg-transparent text-slate-200 border-none outline-none font-mono text-xs cursor-pointer focus:ring-0 py-0 max-w-[150px] truncate"
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
                className="bg-purple-950 hover:bg-purple-900 border border-purple-800 text-purple-400 text-[12px] font-mono leading-none px-2.5 py-1.5 rounded transition-all cursor-pointer"
              >
                {t.merge}
              </button>
            </form>
          )}

          {/* Settings dropdown: language switch + close repository */}
          <div className="relative shrink-0">
            <button
              onClick={() => setIsSettingsOpen((v) => !v)}
              title={t.settings}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-slate-100 rounded border border-slate-700/80 transition-all cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
            {isSettingsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsSettingsOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-56 bg-slate-900 border border-slate-800 rounded-lg shadow-xl z-50 p-1.5">
                  <div className="px-2 pt-1 pb-2 text-[12px] text-slate-500 font-mono font-bold uppercase tracking-wider">{t.settings}</div>

                  {/* Language */}
                  <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800/60">
                    <span className="flex items-center gap-1.5 text-xs text-slate-300 font-mono">
                      <Languages className="h-3.5 w-3.5 text-slate-400" />
                      {t.settingsLanguage}
                    </span>
                    <button
                      onClick={() => setLanguage(language === "en" ? "zh" : "en")}
                      className="text-[12px] text-slate-300 hover:text-slate-100 font-mono border border-slate-700 px-2 py-0.5 rounded bg-slate-950"
                    >
                      {language === "en" ? "中文" : "EN"}
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      setIsSettingsOpen(false);
                      setIsAiSettingsOpen(true);
                    }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800/60 rounded font-mono cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                    {t.aiSettings}
                  </button>

                  <div className="my-1 border-t border-slate-800" />

                  {/* Close repository */}
                  <button
                    onClick={() => {
                      setIsSettingsOpen(false);
                      requestConfirm(
                        t.closeRepoTitle,
                        t.closeRepoMessage,
                        handleWipeRepo,
                        t.closeRepo,
                        "bg-slate-700 hover:bg-slate-600"
                      );
                    }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded font-mono cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t.closeRepo}
                  </button>
                </div>
              </>
            )}
          </div>
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
              <span className="text-[12px] uppercase font-bold tracking-wider font-mono text-slate-500">{t.indexStageControl}</span>
              <div className="flex space-x-2">
                {gitFiles.length > 0 && (
                  <>
                    <button
                      onClick={handleStageAll}
                      className="text-[12px] text-emerald-400 font-mono hover:underline"
                    >
                      {t.stageAll}
                    </button>
                    <button
                      onClick={handleUnstageAll}
                      className="text-[12px] text-amber-500 font-mono hover:underline"
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
                <p className="text-slate-500 text-[12px] font-mono">{t.workingClean}</p>
                <p className="text-slate-600 text-[12px] max-w-[200px] mt-1">
                  {t.editFilesHint}
                </p>
              </div>
            ) : (
              <div className="space-y-4 overflow-y-auto">
                {/* Unstaged / Working Tree block */}
                {modifiedFiles.length > 0 && (
                  <div>
                    <span className="text-[12px] text-amber-400 font-mono font-bold block mb-1">{t.unstagedChanges} ({modifiedFiles.length})</span>
                    <div className="space-y-1 bg-slate-950/60 p-1.5 rounded-lg border border-slate-850">
                      {modifiedFiles.map((file) => (
                        <div key={file.path} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-slate-900/30 hover:bg-slate-900/80 transition-colors">
                          <div className="flex items-center space-x-2 truncate pr-2">
                            <span className="text-[12px] px-1 bg-amber-950 text-amber-400 rounded font-semibold shrink-0 uppercase">
                              {file.displayStatus === "Untracked" ? "U" : "M"}
                            </span>
                            <span className="font-mono text-[12px] text-slate-300 truncate" title={file.path}>{file.path}</span>
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
                              className="text-[12px] text-emerald-400 bg-emerald-950/20 border border-emerald-900 px-1.5 py-0.5 rounded hover:bg-emerald-900/40 transition-colors cursor-pointer font-mono"
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
                    <span className="text-[12px] text-emerald-400 font-mono font-bold block mb-1">{t.stagedChanges} ({stagedFiles.length})</span>
                    <div className="space-y-1 bg-slate-950/60 p-1.5 rounded-lg border border-slate-850">
                      {stagedFiles.map((file) => (
                        <div key={file.path} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-slate-900/30 hover:bg-slate-900/80 transition-colors">
                          <div className="flex items-center space-x-2 truncate pr-2">
                            <span className="text-[12px] px-1 bg-emerald-950 text-emerald-400 rounded font-semibold shrink-0 uppercase">staged</span>
                            <span className="font-mono text-[12px] text-slate-300 truncate" title={file.path}>{file.path}</span>
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
                              className="text-[12px] text-amber-400 bg-amber-950/20 border border-amber-900 px-1.5 py-0.5 rounded hover:bg-amber-950/40 transition-colors cursor-pointer font-mono"
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
              <span className="text-[12px] uppercase font-bold tracking-wider font-mono text-slate-500">{t.gitStashes} ({stashes.length})</span>
              {stashes.length > 0 && (
                <button
                  onClick={handlePopStash}
                  className="text-[12px] text-teal-400 hover:underline font-mono"
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
                className="flex-1 bg-slate-950 text-slate-200 border border-slate-800 rounded font-mono text-[12px] px-2 py-1 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[12px] px-2 py-1 rounded font-mono"
              >
                {t.stash}
              </button>
            </form>

            {stashes.length > 0 && (
              <div className="space-y-1 bg-slate-950/40 p-2 rounded-lg border border-slate-800 font-mono text-[12px] max-h-[80px] overflow-y-auto">
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
              <span className="text-[12px] uppercase font-bold tracking-wider font-mono text-slate-500">{t.commitment}</span>
              <button
                type="button"
                onClick={handleAiSuggestedCommitMessage}
                disabled={isAiLoading}
                className="flex items-center space-x-1 text-amber-400 hover:text-amber-300 font-mono text-[12px] tracking-wide"
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
          <div className={isGraphMaximized ? "flex-1 min-h-0" : "h-[43%] min-h-[220px]"}>
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
              isMaximized={isGraphMaximized}
              onToggleMaximize={() => setIsGraphMaximized((v) => !v)}
              maximizeTitle={isGraphMaximized ? t.restoreGraph : t.maximizeGraph}
              onSelectCommit={(commit) => {
                setSelectedCommit(commit);
                setDiffTarget(null); // click a commit clears instant diff targets
              }}
              onCommitContextMenu={(commit, x, y) => setContextMenu({ commit, x, y })}
              onRefContextMenu={(ref, x, y) => setRefMenu({ refName: ref.name, kind: ref.kind, x, y })}
            />
          </div>

          {/* Bottom Panel + CLI 在線圖最大化時整批收起，讓 commit 線圖吃滿高度 */}
          {!isGraphMaximized && (
          <>
          {/* Bottom Panel: Split screen (Code editor / Diff viewer / Commit Details) */}
          {isWorkspaceOpen ? (
          <div className="flex-1 overflow-hidden min-h-[300px]">
            {diffTarget ? (
              <DiffViewer
                file={diffTarget.path}
                staged={diffTarget.staged}
                lang={language}
                onClose={() => setDiffTarget(null)}
                onNeedAiSetup={() => {
                  showToast(t.toastSetupAiFirst, true);
                  setIsAiSettingsOpen(true);
                }}
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

                <div className="flex-1 flex overflow-hidden">
                  <div className="w-[42%] min-w-[260px] p-5 overflow-auto space-y-4 border-r border-slate-800">
                  <div className="grid grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-lg border border-slate-800">
                    <div>
                      <span className="text-[12px] text-slate-500 block font-mono font-bold uppercase">{t.authorLabel}</span>
                      <span className="text-slate-350 text-xs font-mono">{selectedCommit.author}</span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-500 block font-mono font-bold uppercase">{t.dateLabel}</span>
                      <span className="text-slate-350 text-xs font-mono">{selectedCommit.date}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[12px] text-slate-500 block font-mono font-bold uppercase">{t.subjectLabel}</span>
                      <pre className="text-slate-200 text-xs font-semibold font-mono whitespace-pre-wrap bg-slate-950 p-2 border border-slate-900 rounded mt-1">{selectedCommit.message}</pre>
                    </div>
                  </div>

                  {/* Changed files in this commit */}
                  <div>
                    <h5 className="text-slate-400 text-xs font-bold font-mono uppercase tracking-wider mb-2">{t.changedFiles} ({commitFiles.length})</h5>
                    {commitFiles.length === 0 ? (
                      <span className="text-slate-600 text-[12px] font-mono italic">{t.noChangedFiles}</span>
                    ) : (
                      <div className="space-y-1 bg-slate-950/60 p-1.5 rounded-lg border border-slate-850">
                        {commitFiles.map((file) => (
                          <button
                            key={file.path}
                            onClick={() => setCommitDiffFile(file.path)}
                            className={`w-full flex items-center space-x-2 text-xs px-2 py-1.5 rounded transition-colors text-left cursor-pointer ${
                              commitDiffFile === file.path ? "bg-cyan-950/40 border border-cyan-800/60" : "bg-slate-900/30 hover:bg-slate-900/80 hover:border-slate-700 border border-transparent"
                            }`}
                          >
                            <span className="text-[12px] px-1 bg-slate-800 text-slate-300 rounded font-semibold shrink-0 uppercase w-5 text-center">{file.status.charAt(0)}</span>
                            <span className="font-mono text-[12px] text-slate-300 truncate" title={file.path}>{file.path}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  </div>

                  {/* Right panel: diff of the selected file in this commit */}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    {commitDiffFile ? (
                      <DiffViewer
                        key={`${selectedCommit.hash}:${commitDiffFile}`}
                        file={commitDiffFile}
                        staged={false}
                        commitHash={selectedCommit.hash}
                        lang={language}
                        onClose={() => setCommitDiffFile(null)}
                        onNeedAiSetup={() => {
                          showToast(t.toastSetupAiFirst, true);
                          setIsAiSettingsOpen(true);
                        }}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-600 text-xs font-mono italic px-6 text-center">
                        {t.selectFileForDiff}
                      </div>
                    )}
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
                onCollapse={() => setIsWorkspaceOpen(false)}
                collapseTitle={t.collapseWorkspace}
              />
            )}
          </div>
          ) : (
            <button
              onClick={() => setIsWorkspaceOpen(true)}
              className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors cursor-pointer shrink-0"
            >
              <span className="text-slate-400 font-bold text-xs font-mono tracking-wide uppercase">{t.workspaceTitle}</span>
              <span className="text-slate-500 font-mono text-[12px] font-bold">Expand [ + ]</span>
            </button>
          )}
          </>
          )}

        </div>

      </div>

      <footer className="px-6 py-3 bg-slate-950 border-t border-slate-900 flex items-center justify-between text-[12px] text-slate-600 font-mono shrink-0">
        <div className="flex items-center space-x-2">
          <span>{t.simulationActive}</span>
          <span className="inline-block h-1.5 w-1.5 bg-emerald-500 rounded-full animate-ping" />
        </div>
        <span>{t.refreshedAt} {new Date().toLocaleTimeString()}</span>
      </footer>

      <AiSettingsModal
        open={isAiSettingsOpen}
        onClose={() => setIsAiSettingsOpen(false)}
        labels={{
          title: t.aiSettingsTitle,
          provider: t.aiProvider,
          model: t.aiModel,
          custom: t.aiCustomModel,
          apiKey: t.aiApiKey,
          endpoint: t.aiEndpoint,
          clear: t.aiClearKey,
          test: t.aiTest,
          testing: t.aiTesting,
          testOk: t.aiTestOk,
          cancel: t.aiCancel,
          save: t.aiSave,
          keyStoredHint: t.aiKeyStoredHint,
        } satisfies AiSettingsLabels}
      />

      {contextMenu && (
        <CommitContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildCommitMenuItems(contextMenu.commit)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {refMenu && (
        <CommitContextMenu
          x={refMenu.x}
          y={refMenu.y}
          items={buildRefMenuItems(refMenu.refName, refMenu.kind)}
          onClose={() => setRefMenu(null)}
        />
      )}

      {renameModal && (
        <CommitInputModal
          open
          title={t.renameModalTitle}
          fields={[{ key: "newName", label: t.renameNewNameLabel, placeholder: renameModal.branch, required: true }]}
          confirmLabel={t.modalConfirm}
          cancelLabel={t.modalCancel}
          onConfirm={(values) => {
            const oldName = renameModal.branch;
            setRenameModal(null);
            handleRenameBranch(oldName, values.newName.trim());
          }}
          onClose={() => setRenameModal(null)}
        />
      )}

      {inputModal?.mode === "tag" && (
        <CommitInputModal
          open
          title={t.tagModalTitle}
          fields={[
            { key: "name", label: t.tagNameLabel, placeholder: "v1.0.0", required: true },
            { key: "message", label: t.tagMessageLabel, multiline: true },
          ]}
          confirmLabel={t.modalConfirm}
          cancelLabel={t.modalCancel}
          onConfirm={(values) => {
            const commit = inputModal.commit;
            setInputModal(null);
            handleCreateTag(commit, values.name.trim(), (values.message ?? "").trim());
          }}
          onClose={() => setInputModal(null)}
        />
      )}

      {inputModal?.mode === "branch" && (
        <CommitInputModal
          open
          title={t.branchModalTitle}
          fields={[{ key: "name", label: t.branchNameLabel, placeholder: "feature/my-branch", required: true }]}
          confirmLabel={t.modalConfirm}
          cancelLabel={t.modalCancel}
          onConfirm={(values) => {
            const commit = inputModal.commit;
            setInputModal(null);
            handleCreateBranchAt(commit, values.name.trim());
          }}
          onClose={() => setInputModal(null)}
        />
      )}

      {/* Custom Confirmation Dialog Overlay */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
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
