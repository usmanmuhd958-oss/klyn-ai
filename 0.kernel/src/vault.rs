//! Hardware-Bound Cryptographic Vault
//!
//! AES-256-GCM encryption with memory locking and secure zeroization.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use zeroize::{Zeroize, ZeroizeOnDrop};
use std::ptr;

const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;
const MAX_VAULT_SIZE: usize = 1024 * 1024; // 1MB locked memory

#[derive(Debug)]
pub enum VaultError {
    EncryptionFailed,
    DecryptionFailed,
    MemoryLockFailed,
    InvalidKeySize,
    VaultFull,
    InvalidNonce,
}

impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VaultError::EncryptionFailed => write!(f, "Encryption operation failed"),
            VaultError::DecryptionFailed => write!(f, "Decryption operation failed"),
            VaultError::MemoryLockFailed => write!(f, "Failed to lock memory pages"),
            VaultError::InvalidKeySize => write!(f, "Invalid key size"),
            VaultError::VaultFull => write!(f, "Vault capacity exceeded"),
            VaultError::InvalidNonce => write!(f, "Invalid nonce"),
        }
    }
}

impl std::error::Error for VaultError {}

#[repr(C, align(64))]
struct SecureBuffer {
    data: Box<[u8]>,
    locked: bool,
}

impl SecureBuffer {
    unsafe fn new(size: usize) -> Result<Self, VaultError> {
        let mut data = vec![0u8; size].into_boxed_slice();
        let ptr = data.as_mut_ptr();
        
        #[cfg(unix)]
        {
            let result = libc::mlock(ptr as *const libc::c_void, size);
            if result != 0 {
                return Err(VaultError::MemoryLockFailed);
            }
        }

        #[cfg(windows)]
        {
            use winapi::um::memoryapi::VirtualLock;
            let result = VirtualLock(ptr as *mut winapi::ctypes::c_void, size);
            if result == 0 {
                return Err(VaultError::MemoryLockFailed);
            }
        }

        Ok(Self {
            data,
            locked: true,
        })
    }

    fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.data
    }

    fn as_slice(&self) -> &[u8] {
        &self.data
    }
}

impl Drop for SecureBuffer {
    fn drop(&mut self) {
        if self.locked {
            let ptr = self.data.as_mut_ptr();
            let len = self.data.len();

            unsafe {
                ptr::write_volatile(ptr, 0);
                for i in 0..len {
                    ptr::write_volatile(ptr.add(i), 0);
                }
                
                #[cfg(unix)]
                {
                    libc::munlock(ptr as *const libc::c_void, len);
                }

                #[cfg(windows)]
                {
                    use winapi::um::memoryapi::VirtualUnlock;
                    VirtualUnlock(ptr as *mut winapi::ctypes::c_void, len);
                }
            }
        }

        self.data.zeroize();
    }
}

#[derive(ZeroizeOnDrop)]
pub struct VaultKey {
    #[zeroize(skip)]
    cipher: Aes256Gcm,
    key_material: [u8; KEY_SIZE],
}

impl VaultKey {
    pub fn generate() -> Self {
        let key = Aes256Gcm::generate_key(&mut OsRng);
        let mut key_material = [0u8; KEY_SIZE];
        key_material.copy_from_slice(&key);

        Self {
            cipher: Aes256Gcm::new(&key),
            key_material,
        }
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, VaultError> {
        if bytes.len() != KEY_SIZE {
            return Err(VaultError::InvalidKeySize);
        }

        let mut key_material = [0u8; KEY_SIZE];
        key_material.copy_from_slice(bytes);
        let key = Key::<Aes256Gcm>::from_slice(&key_material);

        Ok(Self {
            cipher: Aes256Gcm::new(key),
            key_material,
        })
    }

    #[inline(always)]
    pub fn encrypt(&self, plaintext: &[u8], nonce_bytes: &[u8; NONCE_SIZE]) -> Result<Vec<u8>, VaultError> {
        let nonce = Nonce::from_slice(nonce_bytes);
        self.cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| VaultError::EncryptionFailed)
    }

    #[inline(always)]
    pub fn decrypt(&self, ciphertext: &[u8], nonce_bytes: &[u8; NONCE_SIZE]) -> Result<Vec<u8>, VaultError> {
        let nonce = Nonce::from_slice(nonce_bytes);
        self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| VaultError::DecryptionFailed)
    }
}

pub struct Vault {
    key: VaultKey,
    storage: SecureBuffer,
    used: usize,
}

impl Vault {
    pub fn new() -> Result<Self, VaultError> {
        let storage = unsafe { SecureBuffer::new(MAX_VAULT_SIZE)? };
        Ok(Self {
            key: VaultKey::generate(),
            storage,
            used: 0,
        })
    }

    pub fn with_key(key: VaultKey) -> Result<Self, VaultError> {
        let storage = unsafe { SecureBuffer::new(MAX_VAULT_SIZE)? };
        Ok(Self {
            key,
            storage,
            used: 0,
        })
    }

    #[inline]
    pub fn seal(&mut self, data: &[u8]) -> Result<SealedData, VaultError> {
        if self.used + data.len() + NONCE_SIZE > MAX_VAULT_SIZE {
            return Err(VaultError::VaultFull);
        }

        let mut nonce = [0u8; NONCE_SIZE];
        use aes_gcm::aead::rand_core::RngCore;
        OsRng.fill_bytes(&mut nonce);

        let ciphertext = self.key.encrypt(data, &nonce)?;
        
        let offset = self.used;
        let total_size = NONCE_SIZE + ciphertext.len();
        
        self.storage.as_mut_slice()[offset..offset + NONCE_SIZE].copy_from_slice(&nonce);
        self.storage.as_mut_slice()[offset + NONCE_SIZE..offset + total_size]
            .copy_from_slice(&ciphertext);
        
        self.used += total_size;

        Ok(SealedData {
            offset,
            size: total_size,
        })
    }

    #[inline]
    pub fn unseal(&self, sealed: &SealedData) -> Result<Vec<u8>, VaultError> {
        if sealed.offset + sealed.size > self.used {
            return Err(VaultError::DecryptionFailed);
        }

        let storage = self.storage.as_slice();
        let mut nonce = [0u8; NONCE_SIZE];
        nonce.copy_from_slice(&storage[sealed.offset..sealed.offset + NONCE_SIZE]);

        let ciphertext = &storage[sealed.offset + NONCE_SIZE..sealed.offset + sealed.size];
        self.key.decrypt(ciphertext, &nonce)
    }

    pub fn reset(&mut self) {
        self.used = 0;
        self.storage.as_mut_slice().zeroize();
    }

    pub fn capacity(&self) -> usize {
        MAX_VAULT_SIZE
    }

    pub fn used(&self) -> usize {
        self.used
    }

    pub fn available(&self) -> usize {
        MAX_VAULT_SIZE - self.used
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SealedData {
    offset: usize,
    size: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault_seal_unseal() {
        let mut vault = Vault::new().unwrap();
        let plaintext = b"Secret kernel data";
        
        let sealed = vault.seal(plaintext).unwrap();
        let unsealed = vault.unseal(&sealed).unwrap();
        
        assert_eq!(plaintext, unsealed.as_slice());
    }
}
