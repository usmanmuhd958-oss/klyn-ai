import { describe, it, expect } from 'vitest';
import { LanguageDetector } from '../../src/parser/language_detector.js';

describe('LanguageDetector.detect', () => {
  it.each([
    ['kernel.ts', 'typescript'],
    ['view.tsx', 'typescript'],
    ['server.js', 'javascript'],
    ['app.jsx', 'javascript'],
    ['loader.mjs', 'javascript'],
    ['legacy.cjs', 'javascript'],
    ['train.py', 'python'],
    ['main.go', 'go'],
    ['vault.rs', 'rust'],
    ['Main.java', 'java'],
    ['core.c', 'c'],
    ['core.h', 'c'],
    ['engine.cpp', 'cpp'],
    ['engine.hpp', 'cpp'],
    ['package.json', 'json'],
    ['README.md', 'markdown'],
    ['ci.yaml', 'yaml'],
    ['ci.yml', 'yaml'],
    ['Cargo.toml', 'toml'],
    ['boot.sh', 'shell'],
    ['boot.bash', 'shell'],
  ])('maps %s to %s', (filename, language) => {
    expect(LanguageDetector.detect(filename)).toBe(language);
  });

  it('is case insensitive on the extension', () => {
    expect(LanguageDetector.detect('Kernel.TS')).toBe('typescript');
  });

  it('uses the last extension of a multi-part filename', () => {
    expect(LanguageDetector.detect('bundle.min.js')).toBe('javascript');
  });

  it('resolves extensions on nested paths', () => {
    expect(LanguageDetector.detect('src/core/hash.ts')).toBe('typescript');
  });

  it('returns undefined for unknown extensions', () => {
    expect(LanguageDetector.detect('archive.tar')).toBeUndefined();
  });

  it('returns undefined for files without an extension', () => {
    expect(LanguageDetector.detect('Makefile')).toBeUndefined();
  });

  it('returns undefined for an empty filename', () => {
    expect(LanguageDetector.detect('')).toBeUndefined();
  });
});

describe('LanguageDetector.isSupported', () => {
  it('is true for a known extension', () => {
    expect(LanguageDetector.isSupported('index.ts')).toBe(true);
  });

  it('is false for an unknown extension', () => {
    expect(LanguageDetector.isSupported('image.png')).toBe(false);
  });
});
