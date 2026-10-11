//! Authenticated IPC adapter for klyn-fs candidate transactions.

use std::{collections::BTreeMap, sync::Mutex};

use klyn_fs::{FsEngine, FsError, KlynTransaction, TransactionState};
use klyn_protocol::{FsWriteFileParams, Method, TransactionIdParams};
use serde_json::{json, Value};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum FsServiceError {
    #[error("filesystem transaction not found")]
    NotFound,
    #[error("filesystem IPC parameters are invalid")]
    InvalidParameters,
    #[error("filesystem transaction registry is unavailable")]
    RegistryUnavailable,
    #[error(transparent)]
    Engine(#[from] FsError),
}

pub struct FsService {
    engine: FsEngine,
    transactions: Mutex<BTreeMap<String, KlynTransaction>>,
}

impl FsService {
    pub fn new(engine: FsEngine) -> Self {
        Self {
            engine,
            transactions: Mutex::new(BTreeMap::new()),
        }
    }

    /// Resolve an active transaction to its private candidate workspace.
    /// The returned path is only used by trusted broker setup; workers never
    /// receive host filesystem paths or canonical-workspace descriptors.
    pub fn candidate_path_for_transaction(
        &self,
        transaction_id: &str,
    ) -> Result<std::path::PathBuf, FsServiceError> {
        let registry = self
            .transactions
            .lock()
            .map_err(|_| FsServiceError::RegistryUnavailable)?;
        registry
            .get(transaction_id)
            .map(|transaction| transaction.candidate_path().to_path_buf())
            .ok_or(FsServiceError::NotFound)
    }

    pub fn execute(&self, method: Method, params: &Value) -> Result<Value, FsServiceError> {
        match method {
            Method::FsBegin => {
                let tx = self.engine.begin_transaction()?;
                let id = tx.id().to_owned();
                let result = json!({
                    "transaction_id": id,
                    "base_revision": tx.base_revision(),
                    "candidate_path": tx.candidate_path().to_string_lossy().into_owned(),
                    "target_ref": self.engine.target_ref(),
                    "state": "init"
                });
                let mut registry = self
                    .transactions
                    .lock()
                    .map_err(|_| FsServiceError::RegistryUnavailable)?;
                if registry.contains_key(&id) {
                    return Err(FsServiceError::RegistryUnavailable);
                }
                registry.insert(id, tx);
                Ok(result)
            }
            Method::FsWriteFile => {
                let request: FsWriteFileParams = serde_json::from_value(params.clone())
                    .map_err(|_| FsServiceError::InvalidParameters)?;
                let mut registry = self
                    .transactions
                    .lock()
                    .map_err(|_| FsServiceError::RegistryUnavailable)?;
                let tx = registry
                    .get_mut(&request.transaction_id)
                    .ok_or(FsServiceError::NotFound)?;
                tx.write_file(
                    &request.path,
                    request.expected_old_content.as_deref(),
                    &request.content,
                )?;
                Ok(json!({"transaction_id": request.transaction_id, "state": "init"}))
            }
            Method::FsStage => {
                let request: TransactionIdParams = serde_json::from_value(params.clone())
                    .map_err(|_| FsServiceError::InvalidParameters)?;
                let mut registry = self
                    .transactions
                    .lock()
                    .map_err(|_| FsServiceError::RegistryUnavailable)?;
                let tx = registry
                    .get_mut(&request.transaction_id)
                    .ok_or(FsServiceError::NotFound)?;
                tx.stage()?;
                Ok(json!({"transaction_id": request.transaction_id, "state": "staged"}))
            }
            Method::FsValidate => {
                let request: TransactionIdParams = serde_json::from_value(params.clone())
                    .map_err(|_| FsServiceError::InvalidParameters)?;
                let mut registry = self
                    .transactions
                    .lock()
                    .map_err(|_| FsServiceError::RegistryUnavailable)?;
                let id = request.transaction_id;
                let result = {
                    let tx = registry.get_mut(&id).ok_or(FsServiceError::NotFound)?;
                    let base_revision = tx.base_revision().to_owned();
                    tx.validate().map(|revision| {
                        json!({
                            "transaction_id": id,
                            "state": "validated",
                            "candidate_revision": revision.to_owned(),
                            "base_revision": base_revision
                        })
                    })
                };
                let terminal = registry.get(&id).is_some_and(|tx| {
                    matches!(
                        tx.state(),
                        TransactionState::Aborted | TransactionState::Committed
                    )
                });
                if terminal {
                    registry.remove(&id);
                }
                result.map_err(FsServiceError::Engine)
            }
            Method::FsCommit => {
                let request: TransactionIdParams = serde_json::from_value(params.clone())
                    .map_err(|_| FsServiceError::InvalidParameters)?;
                let mut registry = self
                    .transactions
                    .lock()
                    .map_err(|_| FsServiceError::RegistryUnavailable)?;
                let id = request.transaction_id;
                let mut tx = registry.remove(&id).ok_or(FsServiceError::NotFound)?;
                match tx.commit() {
                    Ok(receipt) => Ok(json!({
                        "transaction_id": receipt.transaction_id,
                        "state": "committed",
                        "target_ref": receipt.target_ref,
                        "base_revision": receipt.base_revision,
                        "published_revision": receipt.published_revision
                    })),
                    Err(error) => {
                        if !matches!(
                            tx.state(),
                            TransactionState::Committed | TransactionState::Aborted
                        ) {
                            registry.insert(id, tx);
                        }
                        Err(FsServiceError::Engine(error))
                    }
                }
            }
            Method::FsAbort => {
                let request: TransactionIdParams = serde_json::from_value(params.clone())
                    .map_err(|_| FsServiceError::InvalidParameters)?;
                let mut registry = self
                    .transactions
                    .lock()
                    .map_err(|_| FsServiceError::RegistryUnavailable)?;
                let id = request.transaction_id;
                let mut tx = registry.remove(&id).ok_or(FsServiceError::NotFound)?;
                match tx.abort() {
                    Ok(()) => Ok(json!({"transaction_id": id, "state": "aborted"})),
                    Err(error) => {
                        registry.insert(id, tx);
                        Err(FsServiceError::Engine(error))
                    }
                }
            }
            _ => Err(FsServiceError::InvalidParameters),
        }
    }
}

impl klyn_sandbox::broker::CandidateMutationHandler for FsService {
    fn write_candidate_file(
        &self,
        transaction_id: &str,
        relative_path: &str,
        expected_old_content: Option<&str>,
        content: &str,
    ) -> Result<(), String> {
        let params = json!({
            "transaction_id": transaction_id,
            "path": relative_path,
            "expected_old_content": expected_old_content,
            "content": content,
        });
        self.execute(Method::FsWriteFile, &params)
            .map(|_| ())
            .map_err(|_| "klyn-fs rejected the candidate mutation".to_string())
    }
}
