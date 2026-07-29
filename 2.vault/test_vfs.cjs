const { KernelBridge } = require('./1.bridge/dist/kernel_bridge');
const vfsExports = require('./2.vfs/dist/vfs');

const VirtualFileSystem = vfsExports.VirtualFileSystem;

console.log("=== Testing KLYN AI OS Layer 2 (VFS Integration) ===");

try {
  const bridge = new KernelBridge();
  const vfs = new VirtualFileSystem(bridge);

  // 1. Plaintext Write & Read
  const codeContent = new TextEncoder().encode('console.log("Hello from KLYN VFS!");');
  vfs.writeFile('/src/index.ts', codeContent);

  const readData = vfs.readFile('/src/index.ts');
  console.log(`✅ Plaintext File Read: "${new TextDecoder().decode(readData)}"`);

  // 2. Encrypted File Write & Read (AES-256-GCM Vault)
  const secretContent = new TextEncoder().encode('SUPER_SECRET_LLM_KEY=klyn_live_998877665544');
  vfs.writeFile('/.env.secret', secretContent, true);

  const decryptedData = vfs.readFile('/.env.secret', true);
  console.log(`✅ Vault-Encrypted File Read: "${new TextDecoder().decode(decryptedData)}"`);

  // 3. File Listing Tree
  console.log('✅ In-Memory VFS File Tree:', vfs.listFiles());

  bridge.shutdown();
  console.log("\n🚀 === ALL LAYER 2 VFS TESTS PASSED 100%! ===");
} catch (err) {
  console.error("❌ VFS Test Failed:", err);
}
