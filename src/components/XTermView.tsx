import React, { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface XTermViewProps {
  cwd: string;
  exitedLabel: string;
}

// Vitesse Dark Soft palette — aligned with the rest of the app.
const THEME = {
  background: "#0f172a",
  foreground: "#cbd5e1",
  cursor: "#22d3ee",
  selectionBackground: "#1e293b",
  black: "#0f172a",
  red: "#cb7676",
  green: "#4d9375",
  yellow: "#dbd7ca",
  blue: "#6394bf",
  magenta: "#d3869b",
  cyan: "#5eaab5",
  white: "#cdd6f4",
  brightBlack: "#475569",
  brightRed: "#e09b9b",
  brightGreen: "#7ab399",
  brightYellow: "#f0e7c7",
  brightBlue: "#8fb6d6",
  brightMagenta: "#e0a4b8",
  brightCyan: "#8cc0c9",
  brightWhite: "#f1f5f9",
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

export const XTermView: React.FC<XTermViewProps> = ({ cwd, exitedLabel }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      theme: THEME,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);

    const encoder = new TextEncoder();

    // stdin → backend
    const onData = term.onData((d) => {
      invoke("terminal_write", { data: bytesToBase64(encoder.encode(d)) }).catch(() => {});
    });

    // stdout / exit ← backend
    const unlistenDataP = listen<string>("terminal:data", (e) => {
      term.write(base64ToBytes(e.payload));
    });
    const unlistenExitP = listen("terminal:exit", () => {
      term.writeln(`\r\n\x1b[2;90m${exitedLabel}\x1b[0m`);
    });

    // Start the shell, then fit to container and report initial size.
    invoke("terminal_start", { cwd })
      .then(() => {
        try {
          fit.fit();
          invoke("terminal_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
        } catch {
          // container hidden / sized 0; will catch up on next ResizeObserver tick.
        }
      })
      .catch((err) => {
        term.writeln(`\x1b[31m[terminal] ${String(err)}\x1b[0m`);
      });

    // Reflow on container resize.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        invoke("terminal_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
      } catch {
        // ignore
      }
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      onData.dispose();
      unlistenDataP.then((u) => u()).catch(() => {});
      unlistenExitP.then((u) => u()).catch(() => {});
      invoke("terminal_kill").catch(() => {});
      term.dispose();
    };
  }, [cwd, exitedLabel]);

  return <div ref={hostRef} className="h-full w-full bg-slate-950" />;
};
