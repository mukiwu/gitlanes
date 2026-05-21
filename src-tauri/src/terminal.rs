use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

pub struct Session {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

pub struct SessionManager {
    pub inner: Mutex<Option<Session>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }

    pub fn start(&self, app: AppHandle, cwd: &str) -> Result<(), String> {
        // Kill any previous session first.
        self.kill();

        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");
        // Login shell so the user's normal env (rc files) is loaded.
        cmd.arg("-l");
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        // Slave handle no longer needed after spawn.
        drop(pair.slave);

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        // Reader thread: forward bytes to frontend as base64.
        let app_handle = app.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let encoded = B64.encode(&buf[..n]);
                        let _ = app_handle.emit("terminal:data", encoded);
                    }
                    Err(_) => break,
                }
            }
            let _ = app_handle.emit("terminal:exit", ());
        });

        let mut guard = self.inner.lock().expect("session mutex poisoned");
        *guard = Some(Session { master: pair.master, writer, child });
        Ok(())
    }

    pub fn write(&self, data: &str) -> Result<(), String> {
        let bytes = B64.decode(data).map_err(|e| e.to_string())?;
        let mut guard = self.inner.lock().expect("session mutex poisoned");
        if let Some(sess) = guard.as_mut() {
            sess.writer.write_all(&bytes).map_err(|e| e.to_string())?;
            sess.writer.flush().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let guard = self.inner.lock().expect("session mutex poisoned");
        if let Some(sess) = guard.as_ref() {
            sess.master
                .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn kill(&self) {
        // Release the mutex before the blocking `wait()` so concurrent commands
        // (write/resize on the Tokio runtime) don't stall behind a slow-dying child.
        let sess = {
            let mut guard = self.inner.lock().expect("session mutex poisoned");
            guard.take()
        };
        if let Some(mut sess) = sess {
            let _ = sess.child.kill();
            let _ = sess.child.wait();
        }
    }
}
