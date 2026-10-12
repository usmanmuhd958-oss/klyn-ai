//! Authenticated IPC adapter for klyn-fs candidate transactions.
//!
//! Transaction ownership is bound to the kernel-authenticated peer UID supplied
//! by the daemon after SO_PEERCRED validation. The daemon separately rechecks
//! method permissions on every request before dispatching here.

use std::{collections::BTreeMap, sync::Mutex};

use klyn_fs::{FsEngine, FsError, KlynTransaction, TransactionState};
use klyn_protocol::{FsWriteFileParams, Method, TransactionIdParams};
use serde_json::{json, Value};
use thiserror::Error;

use crate::policy::PeerIdentity;

#[derive(Debug, Error)]
pub enum FsServiceError {
    #[error("filesystem transaction not found")]
    NotFound,
    #[error("caller does not own this filesystem transaction")]
    PermissionDenied,
    #[error("filesystem IPC parameters are invalid")]
    InvalidParameters,
    #[error("filesystem transaction registry is unavailable")]
    RegistryUnavailable,
    #[error(transparent)]
    Engine(#[from] FsError),
}

struct OwnedTransaction {
    owner_uid: u32,
    transaction: KlynTransaction,
}

pub struct FsService {
    engine: FsEngine,
    transactions: Mutex<BTreeMap<String, OwnedTransaction>>,
}

impl FsService {
    pub fn new(engine: FsEngine) -> Self {
        Self {
            engine,
            transactions: Mutex::new(BTreeMap::new()),
        }
    }
    /// Resolve an active candidate only for its authenticated transaction owner.
    ///
    /// Callers must not expose this path to untrusted workers. The reconciled
    /// sandbox uses a separately provisioned read-only root until write mediation
    /// is integrated and qualified.
    pub fn candidate_path_for_transaction(
        &self,
        transaction_id: &str,
        peer: PeerIdentity,
    ) -> Result<std::path::PathBuf, FsServiceError> {
        let registry = self
            .transactions
            .lock()
            .map_err(|_| FsServiceError::RegistryUnavailable)?;
        let owned = registry
            .get(transaction_id)
            .ok_or(FsServiceError::NotFound)?;
        if owned.owner_uid != peer.uid {
            return Err(FsServiceError::PermissionDenied);
        }
        Ok(owned.transaction.candidate_path().to_path_buf())
    }


    /// Execute one already-policy-authorized operation for a peer whose UID was
    /// obtained from kernel Unix-socket credentials, never from request JSON.
    pub fn execute(
        &self,
        peer: PeerIdentity,
        method: Method,
        params: &Value,
    ) -> Result<Value, FsServiceError> {
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
                registry.insert(
                    id,
                    OwnedTransaction {
                        owner_uid: peer.uid,
                        transaction: tx,
                    },
                );
                Ok(result)
            }
            Method::FsWriteFile => {
                let request: FsWriteFileParams = serde_json::from_value(params.clone())
                    .map_err(|_| FsServiceError::InvalidParameters)?;
                let mut registry = self
                    .transactions
                    .lock()
                    .map_err(|_| FsServiceError::RegistryUnavailable)?;
                let owned = owned_transaction_mut(&mut registry, &request.transaction_id, peer)?;
                owned.transaction.write_file(
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
                let owned = owned_transaction_mut(&mut registry, &request.transaction_id, peer)?;
                owned.transaction.stage()?;
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
                    let owned = owned_transaction_mut(&mut registry, &id, peer)?;
                    let base_revision = owned.transaction.base_revision().to_owned();
                    owned.transaction.validate().map(|revision| {
                        json!({
                            "transaction_id": id,
                            "state": "validated",
                            "candidate_revision": revision.to_owned(),
                            "base_revision": base_revision
                        })
                    })
                };
                let terminal = registry.get(&id).is_some_and(|owned| {
                    matches!(
                        owned.transaction.state(),
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
                let owned = take_owned_transaction(&mut registry, &id, peer)?;
                let owner_uid = owned.owner_uid;
                let mut tx = owned.transaction;
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
                            registry.insert(
                                id,
                                OwnedTransaction {
                                    owner_uid,
                                    transaction: tx,
                                },
                            );
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
                let owned = take_owned_transaction(&mut registry, &id, peer)?;
                let owner_uid = owned.owner_uid;
                let mut tx = owned.transaction;
                match tx.abort() {
                    Ok(()) => Ok(json!({"transaction_id": id, "state": "aborted"})),
                    Err(error) => {
                        registry.insert(
                            id,
                            OwnedTransaction {
                                owner_uid,
                                transaction: tx,
                            },
                        );
                        Err(FsServiceError::Engine(error))
                    }
                }
            }
            _ => Err(FsServiceError::InvalidParameters),
        }
    }
}

fn owned_transaction_mut<'a>(
    registry: &'a mut BTreeMap<String, OwnedTransaction>,
    id: &str,
    peer: PeerIdentity,
) -> Result<&'a mut OwnedTransaction, FsServiceError> {
    let owned = registry.get_mut(id).ok_or(FsServiceError::NotFound)?;
    if owned.owner_uid != peer.uid {
        return Err(FsServiceError::PermissionDenied);
    }
    Ok(owned)
}

fn take_owned_transaction(
    registry: &mut BTreeMap<String, OwnedTransaction>,
    id: &str,
    peer: PeerIdentity,
) -> Result<OwnedTransaction, FsServiceError> {
    let owned = registry.get(id).ok_or(FsServiceError::NotFound)?;
    if owned.owner_uid != peer.uid {
        return Err(FsServiceError::PermissionDenied);
    }
    registry.remove(id).ok_or(FsServiceError::NotFound)
}
