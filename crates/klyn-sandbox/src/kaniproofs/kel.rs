//! Kani proofs for pure KEL lifecycle and immutable-chain transitions.

use crate::kel::{
    chain_predecessor_matches, checked_next_sequence, transition_allowed, KelChainError,
    KelChainState, KelEventKind,
};

#[kani::proof]
fn terminal_lifecycle_states_reject_every_successor() {
    let next: KelEventKind = kani::any();
    assert!(!transition_allowed(Some(KelEventKind::CgroupDestroy), next));
    assert!(!transition_allowed(Some(KelEventKind::CapabilityRejected), next));
}

#[kani::proof]
fn accepted_transitions_have_only_documented_predecessors() {
    let previous: Option<KelEventKind> = kani::any();
    let next: KelEventKind = kani::any();

    if transition_allowed(previous, next) {
        match next {
            KelEventKind::CapabilityValidated | KelEventKind::CapabilityRejected => {
                assert_eq!(previous, None);
            }
            KelEventKind::Spawn => {
                assert_eq!(previous, Some(KelEventKind::CapabilityValidated));
            }
            KelEventKind::WorkerAttested => {
                assert_eq!(previous, Some(KelEventKind::Spawn));
            }
            KelEventKind::PolicyGateClear => {
                assert_eq!(previous, Some(KelEventKind::WorkerAttested));
            }
            KelEventKind::TelemetryAnomaly => {
                assert!(matches!(
                    previous,
                    Some(
                        KelEventKind::Spawn
                            | KelEventKind::PolicyGateClear
                            | KelEventKind::TelemetryAnomaly
                    )
                ));
            }
            KelEventKind::CgroupDestroy => {
                assert!(matches!(
                    previous,
                    Some(
                        KelEventKind::CapabilityValidated
                            | KelEventKind::Spawn
                            | KelEventKind::WorkerAttested
                            | KelEventKind::PolicyGateClear
                            | KelEventKind::TelemetryAnomaly
                    )
                ));
            }
        }
    }
}

#[kani::proof]
fn checked_sequence_increment_never_wraps() {
    let sequence: u64 = kani::any();
    match checked_next_sequence(sequence) {
        Some(next) => {
            assert!(next > sequence);
            assert_eq!(next - sequence, 1);
        }
        None => assert_eq!(sequence, u64::MAX),
    }
}

#[kani::proof]
fn predecessor_is_accepted_only_when_it_matches_trusted_root() {
    let trusted: [u8; 32] = kani::any();
    let claimed: [u8; 32] = kani::any();

    assert_eq!(
        chain_predecessor_matches(&claimed, &trusted),
        claimed == trusted
    );
}

#[kani::proof]
fn proposing_a_chain_extension_does_not_mutate_the_current_head() {
    let state: KelChainState = kani::any();
    let before = state;
    let sequence: u64 = kani::any();
    let previous_hash: [u8; 32] = kani::any();
    let event_hash: [u8; 32] = kani::any();
    let event_kind: KelEventKind = kani::any();

    let result = state.advance(sequence, &previous_hash, &event_hash, event_kind);
    assert_eq!(state, before);

    if let Ok(candidate) = result {
        assert!(transition_allowed(state.last_kind, event_kind));
        assert_eq!(sequence, state.next_sequence);
        assert_eq!(previous_hash, state.head_root);
        assert!(state.next_sequence < u64::MAX);
        assert_eq!(candidate.next_sequence, state.next_sequence + 1);
        assert_eq!(candidate.head_root, event_hash);
        assert_eq!(candidate.last_kind, Some(event_kind));
    }
}

#[kani::proof]
fn chain_extension_rejects_bad_order_link_or_overflow() {
    let state: KelChainState = kani::any();
    let sequence: u64 = kani::any();
    let previous_hash: [u8; 32] = kani::any();
    let event_hash: [u8; 32] = kani::any();
    let event_kind: KelEventKind = kani::any();

    let result = state.advance(sequence, &previous_hash, &event_hash, event_kind);
    if result.is_ok() {
        assert_eq!(sequence, state.next_sequence);
        assert_eq!(previous_hash, state.head_root);
        assert!(transition_allowed(state.last_kind, event_kind));
        assert_ne!(state.next_sequence, u64::MAX);
    } else {
        assert!(
            !transition_allowed(state.last_kind, event_kind)
                || sequence != state.next_sequence
                || previous_hash != state.head_root
                || state.next_sequence == u64::MAX
        );
    }

    if let Err(error) = result {
        assert!(matches!(
            error,
            KelChainError::InvalidTransition
                | KelChainError::SequenceMismatch
                | KelChainError::PreviousRootMismatch
                | KelChainError::SequenceOverflow
        ));
    }
}
