import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../../utils/logger.js';

describe('Logger', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('prefixes info messages with the scope and no colour codes', () => {
    new Logger('kernel').info('booted');
    expect(log).toHaveBeenCalledWith('[kernel] booted');
  });

  it.each([
    ['success', '\x1b[32m'],
    ['warn', '\x1b[33m'],
    ['error', '\x1b[31m'],
  ] as const)('wraps %s messages in its colour code', (method, colour) => {
    new Logger('kernel')[method]('msg');
    expect(log).toHaveBeenCalledWith(`${colour}[kernel] msg\x1b[0m`);
  });

  it('keeps each instance scope independent', () => {
    new Logger('a').info('x');
    new Logger('b').info('y');

    expect(log).toHaveBeenNthCalledWith(1, '[a] x');
    expect(log).toHaveBeenNthCalledWith(2, '[b] y');
  });

  it('pads metric labels to a fixed width and appends the unit', () => {
    new Logger('kernel').metric('latency', 12, 'ms');
    expect(log).toHaveBeenCalledWith(`  ${'latency'.padEnd(22)}: \x1b[33m12 ms\x1b[0m`);
  });

  it('omits the unit when not provided', () => {
    new Logger('kernel').metric('files', 'many');
    expect(log).toHaveBeenCalledWith(`  ${'files'.padEnd(22)}: \x1b[33mmany \x1b[0m`);
  });
});
