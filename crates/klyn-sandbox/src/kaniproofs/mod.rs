//! Bounded proofs for the pure invariant kernels shared with production.
//!
//! Kani does not model OS threads, inter-process scheduling, mmap, or memory-order
//! interactions. These tests must not be represented as an end-to-end race-freedom
//! proof for the shared-memory implementation.

mod ipc_ring;
mod kel;
