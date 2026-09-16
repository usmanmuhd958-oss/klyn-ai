"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VirtualFileSystem = void 0;
class VirtualFileSystem {
    memoryStore = new Map();
    bridge;
    constructor(bridge) {
        this.bridge = bridge;
    }
    writeFile(path, content, encrypt = false) {
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
    readFile(path, isEncrypted = false) {
        const normalizedPath = this.normalize(path);
        const node = this.memoryStore.get(normalizedPath);
        if (!node || node.isDir || !node.content) {
            throw new Error(`VFS Error: File not found or is a directory at "${path}"`);
        }
        return isEncrypted ? this.bridge.unsealData(node.content) : node.content;
    }
    exists(path) {
        return this.memoryStore.has(this.normalize(path));
    }
    listFiles() {
        return Array.from(this.memoryStore.keys());
    }
    normalize(path) {
        return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    }
}
exports.VirtualFileSystem = VirtualFileSystem;
