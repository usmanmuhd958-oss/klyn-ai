//! Kani proofs for IPC counter distance, slot geometry, and bounded queue traces.

use crate::ipc_ring::{ring_distance, RING_SLOT_COUNT};

const CAPACITY: u32 = RING_SLOT_COUNT as u32;
const SLOT_MASK: usize = RING_SLOT_COUNT - 1;

#[kani::proof]
fn arbitrary_counter_distance_is_classified() {
    let tail: u32 = kani::any();
    let distance: u32 = kani::any();
    let head = tail.wrapping_add(distance);

    if distance <= CAPACITY {
        assert_eq!(ring_distance(head, tail), Some(distance));
    } else {
        assert_eq!(ring_distance(head, tail), None);
    }
}

#[kani::proof]
fn accepted_counter_distances_are_bounded_across_u32_rollover() {
    let tail: u32 = kani::any();
    let used: u32 = kani::any();
    kani::assume(used <= CAPACITY);

    let head = tail.wrapping_add(used);
    assert_eq!(ring_distance(head, tail), Some(used));

    if used < CAPACITY {
        assert_eq!(ring_distance(head.wrapping_add(1), tail), Some(used + 1));
    } else {
        assert_eq!(ring_distance(head, tail), Some(CAPACITY));
    }
}

#[kani::proof]
fn every_sequence_maps_to_an_in_bounds_power_of_two_slot() {
    let sequence: u32 = kani::any();
    let index = (sequence as usize) & SLOT_MASK;

    assert!(index < RING_SLOT_COUNT);
    assert_eq!(index, (sequence % CAPACITY) as usize);
}

/// This is a finite sequential-interleaving model. It proves the queue's
/// capacity and FIFO invariants for every symbolic producer/consumer choice in
/// 16 steps, but does not model actual threads or cross-process data races.
#[kani::proof]
#[kani::unwind(20)]
fn bounded_spsc_trace_preserves_capacity_and_fifo_order() {
    let mut slots = [0_u32; RING_SLOT_COUNT];
    let mut head = 0_u32;
    let mut tail = 0_u32;

    for _ in 0..16 {
        let used = match ring_distance(head, tail) {
            Some(distance) => distance,
            None => {
                assert!(false, "counter distance escaped the ring capacity");
                return;
            }
        };
        let producer_turn: bool = kani::any();

        if producer_turn && used < CAPACITY {
            let slot = (head as usize) & SLOT_MASK;
            slots[slot] = head;
            head = head.wrapping_add(1);
        } else if !producer_turn && used > 0 {
            let slot = (tail as usize) & SLOT_MASK;
            assert_eq!(slots[slot], tail);
            tail = tail.wrapping_add(1);
        }

        match ring_distance(head, tail) {
            Some(distance) => assert!(distance <= CAPACITY),
            None => assert!(false, "ring model violated its head/tail invariant"),
        }
    }
}
