import React, { useEffect, useRef, useState } from "react";

export interface CommitContextMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  dividerBefore?: boolean;
}

interface CommitContextMenuProps {
  x: number;
  y: number;
  items: CommitContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 220;

export const CommitContextMenu: React.FC<CommitContextMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Clamp into viewport once mounted (measure real height).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[80]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
        className="fixed z-[90] bg-slate-900 border border-slate-800 rounded-lg shadow-xl p-1.5"
      >
        {items.map((item) => (
          <React.Fragment key={item.key}>
            {item.dividerBefore && <div className="my-1 border-t border-slate-800" />}
            <button
              onClick={() => { item.onSelect(); onClose(); }}
              className={`w-full text-left px-2 py-1.5 rounded text-[12px] font-mono cursor-pointer transition-colors ${
                item.danger ? "text-rose-400 hover:bg-rose-950/40 hover:text-rose-300" : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
              }`}
            >
              {item.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </>
  );
};
