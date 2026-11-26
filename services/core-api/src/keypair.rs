//! Ed25519 Solana keypair loading (`.keys/*.json`) with deterministic standalone/test fallback.
//! Never logs or serializes private key material.

use std::path::{Path, PathBuf};

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

#[derive(Clone)]
pub struct SolanaSigner {
    signing_key: SigningKey,
    pubkey_b58: String,
    loaded_from_disk: bool,
}

impl std::fmt::Debug for SolanaSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SolanaSigner")
            .field("pubkey", &self.pubkey_b58)
            .field("loaded_from_disk", &self.loaded_from_disk)
            .finish()
    }
}

impl SolanaSigner {
    /// Loads a 64-byte Solana CLI JSON keypair file (e.g. `.keys/kora_sponsor.json`),
    /// falling back to a deterministic SHA-256-seeded Ed25519 keypair when absent.
    pub fn load_or_deterministic(file_name: &str, fallback_domain_seed: &str) -> Self {
        for candidate in candidate_key_paths(file_name) {
            if let Ok(signer) = Self::from_solana_keypair_file(&candidate) {
                return signer;
            }
        }
        Self::deterministic_from_seed(fallback_domain_seed)
    }

    pub fn from_solana_keypair_file(path: &Path) -> Result<Self, String> {
        let raw = std::fs::read_to_string(path)
            .map_err(|e| format!("failed reading keypair {}: {e}", path.display()))?;
        let bytes: Vec<u8> = serde_json::from_str(&raw)
            .map_err(|e| format!("invalid JSON keypair {}: {e}", path.display()))?;
        if bytes.len() != 64 {
            return Err(format!(
                "expected 64-byte Solana keypair in {}, got {}",
                path.display(),
                bytes.len()
            ));
        }
        let mut secret = [0u8; 32];
        secret.copy_from_slice(&bytes[0..32]);
        let signing_key = SigningKey::from_bytes(&secret);
        let derived_pub = signing_key.verifying_key().to_bytes();
        if derived_pub != bytes[32..64] {
            return Err(format!(
                "public key mismatch in Solana keypair {}",
                path.display()
            ));
        }
        let pubkey_b58 = bs58::encode(derived_pub).into_string();
        Ok(Self {
            signing_key,
            pubkey_b58,
            loaded_from_disk: true,
        })
    }

    pub fn deterministic_from_seed(domain_seed: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(b"cartridgefi:ed25519:v2:");
        hasher.update(domain_seed.as_bytes());
        let digest = hasher.finalize();
        let mut secret = [0u8; 32];
        secret.copy_from_slice(&digest);
        let signing_key = SigningKey::from_bytes(&secret);
        let pubkey_b58 = bs58::encode(signing_key.verifying_key().to_bytes()).into_string();
        Self {
            signing_key,
            pubkey_b58,
            loaded_from_disk: false,
        }
    }

    pub fn generate_ephemeral() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        let pubkey_b58 = bs58::encode(signing_key.verifying_key().to_bytes()).into_string();
        Self {
            signing_key,
            pubkey_b58,
            loaded_from_disk: false,
        }
    }

    pub fn pubkey_base58(&self) -> &str {
        &self.pubkey_b58
    }

    pub fn pubkey_bytes(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }

    pub fn loaded_from_disk(&self) -> bool {
        self.loaded_from_disk
    }

    pub fn sign_message(&self, message: &[u8]) -> [u8; 64] {
        let sig: Signature = self.signing_key.sign(message);
        sig.to_bytes()
    }

    pub fn verify_signature(&self, message: &[u8], signature_bytes: &[u8; 64]) -> bool {
        let sig = Signature::from_bytes(signature_bytes);
        self.signing_key
            .verifying_key()
            .verify(message, &sig)
            .is_ok()
    }
}

pub fn verify_ed25519_base58(pubkey_b58: &str, message: &[u8], sig_bytes: &[u8; 64]) -> bool {
    let Ok(pub_vec) = bs58::decode(pubkey_b58).into_vec() else {
        return false;
    };
    let Ok(pub_arr): Result<[u8; 32], _> = pub_vec.try_into() else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&pub_arr) else {
        return false;
    };
    let sig = Signature::from_bytes(sig_bytes);
    verifying_key.verify(message, &sig).is_ok()
}

fn candidate_key_paths(file_name: &str) -> Vec<PathBuf> {
    let mut paths = Vec::with_capacity(5);
    if let Ok(custom_dir) = std::env::var("CARTRIDGEFI_KEYS_DIR") {
        if !custom_dir.trim().is_empty() {
            paths.push(PathBuf::from(custom_dir).join(file_name));
        }
    }
    paths.push(PathBuf::from(".keys").join(file_name));
    paths.push(PathBuf::from("../.keys").join(file_name));
    paths.push(PathBuf::from("../../.keys").join(file_name));
    paths.push(PathBuf::from("/home/antigravity/kunal-drall/cartridgefi/.keys").join(file_name));
    paths
}
