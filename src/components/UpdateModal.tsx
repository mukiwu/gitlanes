import React from "react";
import { X, Sparkles, Loader2, ExternalLink } from "lucide-react";

export interface UpdateModalLabels {
  available: (version: string) => string;
  current: (version: string) => string;
  notes: string;
  viewFullNotes: string;
  install: string;
  later: string;
  installing: string;
}

interface UpdateModalProps {
  open: boolean;
  version: string;
  currentVersion: string;
  notes: string;
  releaseUrl: string;
  onInstall: () => void;
  onLater: () => void;
  isInstalling: boolean;
  labels: UpdateModalLabels;
}

const NOTES_PREVIEW_CHARS = 600;

export const UpdateModal: React.FC<UpdateModalProps> = ({
  open,
  version,
  currentVersion,
  notes,
  releaseUrl,
  onInstall,
  onLater,
  isInstalling,
  labels,
}) => {
  if (!open) return null;

  const truncated = notes.length > NOTES_PREVIEW_CHARS;
  const preview = truncated ? notes.slice(0, NOTES_PREVIEW_CHARS).trimEnd() + "…" : notes;

  return (
    <>
      <div className="fixed inset-0 z-[95] bg-black/60" onClick={isInstalling ? undefined : onLater} />
      <div className="fixed left-1/2 top-1/2 z-[100] w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            {labels.available(version)}
          </span>
          {!isInstalling && (
            <button onClick={onLater} className="text-slate-400 hover:text-slate-200 cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="text-[12px] font-mono text-slate-500">{labels.current(currentVersion)}</div>

          <div>
            <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-slate-500">{labels.notes}</div>
            <pre className="bg-slate-950 border border-slate-800 rounded p-3 text-[12px] text-slate-300 whitespace-pre-wrap max-h-[260px] overflow-auto font-sans leading-relaxed">{preview}</pre>
            {(truncated || releaseUrl) && (
              <a
                href={releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-cyan-400 hover:text-cyan-300"
              >
                <ExternalLink className="h-3 w-3" />
                {labels.viewFullNotes}
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button
            onClick={onLater}
            disabled={isInstalling}
            className="rounded px-3 py-1.5 text-[12px] font-mono text-slate-400 hover:text-slate-200 cursor-pointer disabled:opacity-50"
          >
            {labels.later}
          </button>
          <button
            onClick={onInstall}
            disabled={isInstalling}
            className="flex items-center gap-1.5 rounded bg-cyan-600 px-4 py-1.5 text-[12px] font-mono font-bold text-slate-50 hover:bg-cyan-500 disabled:opacity-50 cursor-pointer"
          >
            {isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isInstalling ? labels.installing : labels.install}
          </button>
        </div>
      </div>
    </>
  );
};
