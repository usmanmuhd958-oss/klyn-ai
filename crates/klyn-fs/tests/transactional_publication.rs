//! Public-API integration test for the CAS-before-journal crash window.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use klyn_fs::{FsEngine, DEFAULT_PUBLICATION_REF};

struct Fixture {
    parent: PathBuf,
    repository: PathBuf,
    state: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after the Unix epoch")
            .as_nanos();
        let parent = std::env::temp_dir().join(format!(
            "klyn-fs-integration-{}-{nonce:x}",
            std::process::id()
        ));
        let repository = parent.join("repo");
        let state = parent.join("state");

        fs::create_dir_all(&repository).unwrap();
        git(&repository, &["init", "-b", "main"]);
        git(&repository, &["config", "user.name", "KLYN Integration Test"]);
        git(
            &repository,
            &["config", "user.email", "klyn-integration@invalid"],
        );
        fs::write(repository.join("README.md"), "base\n").unwrap();
        git(&repository, &["add", "README.md"]);
        git(&repository, &["commit", "-m", "base revision"]);

        Self {
            parent,
            repository,
            state,
        }
    }

    fn engine(&self) -> FsEngine {
        FsEngine::open(&self.repository, &self.state, DEFAULT_PUBLICATION_REF).unwrap()
    }

    fn git_stdout(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(&self.repository)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.parent);
    }
}

fn git(repository: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Git command {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn restart_reconciles_successful_cas_without_touching_canonical_checkout() {
    let fixture = Fixture::new();
    let engine = fixture.engine();
    let canonical_head = fixture.git_stdout(&["rev-parse", "HEAD"]);
    let mut tx = engine.begin_transaction().unwrap();
    let base = tx.base_revision().to_owned();

    tx.write_file("candidate.txt", None, "candidate result\n")
        .unwrap();
    tx.stage().unwrap();
    let revision = tx.validate().unwrap().to_owned();
    let candidate_path = tx.candidate_path().to_owned();

    // Model the durable ref update succeeding before the daemon can append
    // Committed. The transaction journal still ends at Validated.
    git(
        &fixture.repository,
        &[
            "update-ref",
            DEFAULT_PUBLICATION_REF,
            revision.as_str(),
            base.as_str(),
        ],
    );

    drop(tx);
    drop(engine);

    let reopened = fixture.engine();
    assert_eq!(
        fixture.git_stdout(&["rev-parse", DEFAULT_PUBLICATION_REF]),
        revision
    );
    assert_eq!(fixture.git_stdout(&["rev-parse", "HEAD"]), canonical_head);
    assert!(!fixture.repository.join("candidate.txt").exists());
    assert!(!candidate_path.exists());
    assert_eq!(reopened.target_ref(), DEFAULT_PUBLICATION_REF);
}
