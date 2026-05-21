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

// Vitesse Dark Soft palette — values pulled from src/index.css @theme block.
// background MUST match the surrounding container <div> so the panel padding
// blends seamlessly with the cell area.
const TERM_BG = "#1b1b1b"; // --color-slate-950
const THEME = {
  background: TERM_BG,
  foreground: "#c9c5b8",          // slate-200
  cursor: "#5eaab5",               // cyan-500
  cursorAccent: TERM_BG,
  selectionBackground: "#363636",  // slate-700
  selectionForeground: "#dbd7ca",  // slate-100
  // Vitesse Dark Soft ANSI palette (matches the app accents)
  black: "#1b1b1b",
  red: "#cb7676",                  // rose-500
  green: "#4d9375",                // emerald-500
  yellow: "#dbbd63",               // amber-500
  blue: "#5eaab5",                 // cyan-500 (vitesse uses teal for blue)
  magenta: "#d9739f",              // purple-500
  cyan: "#6fb8c2",                 // cyan-400
  white: "#c9c5b8",                // slate-200
  brightBlack: "#85827b",          // slate-400
  brightRed: "#e09b9b",
  brightGreen: "#7ab399",
  brightYellow: "#e6cc77",         // amber-400
  brightBlue: "#8fc6cf",
  brightMagenta: "#e69bb8",
  brightCyan: "#8cc7d0",
  brightWhite: "#dbd7ca",          // slate-100
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
  // Keep the latest label in a ref so changing it (e.g. language toggle)
  // doesn't re-run the effect and tear down the live shell.
  const exitedLabelRef = useRef(exitedLabel);
  useEffect(() => {
    exitedLabelRef.current = exitedLabel;
  }, [exitedLabel]);

  useEffect(() => {
    if (!hostRef.current) return;
    // Guard against ghost `terminal:exit` events from the previous session.
    // When key={workspacePath} changes, the new effect's listener is registered
    // BEFORE the old session's reader thread has emitted its final exit event,
    // so without this flag we'd show "(process exited)" on a freshly-started shell.
    let sessionStarted = false;

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
      if (!sessionStarted) return;
      term.writeln(`\r\n\x1b[2;90m${exitedLabelRef.current}\x1b[0m`);
    });

    // Start the shell, then fit to container and report initial size.
    invoke("terminal_start", { cwd })
      .then(() => {
        sessionStarted = true;
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
  }, [cwd]);

  return (
    <div
      ref={hostRef}
      style={{ backgroundColor: TERM_BG }}
      className="h-full w-full px-3 py-2"
    />
  );
};
