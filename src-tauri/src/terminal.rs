use std::io::Write;
use std::sync::Mutex;

use portable_pty::{Child, MasterPty};

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

    pub fn kill(&self) {
        let mut guard = self.inner.lock().expect("session mutex poisoned");
        if let Some(mut sess) = guard.take() {
            let _ = sess.child.kill();
            let _ = sess.child.wait();
        }
    }
}
