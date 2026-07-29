import { KernelBridge } from '../../1.bridge/dist/kernel_bridge';

export interface VFSNode {
  path: string;
  isDir: boolean;
  size: number;
  updatedAt: number;
  content?: Uint8Array;
}

export class VirtualFileSystem {
  private memoryStore: Map<string, VFSNode> = new Map();
  private bridge: KernelBridge;

  constructor(bridge: KernelBridge) {
    this.bridge = bridge;
  }

  public writeFile(path: string, content: Uint8Array, encrypt: boolean = false): void {
    const normalizedPath = this.normalize(path);
    const dataToStore = encrypt ? this.bridge.sealData(content) : content;

    this.memoryStore.set(normalizedPath, {
      path: normalizedPath,
      isDir: false,
      size: content.length,
      updatedAt: Date.now(),
      content: dataToStore,
    });
  }

  public readFile(path: string, isEncrypted: boolean = false): Uint8Array {
    const normalizedPath = this.normalize(path);
    const node = this.memoryStore.get(normalizedPath);

    if (!node || node.isDir || !node.content) {
      throw new Error(`VFS Error: File not found or is a directory at "${path}"`);
    }

    return isEncrypted ? this.bridge.unsealData(node.content) : node.content;
  }

  public exists(path: string): boolean {
    return this.memoryStore.has(this.normalize(path));
  }

  public listFiles(): string[] {
    return Array.from(this.memoryStore.keys());
  }

  private normalize(path: string): string {
    return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  }
}
