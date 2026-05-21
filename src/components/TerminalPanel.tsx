import React from "react";
import { ChevronUp, ChevronDown, TerminalSquare } from "lucide-react";

export interface TerminalPanelLabels {
  title: string;
  expand: string;
  collapse: string;
}

interface TerminalPanelProps {
  open: boolean;
  height: number;
  onToggle: () => void;
  labels: TerminalPanelLabels;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ open, height, onToggle, labels }) => {
  return (
    <div className="flex flex-col shrink-0 border-t border-slate-800">
      {/* Title bar (always shown, 32px tall) */}
      <button
        onClick={onToggle}
        title={open ? labels.collapse : labels.expand}
        className="h-8 flex items-center justify-between px-3 bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
      >
        <span className="flex items-center gap-1.5 text-[12px] font-mono font-bold uppercase tracking-wider text-slate-400">
          <TerminalSquare className="h-3.5 w-3.5" />
          {labels.title}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronUp className="h-3.5 w-3.5 text-slate-500" />}
      </button>

      {/* Content (only when open) */}
      {open && (
        <div
          style={{ height }}
          className="bg-slate-950 border-t border-slate-800/60 overflow-hidden flex items-center justify-center"
        >
          <span className="text-[12px] font-mono text-slate-600 italic px-4 text-center">
            Terminal will live here (PTY integration in next spec)
          </span>
        </div>
      )}
    </div>
  );
};
