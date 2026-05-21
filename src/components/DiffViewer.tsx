import React, { useState, useEffect } from "react";
import { Sparkles, HelpCircle, FileText, Loader2, AlertCircle } from "lucide-react";

interface DiffViewerProps {
  file: string;
  staged: boolean;
  commitHash?: string;
  onClose?: () => void;
  onNeedAiSetup?: () => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  file,
  staged,
  commitHash,
  onClose,
  onNeedAiSetup,
}) => {
  const [diffText, setDiffText] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [explanation, setExplanation] = useState<string>("");
  const [isExplaining, setIsExplaining] = useState<boolean>(false);
  const [errorMess, setErrorMess] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    setIsLoading(true);
    setExplanation("");
    setErrorMess(null);

    let url = `/api/git/diff?file=${encodeURIComponent(file)}&staged=${staged}`;
    if (commitHash) {
      url += `&commit=${commitHash}`;
    }

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Could not fetch file diff");
        return res.json();
      })
      .then((data) => {
        setDiffText(data.diff);
      })
      .catch((err) => {
        setErrorMess("Failed to load git diff details.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [file, staged, commitHash]);

  const handleExplain = async () => {
    try {
      const settingsRes = await fetch("/api/ai/settings");
      if (!settingsRes.ok) throw new Error("settings unavailable");
      const settings = await settingsRes.json();
      if (!settings.hasKey) {
        onNeedAiSetup?.();
        return;
      }
    } catch {
      onNeedAiSetup?.();
      return;
    }

    setIsExplaining(true);
    setErrorMess(null);
    try {
      const res = await fetch("/api/git/ai/explain-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, staged, commit: commitHash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not fetch AI explanation");
      if (data.error) throw new Error(data.error);
      setExplanation(data.explanation);
    } catch (err: any) {
      setErrorMess(err.message || "Failed to contact AI provider.");
    } finally {
      setIsExplaining(false);
    }
  };

  // Parse lines to display highlighted blocks
  const diffLines = diffText.split("\n");

  return (
    <div id="diff-viewer-component" className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden font-sans">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800 shrink-0">
        <div className="flex items-center space-x-2">
          <FileText className="h-4 w-4 text-cyan-400" />
          <h3 className="text-slate-200 font-medium text-xs font-mono">
            Diff Viewer: {file} {staged ? <span className="text-emerald-400 uppercase text-[10px] bg-emerald-950/80 px-1 py-0.5 rounded border border-emerald-900 ml-2">STAGED</span> : <span className="text-amber-400 uppercase text-[10px] bg-amber-950/80 px-1 py-0.5 rounded border border-amber-900 ml-2">UNSTAGED</span>}
          </h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-xs font-mono"
          >
            Close Diffs
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Colorized Diff column */}
        <div className="flex-1 overflow-auto bg-slate-950/80 p-3 font-mono text-[11px] leading-5 select-text border-r border-slate-800">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-500 mb-2" />
              <span>Analyzing git indices...</span>
            </div>
          ) : diffLines.length === 0 || diffLines[0] === "" ? (
            <div className="p-8 text-slate-500 text-center font-sans">
              No staged or unstaged modifications are detected inside this file.
            </div>
          ) : (
            <div className="space-y-[1px]">
              {diffLines.map((line, idx) => {
                let textClass = "text-slate-400";
                let bgClass = "transparent";

                if (line.startsWith("+") && !line.startsWith("+++")) {
                  textClass = "text-emerald-400";
                  bgClass = "bg-emerald-950/30 border-l-2 border-emerald-500 pl-1";
                } else if (line.startsWith("-") && !line.startsWith("---")) {
                  textClass = "text-rose-400";
                  bgClass = "bg-rose-950/30 border-l-2 border-rose-500 pl-1";
                } else if (line.startsWith("@@")) {
                  textClass = "text-cyan-400/95 font-semibold";
                  bgClass = "bg-cyan-950/20";
                } else if (line.startsWith("diff") || line.startsWith("index")) {
                  textClass = "text-slate-500 font-bold";
                }

                return (
                  <pre
                    key={idx}
                    className={`${bgClass} ${textClass} px-2 whitespace-pre-wrap word-break-all`}
                  >
                    {line}
                  </pre>
                );
              })}
            </div>
          )}
        </div>

        {/* AI Explainer column */}
        <div className="w-full md:w-[320px] bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col overflow-y-auto shrink-0">
          <div className="p-4 border-b border-slate-800 bg-slate-950/30 flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <Sparkles className="h-4 w-4 text-amber-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-200">AI Diff Brain</span>
            </div>
            {!explanation && !isExplaining && (
              <button
                onClick={handleExplain}
                className="bg-amber-600 hover:bg-amber-500 text-slate-100 text-[10px] font-semibold px-2 py-1 rounded transition-colors font-mono cursor-pointer"
              >
                Explain Diffs
              </button>
            )}
          </div>

          <div className="p-4 flex-1">
            {errorMess && (
              <div className="p-3 mb-3 shrink-0 rounded bg-rose-950/60 border border-rose-900 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                <span>{errorMess}</span>
              </div>
            )}

            {isExplaining ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-center">
                <Loader2 className="h-7 w-7 animate-spin text-amber-500 mb-3" />
                <p className="text-xs font-medium">AI is analyzing the diffs...</p>
                <p className="text-[10px] text-slate-500 max-w-[200px] mt-1.5">
                  Translating instructions and computing delta patterns.
                </p>
              </div>
            ) : explanation ? (
              <div className="text-xs text-slate-300 leading-relaxed font-sans space-y-3 prose prose-invert select-text">
                <div className="bg-slate-950/40 p-3 border border-slate-800 rounded text-slate-200 font-mono text-[10px] mb-2 flex items-center justify-between">
                  <span>Explanation complete!</span>
                  <button
                    onClick={handleExplain}
                    className="text-amber-500 hover:text-amber-400 text-[9px] underline font-sans"
                  >
                    Recalculate
                  </button>
                </div>
                {explanation.split("\n\n").map((para, i) => (
                  <p key={i}>
                    {para.split("\n").map((line, j) => {
                      if (line.startsWith("-") || line.startsWith("*")) {
                        return (
                          <span key={j} className="block pl-3 border-l-2 border-amber-500/40 my-1">
                            {line.substring(2)}
                          </span>
                        );
                      }
                      return <span key={j} className="block">{line}</span>;
                    })}
                  </p>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
                <HelpCircle className="h-10 w-10 text-slate-700 mb-2" />
                <h5 className="text-slate-400 text-xs font-medium">Ask AI for Advice</h5>
                <p className="text-[10px] text-slate-500 max-w-[200px] mt-1">
                  Click 'Explain Diffs' to activate AI models explaining the changes, and what bugs to watch out for!
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
