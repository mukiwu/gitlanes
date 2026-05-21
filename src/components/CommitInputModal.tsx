import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

export interface InputField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
}

interface CommitInputModalProps {
  open: boolean;
  title: string;
  fields: InputField[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
}

export const CommitInputModal: React.FC<CommitInputModalProps> = ({
  open,
  title,
  fields,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
}) => {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setValues({});
  }, [open, title]);

  if (!open) return null;

  const requiredFilled = fields.every((f) => !f.required || (values[f.key]?.trim() ?? "") !== "");

  const submit = () => {
    if (!requiredFilled) return;
    onConfirm(values);
  };

  return (
    <>
      <div className="fixed inset-0 z-[95] bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[100] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">{title}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-slate-500">{f.label}</label>
              {f.multiline ? (
                <textarea
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  rows={3}
                  className="w-full resize-none rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-[12px] text-slate-200 focus:border-cyan-500 focus:outline-none placeholder-slate-600"
                />
              ) : (
                <input
                  type="text"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  placeholder={f.placeholder}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-[12px] text-slate-200 focus:border-cyan-500 focus:outline-none placeholder-slate-600"
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-[12px] font-mono text-slate-400 hover:text-slate-200 cursor-pointer">
            {cancelLabel}
          </button>
          <button
            onClick={submit}
            disabled={!requiredFilled}
            className="rounded bg-cyan-600 px-4 py-1.5 text-[12px] font-mono font-bold text-slate-50 hover:bg-cyan-500 disabled:opacity-50 cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
};
