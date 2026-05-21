import React, { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, X, CheckCircle2, XCircle } from "lucide-react";

type Provider = "gemini" | "openai" | "anthropic" | "ollama";

interface AiSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  labels: AiSettingsLabels;
}

export interface AiSettingsLabels {
  title: string;
  provider: string;
  model: string;
  custom: string;
  apiKey: string;
  endpoint: string;
  clear: string;
  test: string;
  testing: string;
  testOk: string;
  cancel: string;
  save: string;
  keyStoredHint: string;
}

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "gemini", label: "Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "ollama", label: "Ollama" },
];

const MODEL_OPTIONS: Record<Provider, string[]> = {
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  openai: ["gpt-4o-mini", "gpt-4o"],
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-7"],
  ollama: [],
};

const CUSTOM_VALUE = "__custom__";
const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({ open, onClose, onSaved, labels }) => {
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState<string>("gemini-2.5-flash");
  const [isCustomModel, setIsCustomModel] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>("");
  const [endpoint, setEndpoint] = useState<string>(DEFAULT_OLLAMA_ENDPOINT);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [showKey, setShowKey] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMessage, setTestMessage] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setShowKey(false);
    setApiKey("");
    setTestState("idle");
    setTestMessage("");
    fetch("/api/ai/settings")
      .then((res) => res.json())
      .then((data: { provider: Provider; model: string; hasKey: boolean; endpoint: string | null }) => {
        applyProviderState(data.provider, data.model, data.hasKey, data.endpoint);
      })
      .catch(() => {
        applyProviderState("gemini", "gemini-2.5-flash", false, null);
      });
  }, [open]);

  const applyProviderState = (p: Provider, m: string, keyExists: boolean, ep: string | null) => {
    setProvider(p);
    setHasKey(keyExists);
    setEndpoint(ep || DEFAULT_OLLAMA_ENDPOINT);
    if (p === "ollama") {
      setModel(m);
      setIsCustomModel(false);
    } else if (MODEL_OPTIONS[p].includes(m)) {
      setModel(m);
      setIsCustomModel(false);
    } else {
      setModel(m);
      setIsCustomModel(true);
    }
  };

  const handleSwitchProvider = (p: Provider) => {
    setApiKey("");
    setShowKey(false);
    setTestState("idle");
    setTestMessage("");
    const fallback = p === "ollama" ? "" : MODEL_OPTIONS[p][0];
    applyProviderState(p, fallback, false, null);
  };

  const persist = async () => {
    const payload: Record<string, unknown> = { provider, model };
    if (provider === "ollama") {
      payload.endpoint = endpoint;
    } else if (apiKey.trim()) {
      payload.apiKey = apiKey.trim();
    }
    const res = await fetch("/api/ai/settings/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Save failed");
  };

  const handleTest = async () => {
    setTestState("testing");
    setTestMessage("");
    try {
      await persist();
      const res = await fetch("/api/ai/test", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setTestState("ok");
      } else {
        setTestState("fail");
        setTestMessage(data.message || "");
      }
    } catch (err) {
      setTestState("fail");
      setTestMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await persist();
      onSaved?.();
      onClose();
    } catch {
      setTestState("fail");
      setTestMessage("Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearKey = async () => {
    await fetch("/api/ai/settings/clear-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    setHasKey(false);
    setApiKey("");
  };

  const handleModelDropdown = (value: string) => {
    if (value === CUSTOM_VALUE) {
      setIsCustomModel(true);
      setModel("");
    } else {
      setIsCustomModel(false);
      setModel(value);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[70] w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">{labels.title}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{labels.provider}</label>
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-950 p-1">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSwitchProvider(p.id)}
                  className={`rounded px-2 py-1.5 text-xs font-mono transition-colors ${
                    provider === p.id ? "bg-cyan-600 text-slate-50" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{labels.model}</label>
            {provider === "ollama" ? (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="llama3"
                className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            ) : (
              <>
                <select
                  value={isCustomModel ? CUSTOM_VALUE : model}
                  onChange={(e) => handleModelDropdown(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  {MODEL_OPTIONS[provider].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value={CUSTOM_VALUE}>{labels.custom}</option>
                </select>
                {isCustomModel && (
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="model-id"
                    className="mt-2 w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                )}
              </>
            )}
          </div>

          {provider === "ollama" ? (
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{labels.endpoint}</label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={DEFAULT_OLLAMA_ENDPOINT}
                className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{labels.apiKey}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasKey ? "••••••••••••" : ""}
                  className="flex-1 rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                />
                <button onClick={() => setShowKey((v) => !v)} className="rounded border border-slate-800 p-1.5 text-slate-400 hover:text-slate-200">
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button onClick={handleClearKey} className="rounded border border-slate-800 px-2 py-1.5 text-[10px] font-mono text-rose-400 hover:text-rose-300">
                  {labels.clear}
                </button>
              </div>
              {hasKey && <p className="mt-1 text-[10px] text-slate-500">{labels.keyStoredHint}</p>}
            </div>
          )}

          {testState === "ok" && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> {labels.testOk}
            </div>
          )}
          {testState === "fail" && (
            <div className="flex items-start gap-1.5 text-xs text-rose-400">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-all">{testMessage}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
          <button
            onClick={handleTest}
            disabled={testState === "testing"}
            className="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs font-mono text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {testState === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {testState === "testing" ? labels.testing : labels.test}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded px-3 py-1.5 text-xs font-mono text-slate-400 hover:text-slate-200">
              {labels.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 rounded bg-cyan-600 px-4 py-1.5 text-xs font-mono font-bold text-slate-50 hover:bg-cyan-500 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {labels.save}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
