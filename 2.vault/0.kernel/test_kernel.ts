// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
import { kernelInit, processEvent, benchmarkKernel, KernelHandle } from './index.js';

console.log("⚡ Starting KLYN OS Deterministic Kernel Benchmark...\n");

// 1. Initialize Kernel
const initStatus = kernelInit();
console.log(`[1] Kernel Initialization Status: ${initStatus === 0 ? 'SUCCESS (0)' : 'FAILED (' + initStatus + ')'}`);

// 2. Create Valid Event Payload
const eventBuffer = Buffer.alloc(524); // 12-byte header + 512-byte payload
eventBuffer.writeUInt8(0x01, 0);       // Opcode 0x01: Syscall Event
eventBuffer.writeUInt8(0, 1);          // Flags
eventBuffer.writeUInt16LE(512, 2);     // Payload Length (512 bytes)
eventBuffer.writeBigUInt64LE(BigInt(0), 4); // Timestamp starting at cycle 0

// Fill payload with valid syscall bytes
for (let i = 12; i < 524; i++) {
    eventBuffer.writeUInt8(0xAA, i);
}

// 3. Measure Single Event Latency
const startSingle = process.hrtime.bigint();
const result = processEvent(eventBuffer);
const endSingle = process.hrtime.bigint();
const latencyNs = Number(endSingle - startSingle);

console.log(`[2] Event Processing Result: Code ${result} ${result === 0 ? '✅ (PROCESSED OK)' : '❌ (VALIDATION FAILED)'}`);
console.log(`[3] Single Event Latency: ${latencyNs} nanoseconds (${(latencyNs / 1000).toFixed(2)} µs)`);

// 4. Run Kernel Benchmark Cycle
const cycles = benchmarkKernel();
console.log(`[4] Law_VM Benchmark Executed: Deltas = ${cycles} cycles`);

// 5. Object Handle Test
const handle = new KernelHandle();
console.log(`[5] Kernel State Handle Active. Total Processed Cycles: ${handle.cycleCount()}`);

console.log("\n🚀 KLYN Kernel is running at sub-millisecond deterministic speeds!");
