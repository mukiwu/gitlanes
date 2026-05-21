import express from "express";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

dotenv.config();

const execAsync = promisify(exec);
const app = express();
const PORT = 3000;
const sandboxPath = path.join(process.cwd(), "git-sandbox");

interface CommandLog {
  timestamp: string;
  command: string;
  code: number;
  stdout: string;
  stderr: string;
}
const gitHistory: CommandLog[] = [];

function logCommand(command: string, code: number, stdout: string, stderr: string) {
  gitHistory.unshift({
    timestamp: new Date().toLocaleTimeString(),
    command,
    code,
    stdout,
    stderr,
  });
  if (gitHistory.length > 50) {
    gitHistory.pop();
  }
}

app.use(express.json());

// Helper to run commands in the sandbox directory
async function runGit(cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: sandboxPath });
    const trimmedOut = stdout.trim();
    const trimmedErr = stderr.trim();
    logCommand(cmd, 0, trimmedOut, trimmedErr);
    return { stdout: trimmedOut, stderr: trimmedErr, code: 0 };
  } catch (error: any) {
    const errOut = error.stdout ? error.stdout.trim() : "";
    const errErr = error.stderr ? error.stderr.trim() : error.message || String(error);
    const errCode = error.code !== undefined ? error.code : 1;
    logCommand(cmd, errCode, errOut, errErr);
    return {
      stdout: errOut,
      stderr: errErr,
      code: errCode,
    };
  }
}

// Ensure the sandbox exists
function ensureSandbox() {
  if (!fs.existsSync(sandboxPath)) {
    fs.mkdirSync(sandboxPath, { recursive: true });
  }
}

// Lazy-initialize Gemini client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured. Please add it to your secrets panel.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// API Routes

// Helper to check if sandbox is a git repo
app.get("/api/git/status", async (req, res) => {
  try {
    ensureSandbox();
    const isGitRepo = fs.existsSync(path.join(sandboxPath, ".git"));
    if (!isGitRepo) {
      return res.json({ initialized: false, files: [], currentBranch: "none" });
    }

    // Get current branch
    let currentBranch = "main";
    const branchRes = await runGit("git branch --show-current");
    if (branchRes.code === 0 && branchRes.stdout) {
      currentBranch = branchRes.stdout;
    } else {
      const revRes = await runGit("git rev-parse --abbrev-ref HEAD");
      if (revRes.code === 0 && revRes.stdout) {
        currentBranch = revRes.stdout;
      }
    }

    // Get porcelian status
    // xy status code
    const statusRes = await runGit("git status --porcelain");
    const statusLines = statusRes.stdout.split("\n").filter(Boolean);

    const files = statusLines.map((line) => {
      const x = line[0];
      const y = line[1];
      let filePath = line.substring(3).trim();
      
      // Handles status with rename: "R  old -> new"
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ")[1].trim();
      }

      // Staged changes: if X is not spacer, and not untracked '?'
      const staged = x !== " " && x !== "?";
      // Working tree changes: if Y is not spacer, or it is untracked '?'
      const modified = y !== " " || x === "?";

      let displayStatus = "Modified";
      if (x === "?" && y === "?") {
        displayStatus = "Untracked";
      } else if (x === "A") {
        displayStatus = "Added";
      } else if (x === "D" || y === "D") {
        displayStatus = "Deleted";
      } else if (x === "U" || y === "U") {
        displayStatus = "Conflict";
      } else if (staged && modified) {
        displayStatus = "Partially Staged";
      } else if (staged) {
        displayStatus = "Staged";
      }

      return {
        path: filePath,
        status: line.substring(0, 2),
        x,
        y,
        staged,
        modified,
        displayStatus,
      };
    });

    res.json({
      initialized: true,
      currentBranch,
      files,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize Git sandbox repo with boilerplates
app.post("/api/git/init", async (req, res) => {
  try {
    ensureSandbox();
    const template = req.body.template || "simple";

    // Clean existing git files if any
    const gitDir = path.join(sandboxPath, ".git");
    if (fs.existsSync(gitDir)) {
      await execAsync("rm -rf .git", { cwd: sandboxPath });
    }

    // Write boilerplate templates
    if (template === "simple") {
      fs.writeFileSync(path.join(sandboxPath, "README.md"), `# Welcome to Git Sandbox 🚀\n\nThis is a simulation repo designed to demonstrate Git concepts.\nModify any file and look at the Staging changes live!\n`);
      fs.writeFileSync(path.join(sandboxPath, "index.js"), `// Git Sandbox entry code\nconsole.log("Welcome to Git Sandbox!");\n\nfunction calculateSum(a, b) {\n  return a + b;\n}\n\nconsole.log("Result:", calculateSum(5, 7));\n`);
      fs.writeFileSync(path.join(sandboxPath, "styles.css"), `/* Git styling boilerplate */\nbody {\n  font-family: 'Inter', sans-serif;\n  background: #f8fafc;\n  color: #1e293b;\n}\n\n.card {\n  padding: 16px;\n  border-radius: 8px;\n  border: 1px solid #e2e8f0;\n}\n`);
    } else if (template === "calculator") {
      fs.writeFileSync(path.join(sandboxPath, "README.md"), `# Smart Calculator Project\n\nThis calculator will perform calculations through node.\n`);
      fs.writeFileSync(path.join(sandboxPath, "calc.js"), `class Calculator {\n  add(a, b) {\n    return a + b;\n  }\n  subtract(a, b) {\n    return a - b;\n  }\n  multiply(a, b) {\n    return a * b;\n  }\n}\nmodule.exports = Calculator;\n`);
      fs.writeFileSync(path.join(sandboxPath, "package.json"), `{\n  "name": "calculator",\n  "version": "1.0.0",\n  "main": "calc.js"\n}\n`);
    } else {
      fs.writeFileSync(path.join(sandboxPath, "README.md"), `# Empty Custom Project\n\nCreate some files in the UI to get started!\n`);
    }

    // Run git init
    await execAsync("git init -b main", { cwd: sandboxPath }).catch(() => execAsync("git init", { cwd: sandboxPath }));
    
    // Set mock local users to prevent commit blocker in Cloud Run
    await runGit('git config user.name "Sandbox Coder"');
    await runGit('git config user.email "sandbox@aisbuild.local"');

    res.json({ success: true, message: "Initialized git sandbox repository!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Completely wipe/de-initialize repository (remove .git and metadata to return to welcome screen)
app.post("/api/git/wipe", async (req, res) => {
  try {
    ensureSandbox();
    
    // Wipe sandbox completely but keep the folder itself
    // We run rm -rf on wildcard patterns to eliminate files, hidden files, and folder directories
    await execAsync("rm -rf * .git .gitignore .gitattributes", { cwd: sandboxPath }).catch(() => {});
    
    // Re-verify workspace folder is present
    ensureSandbox();

    res.json({ success: true, message: "Workspace sandbox successfully wiped and de-initialized!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to wipe workspace." });
  }
});

// Clone a public GitHub/GitLab repository into sandbox
app.post("/api/git/clone", async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ error: "Repository URL is required" });
    }

    // Strict URL validation to prevent any shell injection
    const gitUrlRegex = /^https:\/\/[a-zA-Z0-9.\-_~%#?=&:\\/]+$/;
    if (!gitUrlRegex.test(repoUrl)) {
      return res.status(400).json({ error: "Invalid repository URL. Please provide a valid public HTTPS clone URL (e.g., https://github.com/user/repo.git)." });
    }

    // Clean existing sandbox directory completely
    if (fs.existsSync(sandboxPath)) {
      await execAsync("rm -rf * .git", { cwd: sandboxPath }).catch(() => {});
    }
    ensureSandbox();

    // Run git clone command
    const cloneRes = await execAsync(`git clone "${repoUrl}" .`, { cwd: sandboxPath });
    
    // Set mock local users so subsequent commits in browser can still work
    await runGit('git config user.name "Sandbox Coder"');
    await runGit('git config user.email "sandbox@aisbuild.local"');

    res.json({ success: true, message: "Repository successfully loaded into Sandbox!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to clone repository. Make sure the repository is public and existing." });
  }
});

// Stage/Add files
app.post("/api/git/stage", async (req, res) => {
  try {
    const file = req.body.file || "."; // Default to add all
    const safeFile = file === "." ? "." : path.basename(file);
    const result = await runGit(`git add "${safeFile}"`);
    if (result.code !== 0) {
      return res.status(400).json({ error: result.stderr });
    }
    res.json({ success: true, message: `Staged ${file}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Unstage/Reset files
app.post("/api/git/unstage", async (req, res) => {
  try {
    const file = req.body.file || ".";
    let cmd = "git reset HEAD";
    if (file !== ".") {
      cmd = `git reset HEAD "${path.basename(file)}"`;
    }
    const result = await runGit(cmd);
    if (result.code !== 0) {
      return res.status(400).json({ error: result.stderr });
    }
    res.json({ success: true, message: `Unstaged ${file}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Commit changes
app.post("/api/git/commit", async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) {
      return res.status(400).json({ error: "Commit message is required" });
    }
    
    // First, ensure git config is set to avoid environment crash
    await runGit('git config user.name "Sandbox Coder"');
    await runGit('git config user.email "sandbox@aisbuild.local"');

    const result = await runGit(`git commit -m "${message.replace(/"/g, '\\"')}"`);
    if (result.code !== 0) {
      return res.status(400).json({ error: result.stderr || "No changes to commit" });
    }
    res.json({ success: true, message: result.stdout });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Log / Commits history with parents
app.get("/api/git/log", async (req, res) => {
  try {
    ensureSandbox();
    const isGitRepo = fs.existsSync(path.join(sandboxPath, ".git"));
    if (!isGitRepo) {
      return res.json({ commits: [] });
    }

    // Custom format: hash | abbreviated parents | author_name | author_date [YYYY-MM-DD] | commit_subject
    const logRes = await runGit('git log --pretty=format:"%h|%p|%an|%ad|%s" --date=short');
    if (logRes.code !== 0) {
      // Typically happens if there are zero commits yet
      return res.json({ commits: [] });
    }

    const commits = logRes.stdout.split("\n").filter(Boolean).map((line) => {
      const parts = line.split("|");
      const hash = parts[0] ? parts[0].trim() : "";
      const parentsStr = parts[1] ? parts[1].trim() : "";
      const author = parts[2] ? parts[2].trim() : "";
      const date = parts[3] ? parts[3].trim() : "";
      const message = parts[4] ? parts[4].trim() : "";
      
      const parents = parentsStr ? parentsStr.split(" ").filter(Boolean) : [];

      return {
        hash,
        parents,
        author,
        date,
        message,
      };
    });

    res.json({ commits });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Diff of a specific file
app.get("/api/git/diff", async (req, res) => {
  try {
    const { file, staged, commit } = req.query;
    if (!file) {
      return res.status(400).json({ error: "File parameter is required" });
    }

    const safeFile = path.basename(file as string);
    let cmd = `git diff "${safeFile}"`;
    if (staged === "true") {
      cmd = `git diff --cached "${safeFile}"`;
    } else if (commit) {
      // Diff current commit against its parent
      cmd = `git show "${commit}" -- "${safeFile}"`;
    }

    const result = await runGit(cmd);
    res.json({
      diff: result.stdout || result.stderr || "No modifications detected.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Branch list
app.get("/api/git/branches", async (req, res) => {
  try {
    ensureSandbox();
    const isGitRepo = fs.existsSync(path.join(sandboxPath, ".git"));
    if (!isGitRepo) {
      return res.json({ branches: [] });
    }

    const branchesRes = await runGit("git branch");
    if (branchesRes.code !== 0) {
      return res.json({ branches: ["main"] });
    }

    const branches = branchesRes.stdout.split("\n").filter(Boolean).map((line) => {
      const isCurrent = line.startsWith("*");
      const name = line.replace(/^\*\s*/, "").trim();
      return { name, isCurrent };
    });

    res.json({ branches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create Branch
app.post("/api/git/branch/create", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Branch name is required" });
    }
    const result = await runGit(`git branch "${name.replace(/"/g, "")}"`);
    if (result.code !== 0) {
      return res.status(400).json({ error: result.stderr });
    }
    res.json({ success: true, message: `Created branch ${name}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Checkout Branch
app.post("/api/git/branch/checkout", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Branch name is required" });
    }
    const result = await runGit(`git checkout "${name}"`);
    if (result.code !== 0) {
      return res.status(400).json({ error: result.stderr });
    }
    res.json({ success: true, message: result.stdout || `Switched to branch ${name}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Merge Branch
app.post("/api/git/branch/merge", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Branch name is required" });
    }
    const currentBranchRes = await runGit("git branch --show-current");
    const activeBranch = currentBranchRes.stdout.trim() || "current";
    // Force --no-ff (no fast-forward) merge with a default commit message so we ALWAYS create a merge node
    // in the commit history graph. This satisfies user intent of seeing the split/merge curves in the layout.
    const result = await runGit(`git merge --no-ff "${name}" -m "Merge branch '${name}' into ${activeBranch}"`);
    if (result.code !== 0) {
      // Might be conflict
      return res.json({
        success: false,
        conflict: true,
        message: result.stderr || result.stdout,
      });
    }
    res.json({ success: true, conflict: false, message: result.stdout });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Git CLI History & logs of executed commands
app.get("/api/git/history", (req, res) => {
  res.json({ history: gitHistory });
});

// Hard or Soft reset to a specific commit
app.post("/api/git/reset", async (req, res) => {
  try {
    const { commit, mode } = req.body;
    if (!commit) {
      return res.status(400).json({ error: "Commit hash is required" });
    }
    const resetMode = mode === "soft" ? "--soft" : "--hard";
    const result = await runGit(`git reset ${resetMode} "${commit}"`);
    if (result.code !== 0) {
      return res.status(400).json({ error: result.stderr || "Reset command failed" });
    }
    res.json({ success: true, message: `Successfully reset to commit ${commit} with ${resetMode}!` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Revert a specific commit
app.post("/api/git/revert", async (req, res) => {
  try {
    const { commit } = req.body;
    if (!commit) {
      return res.status(400).json({ error: "Commit hash is required" });
    }
    // Set mock local users to prevent commit blocker
    await runGit('git config user.name "Sandbox Coder"');
    await runGit('git config user.email "sandbox@aisbuild.local"');

    const result = await runGit(`git revert "${commit}" --no-edit`);
    if (result.code !== 0) {
      return res.status(400).json({ error: result.stderr || "Revert command failed" });
    }
    res.json({ success: true, message: `Successfully reverted commit ${commit}!` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sandbox File Explorer endpoint - CRUD sandbox files
app.get("/api/sandbox/files", async (req, res) => {
  try {
    ensureSandbox();
    const walk = (dir: string): string[] => {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      list.forEach((file) => {
        // Skip .git directory
        if (file === ".git") return;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(walk(filePath));
        } else {
          // Keep key relative
          results.push(path.relative(sandboxPath, filePath));
        }
      });
      return results;
    };
    const files = walk(sandboxPath);
    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sandbox/files/write", async (req, res) => {
  try {
    const { filePath, content } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: "filePath is required" });
    }
    
    const safePath = path.resolve(sandboxPath, filePath);
    if (!safePath.startsWith(path.resolve(sandboxPath))) {
      return res.status(400).json({ error: "Access outside sandbox forbidden" });
    }

    // Ensure containing directory exists
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(safePath, content || "");
    res.json({ success: true, message: `Successfully wrote file ${filePath}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sandbox/files/read", async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: "filePath is required" });
    }

    const safePath = path.resolve(sandboxPath, filePath as string);
    if (!safePath.startsWith(path.resolve(sandboxPath))) {
      return res.status(400).json({ error: "Access outside sandbox forbidden" });
    }

    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const content = fs.readFileSync(safePath, "utf-8");
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sandbox/files/delete", async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: "filePath is required" });
    }

    const safePath = path.resolve(sandboxPath, filePath);
    if (!safePath.startsWith(path.resolve(sandboxPath))) {
      return res.status(400).json({ error: "Access outside sandbox forbidden" });
    }

    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
      res.json({ success: true, message: `Deleted ${filePath}` });
    } else {
      res.status(404).json({ error: "File not found" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Stash operations
app.get("/api/git/stash", async (req, res) => {
  try {
    ensureSandbox();
    const isGitRepo = fs.existsSync(path.join(sandboxPath, ".git"));
    if (!isGitRepo) {
      return res.json({ stashes: [] });
    }

    const stashRes = await runGit("git stash list");
    if (stashRes.code !== 0) {
      return res.json({ stashes: [] });
    }

    const stashes = stashRes.stdout.split("\n").filter(Boolean).map((line) => {
      // Format is: stash@{0}: WIP on main: <hash> <msg>
      return { line };
    });
    res.json({ stashes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/git/stash/save", async (req, res) => {
  try {
    const { message } = req.body;
    let cmd = "git stash";
    if (message) {
      cmd = `git stash push -m "${message.replace(/"/g, '\\"')}"`;
    }
    const result = await runGit(cmd);
    if (result.code !== 0) {
      return res.status(400).json({ error: result.stderr });
    }
    res.json({ success: true, message: result.stdout });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/git/stash/pop", async (req, res) => {
  try {
    const result = await runGit("git stash pop");
    if (result.code !== 0) {
      return res.status(400).json({ error: result.stderr });
    }
    res.json({ success: true, message: result.stdout });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// AI endpoints using Google `@google/genai`
app.post("/api/git/ai/commit-message", async (req, res) => {
  try {
    ensureSandbox();
    const diffRes = await runGit("git diff --cached");
    const diff = diffRes.stdout;
    if (!diff) {
      return res.json({ message: "", error: "No changes are staged! Stage some modifications first to let Gemini generate a message." });
    }

    const ai = getGeminiClient();
    const prompt = `You are an expert Git GUI assistant. Analyze the following cached/staged git diff and write a beautifully structured Conventional Commit message (e.g., 'feat(auth): add login validation' or 'fix(calculator): resolve division by zero'). 
Verify that the message represents only the actual modifications in the code. Keep it brief (ideally under 72 characters for the header). Include bullet points below if there are multiple substantial changes. 

Do not include markdown code block formatting—just return the plain text commit message.

Staged Diff:
${diff}`;

    const solution = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are a professional commit analyst that writes Conventional Commit messages based on code diffs.",
      },
    });

    res.json({ message: solution.text ? solution.text.trim() : "feat: update files" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/git/ai/explain-diff", async (req, res) => {
  try {
    const { file, staged } = req.body;
    if (!file) {
      return res.status(400).json({ error: "file is required" });
    }
    ensureSandbox();
    const safeFile = path.basename(file);
    let cmd = `git diff "${safeFile}"`;
    if (staged) {
      cmd = `git diff --cached "${safeFile}"`;
    }

    const diffRes = await runGit(cmd);
    const diff = diffRes.stdout;
    if (!diff) {
      return res.json({ explanation: "No dynamic differences detected on this file." });
    }

    const ai = getGeminiClient();
    const prompt = `As a senior software architect, analyze this diff from git on file "${file}" and explain the code changes in incredibly simple, scannable human terms. 
Detail the logical modifications, point out what was added or removed, and explain *why* this change would be made. Feel free to use brief markdown formatting with bolding or bullet points. 
Keep the answer concise and highly readable.

Git Diff:
${diff}`;

    const solution = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    res.json({ explanation: solution.text ? solution.text.trim() : "No explanation could be compiled." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server wrapper
async function startServer() {
  // Vite Middleware for Development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start sandbox server:", err);
});
