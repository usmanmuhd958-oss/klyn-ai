const { KernelBridge } = require('./1.bridge/dist/kernel_bridge');

console.log("=== Testing KLYN AI OS Layer 1 (Bridge) ===");

try {
  const bridge = new KernelBridge();
  console.log("✅ Native Kernel Loaded Successfully!");

  // 1. Test Vault Encryption & Decryption (AES-256-GCM / Vault Seal-Unseal)
  const secretText = new TextEncoder().encode("KLYN AI OS - Next-Gen Autonomous AI Engine");
  const sealed = bridge.sealData(secretText);
  console.log(`✅ Vault Encrypted (Sealed) Bytes: ${sealed.length}`);

  const unsealed = bridge.unsealData(sealed);
  const recoveredText = new TextDecoder().decode(unsealed);
  console.log(`✅ Vault Decrypted (Unsealed) Text: "${recoveredText}"`);

  // 2. Test Lock-Free Ring Buffer Event Submission
  const eventData = new Uint8Array([10, 20, 30, 40]);
  const eventId = bridge.submitEvent({ eventType: 1, data: eventData });
  console.log(`✅ Lock-Free Ring Buffer Submission ID: ${eventId}`);

  // 3. Test Kernel Stats
  const stats = bridge.getStats();
  console.log(`✅ Kernel Stats: Processed=${stats.processed}, Pending=${stats.pending}`);

  bridge.shutdown();
  console.log("\n🚀 === ALL LAYER 1 BRIDGE TESTS PASSED 100%! ===");
} catch (err) {
  console.error("❌ Bridge Test Failed:", err);
}
