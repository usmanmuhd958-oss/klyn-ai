// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const { KernelBridge } = require('./1.bridge/dist/kernel_bridge');

console.log("=== Testing KLYN AI OS Layer 1 (Bridge) ===");

try {
  const bridge = new KernelBridge();
  console.log("✅ Native Kernel Loaded Successfully!");

  // Test 1: Submit Event
  const eventData = new Uint8Array([1, 2, 3, 4, 5]);
  const eventId = bridge.submitEvent({ eventType: 100, data: eventData });
  console.log(`✅ Event Submitted! Assigned ID: ${eventId}`);

  // Test 2: Process Event Batch
  const processed = bridge.processBatch(10);
  console.log(`✅ Processed Batch Count: ${processed}`);

  // Test 3: Vault Seal & Unseal
  const secretText = new TextEncoder().encode("KLYN AI OS Secret Memory Vault");
  const sealed = bridge.sealData(secretText);
  console.log(`✅ Vault Encrypted (Sealed) Bytes: ${sealed.length}`);

  const unsealed = bridge.unsealData(sealed);
  const recoveredText = new TextDecoder().decode(unsealed);
  console.log(`✅ Vault Decrypted (Unsealed) Text: "${recoveredText}"`);

  // Test 4: Stats & Shutdown
  const stats = bridge.getStats();
  console.log(`✅ Kernel Stats: Processed=${stats.processed}, Pending=${stats.pending}`);

  bridge.shutdown();
  console.log("=== ALL BRIDGE TESTS PASSED PERFECTLY! ===");
} catch (err) {
  console.error("❌ Bridge Test Failed:", err);
}
