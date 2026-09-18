import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { containedPath, validatePathSegment } from '../src/services/safe_path.js';

describe('defensive path validation', () => {
  it('resolves ordinary nested files inside a root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-path-'));
    expect(containedPath(root, 'live', 'pixels', '0_0_0', 'pixel.md'))
      .toBe(path.join(root, 'live', 'pixels', '0_0_0', 'pixel.md'));
  });
  it('requires nonempty ordinary path segments', () => {
    expect(() => validatePathSegment('')).toThrow('Invalid path segment');
    expect(() => validatePathSegment('pixel.md')).not.toThrow();
    expect(() => validatePathSegment('0_0_0')).not.toThrow();
  });
  it('rejects a linked directory even when its target is inside the root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-link-'));
    fs.mkdirSync(path.join(root, 'real'));
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'linked'), 'junction');
    expect(() => containedPath(root, 'linked', 'file.txt')).toThrow('Symbolic links');
  });
});
