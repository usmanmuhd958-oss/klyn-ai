//! Capability-based security model

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use parking_lot::RwLock;
use std::sync::Arc;
use crate::Result;

/// Capability token
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Capability {
    pub id: String,
    pub subject: String,           // Agent ID
    pub resource_type: String,     // "code_file", "secret", etc.
    pub resource_id: String,       // Specific resource
    pub operations: Vec<String>,   // ["read", "write", "execute"]
    pub constraints: HashMap<String, String>,
    pub expires_at: u64,
}

impl Capability {
    /// Check if capability grants an operation
    pub fn allows(&self, operation: &str) -> bool {
        self.operations.contains(&operation.to_string())
    }

    /// Check if capability has expired
    pub fn is_expired(&self, current_time: u64) -> bool {
        current_time > self.expires_at
    }
}

/// Capability manager
pub struct CapabilityManager {
    capabilities: Arc<RwLock<HashMap<String, Capability>>>,
    revocation_list: Arc<RwLock<Vec<String>>>,
}

impl CapabilityManager {
    pub fn new() -> Self {
        Self {
            capabilities: Arc::new(RwLock::new(HashMap::new())),
            revocation_list: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Grant a capability
    pub fn grant(&self, capability: Capability) -> Result<()> {
        self.capabilities.write().insert(capability.id.clone(), capability);
        Ok(())
    }

    /// Verify a capability
    pub fn verify(&self, cap_id: &str, operation: &str, current_time: u64) -> Result<bool> {
        // Check revocation list
        if self.revocation_list.read().contains(&cap_id.to_string()) {
            return Ok(false);
        }

        match self.capabilities.read().get(cap_id) {
            Some(cap) => {
                if cap.is_expired(current_time) {
                    return Ok(false);
                }
                Ok(cap.allows(operation))
            }
            None => Ok(false),
        }
    }

    /// Revoke a capability
    pub fn revoke(&self, cap_id: &str) -> Result<()> {
        self.revocation_list.write().push(cap_id.to_string());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capability_allows() {
        let cap = Capability {
            id: "cap:1".to_string(),
            subject: "agent:coder".to_string(),
            resource_type: "code_file".to_string(),
            resource_id: "file:1".to_string(),
            operations: vec!["read".to_string(), "write".to_string()],
            constraints: HashMap::new(),
            expires_at: 2000,
        };

        assert!(cap.allows("read"));
        assert!(cap.allows("write"));
        assert!(!cap.allows("delete"));
    }

    #[test]
    fn test_capability_expiration() {
        let cap = Capability {
            id: "cap:1".to_string(),
            subject: "agent:coder".to_string(),
            resource_type: "code_file".to_string(),
            resource_id: "file:1".to_string(),
            operations: vec!["read".to_string()],
            constraints: HashMap::new(),
            expires_at: 1000,
        };

        assert!(!cap.is_expired(1000));
        assert!(cap.is_expired(1001));
    }

    #[test]
    fn test_capability_manager() {
        let manager = CapabilityManager::new();
        let cap = Capability {
            id: "cap:1".to_string(),
            subject: "agent:coder".to_string(),
            resource_type: "code_file".to_string(),
            resource_id: "file:1".to_string(),
            operations: vec!["read".to_string()],
            constraints: HashMap::new(),
            expires_at: 2000,
        };

        manager.grant(cap).unwrap();
        assert!(manager.verify("cap:1", "read", 1000).unwrap());
        assert!(!manager.verify("cap:1", "write", 1000).unwrap());

        manager.revoke("cap:1").unwrap();
        assert!(!manager.verify("cap:1", "read", 1000).unwrap());
    }
}
