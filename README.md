# Git GUI

A Tauri desktop app for working with local Git repositories. The UI is React/Vite, and local Git/file operations run through Rust Tauri commands.

## Prerequisites

- Node.js
- Rust
- Git

## Run

```bash
npm install
npm run dev
```

## Build The macOS App

```bash
npm run build
```

Build output:

- `src-tauri/target/release/bundle/macos/Git GUI.app`
- `src-tauri/target/release/bundle/dmg/Git GUI_0.1.0_aarch64.dmg`

## AI Features

AI commit-message and diff explanation are configured in-app via the gear menu → "AI Settings".
Choose a provider (Gemini / OpenAI / Anthropic / Ollama), pick a model, and paste your API key.
Keys are stored in the OS keychain and never written to disk or logs.

## Legacy Web Server

The original Express server is still available for comparison:

```bash
npm run dev:server
```
