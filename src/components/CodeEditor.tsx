import React, { useState, useEffect } from "react";
import { Folder, File, Plus, Save, Trash2, FileCode, Check, AlertTriangle, ChevronDown } from "lucide-react";
import { GitFile } from "../types";

interface CodeEditorLabels {
  workspace: string;
  emptyFolder: string;
  editorTitle: string;
  editorHint: string;
}

interface CodeEditorProps {
  files: string[];
  activeFile: string | null;
  onSelectFile: (filePath: string | null) => void;
  onFileUpdated: () => void;
  gitFiles?: GitFile[];
  labels: CodeEditorLabels;
  onCollapse?: () => void;
  collapseTitle?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  files,
  activeFile,
  onSelectFile,
  onFileUpdated,
  gitFiles = [],
  labels,
  onCollapse,
  collapseTitle,
}) => {
  const [content, setContent] = useState<string>("");
  const [newFileName, setNewFileName] = useState<string>("");
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [errorMess, setErrorMess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState<boolean>(false);

  // Fetch content whenever active file changes
  useEffect(() => {
    if (activeFile) {
      setErrorMess(null);
      fetch(`/api/sandbox/files/read?filePath=${encodeURIComponent(activeFile)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Could not read file");
          return res.json();
        })
        .then((data) => {
          setContent(data.content);
        })
        .catch((err) => {
          setErrorMess("Error loading file contents. Try reloading.");
        });
    } else {
      setContent("");
    }
  }, [activeFile]);

  const handleSave = async () => {
    if (!activeFile) return;
    setIsSaving(true);
    setErrorMess(null);
    try {
      const res = await fetch("/api/sandbox/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: activeFile, content }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Could not write file");
      }
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
      onFileUpdated();
    } catch (err: any) {
      setErrorMess(err.message || "Failed to save.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    setErrorMess(null);
    try {
      const filePath = newFileName.trim();
      const res = await fetch("/api/sandbox/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, content: `// Code for ${filePath}\n` }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Could not create file");
      }
      setNewFileName("");
      setIsCreating(false);
      onSelectFile(filePath);
      onFileUpdated();
    } catch (err: any) {
      setErrorMess(err.message || "Failed to create file.");
    }
  };

  const handleDeleteFile = async (filePath: string) => {
    if (!window.confirm(`Are you sure you want to delete ${filePath}? This will trigger unstaged deletes in git!`)) return;
    setErrorMess(null);
    try {
      const res = await fetch("/api/sandbox/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Could not delete file");
      }
      if (activeFile === filePath) {
        onSelectFile(null);
      }
      onFileUpdated();
    } catch (err: any) {
      setErrorMess(err.message || "Failed to delete file.");
    }
  };

  // Generate lines for simple code gutter
  const linesCount = content.split("\n").length || 1;
  const lineNumbers = Array.from({ length: linesCount }, (_, i) => i + 1);

  // Quick inserts to modify code and test Git.
  const appendBoilerplate = (type: string) => {
    let snippet = "";
    if (type === "function") {
      snippet = `\n// Git GUI helper function\nfunction queryAPIStatus() {\n  console.log("Querying local repository logs...");\n  return {\n    status: 200,\n    data: "Refreshed live telemetry data"\n  };\n}\n`;
    } else if (type === "bug") {
      snippet = `\n// BUG INTRODUCED! Division by zero danger zone\nfunction computeDivision(a, b) {\n  if (b === 0) {\n    console.warn("WARNING: Division by zero, check merge conflicts");\n  }\n  return a / b;\n}\n`;
    } else if (type === "comment") {
      snippet = `\n# TODO: This comment was generated in the current branch\n# Add user validation checks here before staging files.\n`;
    }
    setContent((prev) => prev + snippet);
  };

  return (
    <div id="code-editor-component" className="flex h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden font-sans">
      {/* File Tree Explorer (VS Code Style left tab) */}
      <div className="w-[180px] bg-slate-950 border-r border-slate-800 flex flex-col shrink-0 select-none">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80">
          <span className="text-[12px] uppercase tracking-wider font-bold text-slate-500 font-mono">{labels.workspace}</span>
          <div className="flex items-center space-x-0.5">
            <button
              onClick={() => setIsCreating(!isCreating)}
              title="Create New File"
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {onCollapse && (
              <button
                onClick={onCollapse}
                title={collapseTitle}
                className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors cursor-pointer"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {isCreating && (
          <form onSubmit={handleCreateFile} className="p-2 border-b border-slate-800/50 bg-slate-900/60">
            <input
              type="text"
              placeholder="filename.js..."
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="w-full bg-slate-950 text-slate-200 border border-slate-700 rounded text-xs px-2 py-1 focus:outline-none focus:border-cyan-500 font-mono"
              autoFocus
            />
            <div className="flex items-center justify-end space-x-1.5 mt-1.5">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="text-[12px] text-slate-500 hover:text-slate-300 font-mono"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-cyan-600 hover:bg-cyan-500 text-slate-100 text-[12px] px-1.5 py-0.5 rounded font-mono font-medium"
              >
                Create
              </button>
            </div>
          </form>
        )}

        <div className="flex-1 overflow-y-auto py-2">
          {files.length === 0 ? (
            <div className="p-3 text-center text-slate-600 text-xs font-mono">
              {labels.emptyFolder}
            </div>
          ) : (
            <div className="space-y-0.5 px-1.5">
              {files.map((file) => {
                const isActive = activeFile === file;
                const gitFile = gitFiles.find((f) => f.path === file);
                
                let badgeStyle = "text-slate-500 bg-slate-900 border-slate-800";
                let badgeLabel = "";
                if (gitFile) {
                  if (gitFile.displayStatus === "Untracked") {
                    badgeStyle = "text-amber-400 bg-amber-950/20 border-amber-900/30";
                    badgeLabel = "U";
                  } else if (gitFile.displayStatus === "Modified" || gitFile.displayStatus === "Partially Staged") {
                    badgeStyle = "text-yellow-400 bg-yellow-950/20 border-yellow-900/30";
                    badgeLabel = "M";
                  } else if (gitFile.displayStatus === "Staged" || gitFile.displayStatus === "Added") {
                    badgeStyle = "text-emerald-400 bg-emerald-950/20 border-emerald-905/30";
                    badgeLabel = "A";
                  } else if (gitFile.displayStatus === "Conflict") {
                    badgeStyle = "text-rose-500 bg-rose-950/20 border-rose-909/30";
                    badgeLabel = "C";
                  }
                }

                return (
                  <div
                    key={file}
                    className={`group flex items-center justify-between px-2 py-1 rounded text-xs cursor-pointer transition-colors
                      ${isActive 
                        ? "bg-slate-800/80 text-slate-100 font-medium" 
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
                      }`}
                  >
                    <div
                      onClick={() => onSelectFile(file)}
                      className="flex items-center space-x-2 truncate flex-1 pr-1"
                    >
                      <File className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-cyan-400" : "text-slate-500"}`} />
                      <span className="truncate font-mono text-[12px]">{file}</span>
                      {badgeLabel && (
                        <span className={`text-[12px] px-1 font-bold font-mono rounded border uppercase select-none shrink-0 ${badgeStyle}`} title={gitFile?.displayStatus}>
                          {badgeLabel}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file);
                      }}
                      title="Delete File"
                      className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Code Text editor space */}
      <div className="flex-1 flex flex-col bg-slate-900 relative">
        {activeFile ? (
          <>
            {/* Title tabs */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <FileCode className="h-4 w-4 text-cyan-500" />
                <span className="text-slate-200 text-xs font-mono font-semibold">{activeFile}</span>
                <span className="text-[12px] text-slate-500 font-mono">(Local repository file)</span>
              </div>

              {/* Action utilities */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer
                    ${showSaveSuccess 
                      ? "bg-emerald-950 border border-emerald-800 text-emerald-400" 
                      : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                    }`}
                >
                  {showSaveSuccess ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Saved!</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      <span>{isSaving ? "Saving..." : "Save Code"}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Error notifications */}
            {errorMess && (
              <div className="bg-rose-950 border-b border-rose-900 text-rose-300 text-xs px-3 py-1.5 flex items-center space-x-2">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                <span>{errorMess}</span>
              </div>
            )}

            {/* Editor panel with vertical line counters */}
            <div className="flex-1 flex overflow-hidden font-mono text-xs select-text">
              {/* Line Numbers banner */}
              <div className="w-[36px] bg-slate-950/40 text-slate-600 text-right pr-2 py-3 border-r border-slate-800 select-none">
                {lineNumbers.map((num) => (
                  <div key={num} className="leading-5 h-5">
                    {num}
                  </div>
                ))}
              </div>

              {/* Text editor area */}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                placeholder="Write code or content here..."
                className="flex-1 p-3 bg-transparent text-slate-200 resize-none font-mono text-xs focus:outline-none leading-5 h-full overflow-y-auto border-none shadow-none focus:ring-0"
              />
            </div>

            {/* Educational boilerplate appenders footer */}
            <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[12px] text-slate-500 font-bold tracking-wider font-mono uppercase">Interactive Playground Injectors:</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => appendBoilerplate("function")}
                  className="bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded font-mono text-[12px] px-2 py-1 text-cyan-400 transition-colors"
                >
                  + Add Helper Function
                </button>
                <button
                  onClick={() => appendBoilerplate("bug")}
                  className="bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded font-mono text-[12px] px-2 py-1 text-amber-500 transition-colors"
                >
                  + Inject Risk Bug
                </button>
                <button
                  onClick={() => appendBoilerplate("comment")}
                  className="bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded font-mono text-[12px] px-2 py-1 text-slate-400 transition-colors"
                >
                  + Append TODO Comment
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <FileCode className="h-10 w-10 text-slate-700 mb-3" />
            <h4 className="text-slate-300 font-medium">{labels.editorTitle}</h4>
            <p className="text-slate-500 text-xs max-w-xs mt-1">
              {labels.editorHint}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
