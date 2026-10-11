//! Revision-bound candidate workspaces and atomic Git-ref publication.
//!
//! The canonical checkout is never edited or reset by this engine. Mutations
//! occur in detached worktrees; publication moves a dedicated, non-checked-out
//! ref using Git's atomic compare-and-swap update-ref operation.
//!
//! Journal records become authoritative only after their temporary file is
//! fsynced, renamed, and the directory synced. Recovery recognizes a validated
//! candidate already published by ref as committed; otherwise it aborts it.
//!
//! Path checks defend against traversal and symlink mistakes, but do not replace
//! OS isolation. Untrusted workers must not be allowed to change candidate Git
//! metadata or race these path checks before Step 3 is integrated.

#![forbid(unsafe_code)]

use std::{
    collections::BTreeMap,
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::{self, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use nix::fcntl::{Flock, FlockArg};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const DEFAULT_PUBLICATION_REF: &str = "refs/heads/klyn-published";
pub const MAX_MUTATION_BYTES: usize = 48 * 1024;
const RECORDS_RELATIVE: &str = "journal/records";
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransactionState {
    Init,
    Staged,
    Validated,
    Committed,
    Aborted,
}

impl TransactionState {
    fn terminal(self) -> bool {
        matches!(self, Self::Committed | Self::Aborted)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct JournalRecord {
    sequence: u64,
    transaction_id: String,
    state: TransactionState,
    base_revision: String,
    target_ref: String,
    candidate_revision: Option<String>,
    detail: Option<String>,
}

#[derive(Debug)]
struct Journal {
    records_dir: PathBuf,
    next_sequence: u64,
    latest: BTreeMap<String, JournalRecord>,
}

impl Journal {
    fn open(records_dir: PathBuf) -> Result<Self, FsError> {
        fs::create_dir_all(&records_dir)?;
        set_private_dir(&records_dir)?;
        let mut records = Vec::<JournalRecord>::new();

        for entry in fs::read_dir(&records_dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();

            if name.starts_with(".tmp-") {
                let metadata = fs::symlink_metadata(&path)?;
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(FsError::JournalCorrupt(
                        "unsafe temporary journal entry".into(),
                    ));
                }
                fs::remove_file(path)?;
                continue;
            }
            if !name.ends_with(".json") {
                continue;
            }
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(FsError::JournalCorrupt(
                    "journal entry is not a regular file".into(),
                ));
            }
            let record: JournalRecord = serde_json::from_slice(&fs::read(path)?)
                .map_err(|_| FsError::JournalCorrupt("invalid journal record JSON".into()))?;
            if name != format!("{:020}.json", record.sequence) {
                return Err(FsError::JournalCorrupt(
                    "record sequence/name mismatch".into(),
                ));
            }
            records.push(record);
        }

        records.sort_by_key(|record| record.sequence);
        let mut latest = BTreeMap::<String, JournalRecord>::new();
        for (index, record) in records.iter().enumerate() {
            let expected = u64::try_from(index + 1)
                .map_err(|_| FsError::JournalCorrupt("journal sequence overflow".into()))?;
            if record.sequence != expected {
                return Err(FsError::JournalCorrupt(
                    "journal sequence gap or duplicate".into(),
                ));
            }
            if let Some(previous) = latest.get(&record.transaction_id) {
                if previous.base_revision != record.base_revision
                    || previous.target_ref != record.target_ref
                    || previous.state.terminal()
                    || !valid_transition(previous.state, record.state)
                    || (previous.candidate_revision.is_some()
                        && previous.candidate_revision != record.candidate_revision)
                {
                    return Err(FsError::JournalCorrupt(
                        "invalid transaction journal transition".into(),
                    ));
                }
            } else if record.state != TransactionState::Init {
                return Err(FsError::JournalCorrupt(
                    "first transaction record is not init".into(),
                ));
            }
            latest.insert(record.transaction_id.clone(), record.clone());
        }

        let next_sequence = u64::try_from(records.len())
            .map_err(|_| FsError::JournalCorrupt("journal sequence overflow".into()))?
            .checked_add(1)
            .ok_or_else(|| FsError::JournalCorrupt("journal sequence overflow".into()))?;

        Ok(Self {
            records_dir,
            next_sequence,
            latest,
        })
    }

    fn append(
        &mut self,
        id: &str,
        state: TransactionState,
        base: &str,
        target_ref: &str,
        candidate: Option<&str>,
        detail: Option<&str>,
    ) -> Result<(), FsError> {
        if let Some(previous) = self.latest.get(id) {
            if previous.state.terminal() || !valid_transition(previous.state, state) {
                return Err(FsError::InvalidTransition {
                    from: previous.state,
                    to: state,
                });
            }
            if previous.base_revision != base || previous.target_ref != target_ref {
                return Err(FsError::JournalCorrupt(
                    "transaction base/ref binding changed".into(),
                ));
            }
            if previous.candidate_revision.is_some()
                && previous.candidate_revision.as_deref() != candidate
            {
                return Err(FsError::JournalCorrupt(
                    "candidate revision binding changed".into(),
                ));
            }
        } else if state != TransactionState::Init {
            return Err(FsError::JournalCorrupt("first record must be init".into()));
        }

        let record = JournalRecord {
            sequence: self.next_sequence,
            transaction_id: id.to_owned(),
            state,
            base_revision: base.to_owned(),
            target_ref: target_ref.to_owned(),
            candidate_revision: candidate.map(str::to_owned),
            detail: detail.map(str::to_owned),
        };
        let encoded = serde_json::to_vec(&record)?;
        let final_path = self
            .records_dir
            .join(format!("{:020}.json", record.sequence));
        let temporary =
            self.records_dir
                .join(format!(".tmp-{}-{}", std::process::id(), record.sequence));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;

        let write_result = (|| -> Result<(), FsError> {
            file.write_all(&encoded)?;
            file.sync_all()?;
            fs::rename(&temporary, &final_path)?;
            sync_directory(&self.records_dir)?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
            return write_result;
        }

        self.next_sequence = self
            .next_sequence
            .checked_add(1)
            .ok_or_else(|| FsError::JournalCorrupt("journal sequence overflow".into()))?;
        self.latest.insert(id.to_owned(), record);
        Ok(())
    }

    fn latest_records(&self) -> Vec<JournalRecord> {
        let mut records: Vec<_> = self.latest.values().cloned().collect();
        records.sort_by_key(|record| record.sequence);
        records
    }

    fn latest_for(&self, id: &str) -> Option<&JournalRecord> {
        self.latest.get(id)
    }
}

fn valid_transition(from: TransactionState, to: TransactionState) -> bool {
    matches!(
        (from, to),
        (TransactionState::Init, TransactionState::Staged)
            | (TransactionState::Init, TransactionState::Aborted)
            | (TransactionState::Staged, TransactionState::Validated)
            | (TransactionState::Staged, TransactionState::Aborted)
            | (TransactionState::Validated, TransactionState::Committed)
            | (TransactionState::Validated, TransactionState::Aborted)
    )
}

#[derive(Debug, Error)]
pub enum FsError {
    #[error("filesystem I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("journal serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Git operation failed ({operation}, exit {code:?}): {stderr}")]
    GitCommand {
        operation: String,
        code: Option<i32>,
        stderr: String,
    },
    #[error("Git repository root could not be verified")]
    InvalidRepository,
    #[error("publication ref must be a local, un-checked-out branch under refs/heads")]
    InvalidPublicationRef,
    #[error("publication ref is checked out by a worktree")]
    RefCheckedOut,
    #[error("state directory overlaps the Git repository")]
    StateDirectoryOverlap,
    #[error("transaction engine is already open in another process")]
    EngineLocked,
    #[error("symbolic links are not permitted at this boundary")]
    SymlinkRejected,
    #[error("path is absolute, traverses a parent, or targets Git metadata")]
    PathEscape,
    #[error("path component is not a directory or target is not a regular file")]
    InvalidPathType,
    #[error("file exceeds the configured mutation size limit")]
    MutationTooLarge,
    #[error("file precondition failed; refusing to overwrite stale content")]
    WriteConflict,
    #[error("operation requires {expected:?}, transaction is {actual:?}")]
    WrongState {
        expected: TransactionState,
        actual: TransactionState,
    },
    #[error("invalid transaction transition {from:?} -> {to:?}")]
    InvalidTransition {
        from: TransactionState,
        to: TransactionState,
    },
    #[error("transaction has no staged changes")]
    EmptyTransaction,
    #[error("staged patch adds or changes a symlink or submodule")]
    LinkOrSubmoduleChange,
    #[error("publication CAS conflict: expected {expected}, actual {actual}")]
    Conflict { expected: String, actual: String },
    #[error("transaction journal corruption: {0}")]
    JournalCorrupt(String),
    #[error("journal or engine synchronization is unavailable")]
    SynchronizationUnavailable,
    #[error("publication at {revision} succeeded but final journal append failed")]
    PublishedButJournalIncomplete { revision: String },
    #[error("publication at {revision} succeeded but cleanup is pending: {reason}")]
    PublishedCleanupPending { revision: String, reason: String },
}

#[derive(Clone, Debug)]
pub struct PublishReceipt {
    pub transaction_id: String,
    pub target_ref: String,
    pub base_revision: String,
    pub published_revision: String,
}

struct EngineInner {
    repo_root: PathBuf,
    state_root: PathBuf,
    candidates_root: PathBuf,
    target_ref: String,
    journal: Mutex<Journal>,
    _lock_file: Flock<File>,
}

#[derive(Clone)]
pub struct FsEngine {
    inner: Arc<EngineInner>,
}

pub struct KlynTransaction {
    engine: FsEngine,
    transaction_id: String,
    base_revision: String,
    candidate_path: PathBuf,
    state: TransactionState,
    candidate_revision: Option<String>,
}

impl FsEngine {
    pub fn open(
        repository: impl AsRef<Path>,
        state_directory: impl AsRef<Path>,
        target_ref: &str,
    ) -> Result<Self, FsError> {
        let input = fs::canonicalize(repository)?;
        let top = git_text(&input, vec![arg("rev-parse"), arg("--show-toplevel")])?;
        let repo_root = fs::canonicalize(top)?;
        if !repo_root.is_dir() {
            return Err(FsError::InvalidRepository);
        }

        let state_input = state_directory.as_ref();
        prepare_private_directory(state_input)?;
        let state_root = fs::canonicalize(state_input)?;
        if repo_root.starts_with(&state_root) || state_root.starts_with(&repo_root) {
            return Err(FsError::StateDirectoryOverlap);
        }
        if !target_ref.starts_with("refs/heads/")
            || target_ref.len() > 240
            || target_ref.contains('\n')
            || target_ref.contains('\0')
        {
            return Err(FsError::InvalidPublicationRef);
        }
        git(&repo_root, vec![arg("check-ref-format"), arg(target_ref)])?;

        let candidates_root = state_root.join("candidates");
        fs::create_dir_all(&candidates_root)?;
        set_private_dir(&candidates_root)?;
        let records_dir = state_root.join(RECORDS_RELATIVE);
        fs::create_dir_all(&records_dir)?;
        set_private_dir(
            records_dir
                .parent()
                .ok_or(FsError::SynchronizationUnavailable)?,
        )?;

        let lock_path = state_root.join("engine.lock");
        if let Ok(meta) = fs::symlink_metadata(&lock_path) {
            if meta.file_type().is_symlink() || !meta.is_file() {
                return Err(FsError::SymlinkRejected);
            }
        }
        let lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(&lock_path)?;
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o600))?;
        let lock_file = match Flock::lock(lock_file, FlockArg::LockExclusiveNonblock) {
            Ok(locked) => locked,
            Err((_file, error))
                if error == nix::errno::Errno::EWOULDBLOCK
                    || error == nix::errno::Errno::EAGAIN =>
            {
                return Err(FsError::EngineLocked)
            }
            Err((_file, _error)) => return Err(FsError::SynchronizationUnavailable),
        };

        let worktrees = git_text(
            &repo_root,
            vec![arg("worktree"), arg("list"), arg("--porcelain")],
        )?;
        if worktree_checks_out_ref(&worktrees, target_ref) {
            return Err(FsError::RefCheckedOut);
        }

        let journal = Journal::open(records_dir)?;
        let has_history = !journal.latest_records().is_empty();
        ensure_publication_ref(&repo_root, target_ref, has_history)?;
        ensure_canonical_clean(&repo_root)?;

        let engine = Self {
            inner: Arc::new(EngineInner {
                repo_root,
                state_root,
                candidates_root,
                target_ref: target_ref.to_owned(),
                journal: Mutex::new(journal),
                _lock_file: lock_file,
            }),
        };
        engine.recover_incomplete_transactions()?;
        Ok(engine)
    }

    pub fn target_ref(&self) -> &str {
        &self.inner.target_ref
    }
    pub fn repository_root(&self) -> &Path {
        &self.inner.repo_root
    }
    pub fn state_directory(&self) -> &Path {
        &self.inner.state_root
    }

    pub fn begin_transaction(&self) -> Result<KlynTransaction, FsError> {
        ensure_canonical_clean(&self.inner.repo_root)?;
        let base = current_ref(&self.inner.repo_root, &self.inner.target_ref)?;
        let id = new_id();
        let candidate = self.inner.candidates_root.join(&id);
        if fs::symlink_metadata(&candidate).is_ok() {
            return Err(FsError::SymlinkRejected);
        }

        self.append(
            &id,
            TransactionState::Init,
            &base,
            None,
            Some("initialized"),
        )?;
        if let Err(error) = git(
            &self.inner.repo_root,
            vec![
                arg("worktree"),
                arg("add"),
                arg("--detach"),
                arg(&candidate),
                arg(&base),
            ],
        ) {
            let _ = self.append(
                &id,
                TransactionState::Aborted,
                &base,
                None,
                Some("worktree creation failed"),
            );
            return Err(error);
        }

        Ok(KlynTransaction {
            engine: self.clone(),
            transaction_id: id,
            base_revision: base,
            candidate_path: candidate,
            state: TransactionState::Init,
            candidate_revision: None,
        })
    }

    /// Invoke only during startup before accepting requests. Incomplete
    /// transactions are reconciled against the publication ref, never rewound.
    pub fn recover_incomplete_transactions(&self) -> Result<(), FsError> {
        let records = {
            let journal = self
                .inner
                .journal
                .lock()
                .map_err(|_| FsError::SynchronizationUnavailable)?;
            journal.latest_records()
        };
        for record in records {
            let candidate = self.candidate_path(&record.transaction_id)?;
            if record.state.terminal() {
                self.cleanup(&candidate)?;
                continue;
            }
            let published = current_ref(&self.inner.repo_root, &record.target_ref)?;
            if record.state == TransactionState::Validated {
                let candidate_revision = record.candidate_revision.as_deref().ok_or_else(|| {
                    FsError::JournalCorrupt(
                        "validated transaction has no candidate revision".into(),
                    )
                })?;

                if published == candidate_revision
                    || is_ancestor(&self.inner.repo_root, candidate_revision, &published)?
                {
                    // The CAS already took effect. Do not attempt to reverse it
                    // even if the daemon died before writing the terminal record.
                    self.append(
                        &record.transaction_id,
                        TransactionState::Committed,
                        &record.base_revision,
                        Some(candidate_revision),
                        Some("reconciled published candidate during startup recovery"),
                    )?;
                    self.cleanup(&candidate)?;
                } else if published == record.base_revision {
                    self.append(
                        &record.transaction_id,
                        TransactionState::Aborted,
                        &record.base_revision,
                        Some(candidate_revision),
                        Some("candidate had not been published at interruption"),
                    )?;
                    self.cleanup(&candidate)?;
                } else {
                    // Another revision is now visible, and the journal alone
                    // cannot prove whether this candidate was published and
                    // subsequently replaced. Stop recovery without rewriting
                    // the ref or deleting the candidate evidence.
                    return Err(FsError::Conflict {
                        expected: candidate_revision.to_owned(),
                        actual: published,
                    });
                }
            } else {
                self.append(
                    &record.transaction_id,
                    TransactionState::Aborted,
                    &record.base_revision,
                    None,
                    Some("recovered unpublished candidate"),
                )?;
                self.cleanup(&candidate)?;
            }
        }
        Ok(())
    }

    fn candidate_path(&self, id: &str) -> Result<PathBuf, FsError> {
        if !valid_id(id) {
            return Err(FsError::JournalCorrupt("invalid transaction id".into()));
        }
        Ok(self.inner.candidates_root.join(id))
    }

    fn append(
        &self,
        id: &str,
        state: TransactionState,
        base: &str,
        candidate: Option<&str>,
        detail: Option<&str>,
    ) -> Result<(), FsError> {
        let mut journal = self
            .inner
            .journal
            .lock()
            .map_err(|_| FsError::SynchronizationUnavailable)?;
        journal.append(id, state, base, &self.inner.target_ref, candidate, detail)
    }

    fn state_from_journal(&self, id: &str) -> Result<TransactionState, FsError> {
        let journal = self
            .inner
            .journal
            .lock()
            .map_err(|_| FsError::SynchronizationUnavailable)?;
        journal
            .latest_for(id)
            .map(|r| r.state)
            .ok_or_else(|| FsError::JournalCorrupt("transaction missing from journal".into()))
    }

    fn cleanup(&self, candidate: &Path) -> Result<(), FsError> {
        if !candidate.starts_with(&self.inner.candidates_root) {
            return Err(FsError::PathEscape);
        }
        match fs::symlink_metadata(candidate) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let _ = git(&self.inner.repo_root, vec![arg("worktree"), arg("prune")]);
                return Ok(());
            }
            Err(e) => return Err(FsError::Io(e)),
            Ok(m) if m.file_type().is_symlink() => return Err(FsError::SymlinkRejected),
            Ok(m) if !m.is_dir() => return Err(FsError::InvalidPathType),
            Ok(_) => {}
        }
        let actual = fs::canonicalize(candidate)?;
        let root = fs::canonicalize(&self.inner.candidates_root)?;
        if !actual.starts_with(root) {
            return Err(FsError::PathEscape);
        }
        git(
            &self.inner.repo_root,
            vec![
                arg("worktree"),
                arg("remove"),
                arg("--force"),
                arg(candidate),
            ],
        )?;
        let _ = git(&self.inner.repo_root, vec![arg("worktree"), arg("prune")]);
        Ok(())
    }
}

impl KlynTransaction {
    pub fn id(&self) -> &str {
        &self.transaction_id
    }
    pub fn state(&self) -> TransactionState {
        self.state
    }
    pub fn base_revision(&self) -> &str {
        &self.base_revision
    }
    pub fn candidate_path(&self) -> &Path {
        &self.candidate_path
    }
    pub fn candidate_revision(&self) -> Option<&str> {
        self.candidate_revision.as_deref()
    }

    /// None means create-only; Some(text) is an exact preimage requirement.
    pub fn write_file(
        &mut self,
        relative_path: &str,
        expected_old_content: Option<&str>,
        content: &str,
    ) -> Result<(), FsError> {
        self.require(TransactionState::Init)?;
        if relative_path.len() > 4096
            || content.len() > MAX_MUTATION_BYTES
            || expected_old_content.is_some_and(|old| old.len() > MAX_MUTATION_BYTES)
        {
            return Err(FsError::MutationTooLarge);
        }
        let parts = safe_parts(relative_path)?;
        let root = fs::canonicalize(&self.candidate_path)?;
        let mut parent = root.clone();
        for part in parts.iter().take(parts.len() - 1) {
            parent.push(part);
            match fs::symlink_metadata(&parent) {
                Ok(m) if m.file_type().is_symlink() => return Err(FsError::SymlinkRejected),
                Ok(m) if !m.is_dir() => return Err(FsError::InvalidPathType),
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    fs::create_dir(&parent)?;
                    fs::set_permissions(&parent, fs::Permissions::from_mode(0o700))?;
                    sync_directory(parent.parent().ok_or(FsError::PathEscape)?)?;
                }
                Err(e) => return Err(FsError::Io(e)),
            }
            if !fs::canonicalize(&parent)?.starts_with(&root) {
                return Err(FsError::PathEscape);
            }
        }
        let target = parent.join(parts.last().ok_or(FsError::PathEscape)?);
        let exists = match fs::symlink_metadata(&target) {
            Ok(m) if m.file_type().is_symlink() => return Err(FsError::SymlinkRejected),
            Ok(m) if !m.is_file() => return Err(FsError::InvalidPathType),
            Ok(_) => true,
            Err(e) if e.kind() == io::ErrorKind::NotFound => false,
            Err(e) => return Err(FsError::Io(e)),
        };
        match (exists, expected_old_content) {
            (false, None) => {}
            (true, Some(old)) if fs::read(&target)? == old.as_bytes() => {}
            _ => return Err(FsError::WriteConflict),
        }

        let temporary = parent.join(format!(
            ".klyn-write-{}-{}",
            self.transaction_id,
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        let result = (|| -> Result<(), FsError> {
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
            fs::rename(&temporary, &target)?;
            sync_directory(&parent)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    pub fn stage(&mut self) -> Result<(), FsError> {
        self.require(TransactionState::Init)?;
        ensure_head(&self.candidate_path, &self.base_revision)?;
        git(
            &self.candidate_path,
            vec![arg("add"), arg("--all"), arg("--"), arg(".")],
        )?;
        if !has_changes(&self.candidate_path)? {
            return Err(FsError::EmptyTransaction);
        }
        self.engine.append(
            &self.transaction_id,
            TransactionState::Staged,
            &self.base_revision,
            None,
            Some("candidate index staged"),
        )?;
        self.state = TransactionState::Staged;
        Ok(())
    }

    /// Structural validation only. It does not claim that project tests passed.
    pub fn validate(&mut self) -> Result<&str, FsError> {
        self.require(TransactionState::Staged)?;
        match self.validate_inner() {
            Ok(revision) => {
                self.candidate_revision = Some(revision);
                self.state = TransactionState::Validated;
                Ok(self.candidate_revision.as_deref().expect("assigned above"))
            }
            Err(error) => {
                let _ = self.abort_inner("validation failed");
                Err(error)
            }
        }
    }

    fn validate_inner(&mut self) -> Result<String, FsError> {
        ensure_head(&self.candidate_path, &self.base_revision)?;
        git(
            &self.candidate_path,
            vec![arg("diff"), arg("--cached"), arg("--check")],
        )?;
        reject_links(&self.candidate_path)?;
        if !has_changes(&self.candidate_path)? {
            return Err(FsError::EmptyTransaction);
        }

        let message = format!("KLYN candidate transaction {}", self.transaction_id);
        git(
            &self.candidate_path,
            vec![
                arg("-c"),
                arg("user.name=KLYN Transaction Engine"),
                arg("-c"),
                arg("user.email=klyn-transaction@invalid"),
                arg("-c"),
                arg("core.hooksPath=/dev/null"),
                arg("commit"),
                arg("--no-gpg-sign"),
                arg("--no-verify"),
                arg("-m"),
                arg(message),
            ],
        )?;
        let revision = git_text(
            &self.candidate_path,
            vec![arg("rev-parse"), arg("--verify"), arg("HEAD^{commit}")],
        )?;
        let parent = git_text(
            &self.candidate_path,
            vec![
                arg("rev-parse"),
                arg("--verify"),
                arg(format!("{revision}^")),
            ],
        )?;
        if parent != self.base_revision {
            return Err(FsError::JournalCorrupt(
                "candidate commit parent differs from pinned base".into(),
            ));
        }
        ensure_clean(&self.candidate_path)?;
        self.engine.append(
            &self.transaction_id,
            TransactionState::Validated,
            &self.base_revision,
            Some(&revision),
            Some("structural validation passed; candidate commit recorded"),
        )?;
        Ok(revision)
    }

    pub fn commit(&mut self) -> Result<PublishReceipt, FsError> {
        self.require(TransactionState::Validated)?;
        let journal_state = self.engine.state_from_journal(&self.transaction_id)?;
        if journal_state != TransactionState::Validated {
            return Err(FsError::WrongState {
                expected: TransactionState::Validated,
                actual: journal_state,
            });
        }
        let revision = self.candidate_revision.clone().ok_or_else(|| {
            FsError::JournalCorrupt("validated transaction has no candidate revision".into())
        })?;
        ensure_head(&self.candidate_path, &revision)?;
        ensure_clean(&self.candidate_path)?;

        if let Err(error) = git(
            &self.engine.inner.repo_root,
            vec![
                arg("update-ref"),
                arg(&self.engine.inner.target_ref),
                arg(&revision),
                arg(&self.base_revision),
            ],
        ) {
            let actual = current_ref(&self.engine.inner.repo_root, &self.engine.inner.target_ref)?;
            let _ = self.abort_inner("publication CAS failed");
            if actual != self.base_revision {
                return Err(FsError::Conflict {
                    expected: self.base_revision.clone(),
                    actual,
                });
            }
            return Err(error);
        }

        self.state = TransactionState::Committed;
        if self
            .engine
            .append(
                &self.transaction_id,
                TransactionState::Committed,
                &self.base_revision,
                Some(&revision),
                Some("Git ref compare-and-swap succeeded"),
            )
            .is_err()
        {
            return Err(FsError::PublishedButJournalIncomplete { revision });
        }
        if let Err(error) = self.engine.cleanup(&self.candidate_path) {
            return Err(FsError::PublishedCleanupPending {
                revision,
                reason: error.to_string(),
            });
        }
        Ok(PublishReceipt {
            transaction_id: self.transaction_id.clone(),
            target_ref: self.engine.inner.target_ref.clone(),
            base_revision: self.base_revision.clone(),
            published_revision: revision,
        })
    }

    pub fn abort(&mut self) -> Result<(), FsError> {
        self.abort_inner("explicit abort")
    }

    fn abort_inner(&mut self, detail: &str) -> Result<(), FsError> {
        if self.state.terminal() {
            return Ok(());
        }
        let current = self.engine.state_from_journal(&self.transaction_id)?;
        if current.terminal() {
            self.state = current;
            return Ok(());
        }
        self.engine.append(
            &self.transaction_id,
            TransactionState::Aborted,
            &self.base_revision,
            self.candidate_revision.as_deref(),
            Some(detail),
        )?;
        self.state = TransactionState::Aborted;
        self.engine.cleanup(&self.candidate_path)
    }

    fn require(&self, expected: TransactionState) -> Result<(), FsError> {
        if self.state == expected {
            Ok(())
        } else {
            Err(FsError::WrongState {
                expected,
                actual: self.state,
            })
        }
    }
}

fn safe_parts(path: &str) -> Result<Vec<String>, FsError> {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains('\0') {
        return Err(FsError::PathEscape);
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts
        .iter()
        .any(|p| p.is_empty() || *p == "." || *p == ".." || *p == ".git")
    {
        return Err(FsError::PathEscape);
    }
    if Path::new(path)
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(FsError::PathEscape);
    }
    Ok(parts.into_iter().map(str::to_owned).collect())
}

fn reject_links(candidate: &Path) -> Result<(), FsError> {
    let output = git_output(
        candidate,
        vec![
            arg("diff"),
            arg("--cached"),
            arg("--raw"),
            arg("-z"),
            arg("--no-abbrev"),
        ],
    )?;
    let chunks: Vec<&[u8]> = output.stdout.split(|b| *b == 0).collect();
    let mut i = 0;
    while i < chunks.len() {
        let raw = chunks[i];
        if raw.is_empty() {
            i += 1;
            continue;
        }
        if !raw.starts_with(b":") {
            return Err(FsError::JournalCorrupt(
                "unexpected Git raw diff output".into(),
            ));
        }
        let header = std::str::from_utf8(raw)
            .map_err(|_| FsError::JournalCorrupt("invalid Git diff header".into()))?;
        let fields: Vec<&str> = header.split_whitespace().collect();
        if fields.len() < 5 {
            return Err(FsError::JournalCorrupt("truncated Git diff header".into()));
        }
        if fields[1] == "120000" || fields[1] == "160000" {
            return Err(FsError::LinkOrSubmoduleChange);
        }
        i += 2;
    }
    Ok(())
}

fn has_changes(path: &Path) -> Result<bool, FsError> {
    let output = git_output(path, vec![arg("diff"), arg("--cached"), arg("--quiet")])?;
    match output.status.code() {
        Some(0) => Ok(false),
        Some(1) => Ok(true),
        _ => Err(git_error("inspect staged changes", output)),
    }
}

fn ensure_head(path: &Path, expected: &str) -> Result<(), FsError> {
    let actual = git_text(
        path,
        vec![arg("rev-parse"), arg("--verify"), arg("HEAD^{commit}")],
    )?;
    if actual == expected {
        Ok(())
    } else {
        Err(FsError::Conflict {
            expected: expected.into(),
            actual,
        })
    }
}

fn ensure_clean(path: &Path) -> Result<(), FsError> {
    let status = git_text(
        path,
        vec![
            arg("status"),
            arg("--porcelain"),
            arg("--untracked-files=all"),
        ],
    )?;
    if status.is_empty() {
        Ok(())
    } else {
        Err(FsError::GitCommand {
            operation: "verify clean worktree".into(),
            code: Some(1),
            stderr: "worktree contains uncommitted changes".into(),
        })
    }
}

fn ensure_canonical_clean(path: &Path) -> Result<(), FsError> {
    ensure_clean(path)
}

fn ensure_publication_ref(
    repo: &Path,
    target: &str,
    journal_has_history: bool,
) -> Result<(), FsError> {
    if current_ref(repo, target).is_ok() {
        return Ok(());
    }
    if journal_has_history {
        return Err(FsError::JournalCorrupt(
            "publication ref missing while journal has history".into(),
        ));
    }
    let head = git_text(
        repo,
        vec![arg("rev-parse"), arg("--verify"), arg("HEAD^{commit}")],
    )?;
    git(
        repo,
        vec![arg("update-ref"), arg(target), arg(&head), arg("")],
    )
    .or_else(|_| current_ref(repo, target).map(|_| ()))
}

fn current_ref(repo: &Path, target: &str) -> Result<String, FsError> {
    git_text(
        repo,
        vec![
            arg("rev-parse"),
            arg("--verify"),
            arg(format!("{target}^{{commit}}")),
        ],
    )
}

fn is_ancestor(repo: &Path, ancestor: &str, descendant: &str) -> Result<bool, FsError> {
    let output = git_output(
        repo,
        vec![
            arg("merge-base"),
            arg("--is-ancestor"),
            arg(ancestor),
            arg(descendant),
        ],
    )?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(git_error("verify published revision ancestry", output)),
    }
}

fn worktree_checks_out_ref(worktrees: &str, target: &str) -> bool {
    worktrees.lines().any(|line| {
        line.strip_prefix("branch ")
            .is_some_and(|branch| branch == target)
    })
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_nanos();
    let sequence = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    format!("tx-{nanos:x}-{:x}-{sequence:x}", std::process::id())
}

fn valid_id(id: &str) -> bool {
    if id.len() > 96 {
        return false;
    }
    let Some(suffix) = id.strip_prefix("tx-") else {
        return false;
    };
    !suffix.is_empty()
        && suffix
            .split('-')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn arg(value: impl AsRef<OsStr>) -> OsString {
    value.as_ref().to_os_string()
}

fn git(repo: &Path, args: Vec<OsString>) -> Result<(), FsError> {
    let output = git_output(repo, args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(git_error("Git command", output))
    }
}

fn git_text(repo: &Path, args: Vec<OsString>) -> Result<String, FsError> {
    let output = git_output(repo, args)?;
    if !output.status.success() {
        return Err(git_error("Git command", output));
    }
    String::from_utf8(output.stdout)
        .map(|s| s.trim().to_owned())
        .map_err(|_| FsError::JournalCorrupt("Git output is not UTF-8".into()))
}

fn git_output(repo: &Path, args: Vec<OsString>) -> Result<Output, FsError> {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .arg("-c")
        .arg("core.hooksPath=/dev/null")
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_OBJECT_DIRECTORY")
        .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(FsError::Io)
}

fn git_error(operation: &str, output: Output) -> FsError {
    FsError::GitCommand {
        operation: operation.to_owned(),
        code: output.status.code(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    }
}

fn prepare_private_directory(path: &Path) -> Result<(), FsError> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => return Err(FsError::SymlinkRejected),
        Ok(m) if !m.is_dir() => return Err(FsError::InvalidPathType),
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => fs::create_dir_all(path)?,
        Err(e) => return Err(FsError::Io(e)),
    }
    set_private_dir(path)
}

fn set_private_dir(path: &Path) -> Result<(), FsError> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), FsError> {
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    struct Fixture {
        root: PathBuf,
        state: PathBuf,
        outside: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let id = new_id();
            let parent = std::env::temp_dir().join(format!("klyn-fs-{id}"));
            let root = parent.join("repo");
            let state = parent.join("state");
            let outside = parent.join("outside");
            fs::create_dir_all(&root).unwrap();
            fs::create_dir_all(&outside).unwrap();
            raw_git(&root, &["init", "-b", "main"]).unwrap();
            raw_git(&root, &["config", "user.name", "KLYN Test"]).unwrap();
            raw_git(&root, &["config", "user.email", "test@klyn.invalid"]).unwrap();
            fs::write(root.join("README.md"), "base\n").unwrap();
            raw_git(&root, &["add", "README.md"]).unwrap();
            raw_git(&root, &["commit", "-m", "base"]).unwrap();
            Self {
                root,
                state,
                outside,
            }
        }

        fn engine(&self) -> FsEngine {
            FsEngine::open(&self.root, &self.state, DEFAULT_PUBLICATION_REF).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(self.root.parent().unwrap());
        }
    }

    fn raw_git(repo: &Path, args: &[&str]) -> Result<(), String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).into_owned())
        }
    }

    #[test]
    fn publishes_to_ref_without_writing_canonical_checkout() {
        let fixture = Fixture::new();
        let engine = fixture.engine();
        let original = git_text(&fixture.root, vec![arg("rev-parse"), arg("HEAD")]).unwrap();
        let mut tx = engine.begin_transaction().unwrap();
        tx.write_file("src/new.rs", None, "pub fn ok() -> bool { true }\n")
            .unwrap();
        tx.stage().unwrap();
        let revision = tx.validate().unwrap().to_owned();
        let receipt = tx.commit().unwrap();
        assert_eq!(receipt.published_revision, revision);
        assert_eq!(
            current_ref(&fixture.root, DEFAULT_PUBLICATION_REF).unwrap(),
            revision
        );
        assert_eq!(
            git_text(&fixture.root, vec![arg("rev-parse"), arg("HEAD")]).unwrap(),
            original
        );
        assert!(!fixture.root.join("src/new.rs").exists());
        assert!(!tx.candidate_path.exists());
    }

    #[test]
    fn compare_and_swap_rejects_stale_candidate() {
        let fixture = Fixture::new();
        let engine = fixture.engine();
        let mut a = engine.begin_transaction().unwrap();
        let mut b = engine.begin_transaction().unwrap();
        a.write_file("a.txt", None, "A\n").unwrap();
        b.write_file("b.txt", None, "B\n").unwrap();
        a.stage().unwrap();
        b.stage().unwrap();
        a.validate().unwrap();
        b.validate().unwrap();
        let winner = a.commit().unwrap();
        assert!(matches!(b.commit(), Err(FsError::Conflict { .. })));
        assert_eq!(
            current_ref(&fixture.root, DEFAULT_PUBLICATION_REF).unwrap(),
            winner.published_revision
        );
    }

    #[test]
    fn exact_preimage_is_required_for_replacement() {
        let fixture = Fixture::new();
        let engine = fixture.engine();
        let mut tx = engine.begin_transaction().unwrap();
        assert!(matches!(
            tx.write_file("README.md", None, "new\n"),
            Err(FsError::WriteConflict)
        ));
        assert!(matches!(
            tx.write_file("README.md", Some("wrong\n"), "new\n"),
            Err(FsError::WriteConflict)
        ));
        tx.write_file("README.md", Some("base\n"), "new\n").unwrap();
        tx.stage().unwrap();
        tx.validate().unwrap();
        tx.commit().unwrap();
    }

    #[test]
    fn traversal_and_git_metadata_paths_are_rejected() {
        let fixture = Fixture::new();
        let engine = fixture.engine();
        let mut tx = engine.begin_transaction().unwrap();
        for path in ["../escape", "/tmp/escape", ".git/config", "a/../../escape"] {
            assert!(matches!(
                tx.write_file(path, None, "x"),
                Err(FsError::PathEscape)
            ));
        }
        assert!(!fixture.outside.join("escape").exists());
        tx.abort().unwrap();
    }

    #[test]
    fn symlink_parent_cannot_escape_candidate() {
        let fixture = Fixture::new();
        let engine = fixture.engine();
        let mut tx = engine.begin_transaction().unwrap();
        symlink(&fixture.outside, tx.candidate_path().join("escape")).unwrap();
        assert!(matches!(
            tx.write_file("escape/pwned", None, "bad"),
            Err(FsError::SymlinkRejected)
        ));
        assert!(!fixture.outside.join("pwned").exists());
        tx.abort().unwrap();
    }

    #[test]
    fn recovery_aborts_incomplete_candidate_without_changing_ref() {
        let fixture = Fixture::new();
        let engine = fixture.engine();
        let base = current_ref(&fixture.root, DEFAULT_PUBLICATION_REF).unwrap();
        let mut tx = engine.begin_transaction().unwrap();
        tx.write_file("discard.txt", None, "discard\n").unwrap();
        tx.stage().unwrap();
        let candidate = tx.candidate_path().to_owned();
        drop(tx);
        drop(engine);

        // Opening a fresh engine instance exercises the real startup recovery
        // path, not just an in-memory re-scan of the same journal.
        let reopened =
            FsEngine::open(&fixture.root, &fixture.state, DEFAULT_PUBLICATION_REF).unwrap();
        assert_eq!(
            current_ref(&fixture.root, DEFAULT_PUBLICATION_REF).unwrap(),
            base
        );
        assert!(!candidate.exists());
        assert!(reopened
            .inner
            .journal
            .lock()
            .unwrap()
            .latest
            .values()
            .any(
                |record| record.state == TransactionState::Aborted && record.base_revision == base
            ));
    }

    #[test]
    fn second_engine_open_is_excluded_by_advisory_lock() {
        let fixture = Fixture::new();
        let engine = fixture.engine();
        assert!(matches!(
            FsEngine::open(&fixture.root, &fixture.state, DEFAULT_PUBLICATION_REF),
            Err(FsError::EngineLocked)
        ));
        drop(engine);
    }
}
