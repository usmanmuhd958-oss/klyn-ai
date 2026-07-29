use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId, Throughput};
use klyn_kernel::{Bus, KernelCore, KernelEvent, LawVm, OpCode, Vault};
use std::sync::Arc;

fn bench_bus_single_thread(c: &mut Criterion) {
    let mut group = c.benchmark_group("bus_single_thread");
    
    group.bench_function("send_recv", |b| {
        let bus = Bus::<u64>::new();
        b.iter(|| {
            bus.try_send(black_box(42)).unwrap();
            black_box(bus.try_recv().unwrap());
        });
    });

    group.finish();
}

fn bench_law_vm(c: &mut Criterion) {
    let mut group = c.benchmark_group("law_vm");

    fn encode_push(value: u64) -> Vec<u8> {
        let mut bytes = vec![OpCode::Push as u8];
        bytes.extend_from_slice(&value.to_le_bytes());
        bytes
    }

    group.bench_function("simple_arithmetic", |b| {
        let mut vm = LawVm::new();
        let mut program = Vec::new();
        program.extend(encode_push(10));
        program.extend(encode_push(20));
        program.push(OpCode::Add as u8);
        program.push(OpCode::Halt as u8);
        
        vm.load_program(&program).unwrap();

        b.iter(|| {
            vm.reset();
            black_box(vm.execute(1000).unwrap());
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_bus_single_thread,
    bench_law_vm
);

criterion_main!(benches);
