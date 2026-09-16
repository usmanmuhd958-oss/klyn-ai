import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const nativeBinding = require(path.join(__dirname, 'klyn_kernel_core.linux-arm64-gnu.node'));

export const { kernelInit, processEvent, benchmarkKernel, KernelHandle } = nativeBinding;
