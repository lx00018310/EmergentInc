import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readGenome } from '../src/life_workspace.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function project(version: 1 | 2) {
  const root = fs.mkdtempSync(join(tmpdir(), 'gene-hash-')); roots.push(root);
  fs.mkdirSync(join(root, 'genome')); fs.mkdirSync(join(root, 'app/tests'), { recursive: true });
  const manifest = { schema_version: 1, gene_hash_version: version, generation: 1,
    body_interface_version: '1', protected_paths: ['genome/**', 'app/**'], capability_contracts: { network: false } };
  fs.writeFileSync(join(root, 'genome/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(join(root, 'app/main.ts'), 'export const value = 1;\n');
  fs.writeFileSync(join(root, 'app/README.md'), 'description\n');
  fs.writeFileSync(join(root, 'app/tests/main.test.ts'), 'test\n');
  return { root, manifest, hash: () => readGenome(root).geneHash };
}
describe('versioned Gene identity', () => {
  it('retains the original byte hash for old manifests, including those without a version field', () => {
    const f = project(1), manifest = { ...f.manifest } as Record<string, unknown>;
    delete manifest.gene_hash_version;
    fs.writeFileSync(join(f.root, 'genome/manifest.json'), JSON.stringify(manifest));
    const raw = createHash('sha256');
    for (const file of ['app/README.md', 'app/main.ts', 'app/tests/main.test.ts', 'genome/manifest.json'])
      raw.update(file).update('\0').update(fs.readFileSync(join(f.root, file))).update('\0');
    expect(f.hash()).toBe(raw.digest('hex'));
    const before = f.hash(); fs.writeFileSync(join(f.root, 'app/main.ts'), 'export const value = 1;\r\n');
    expect(f.hash()).not.toBe(before);
  });
  it('normalizes checkout line endings and manifest formatting, without treating display generation as a Gene change', () => {
    const f = project(2), before = f.hash();
    fs.writeFileSync(join(f.root, 'app/main.ts'), 'export const value = 1;\r\n');
    fs.writeFileSync(join(f.root, 'genome/manifest.json'), JSON.stringify({ ...f.manifest, generation: 7 }));
    expect(f.hash()).toBe(before);
  });
  it('excludes README and test-only changes but retains runtime code, prompts and capability contracts', () => {
    const f = project(2), before = f.hash();
    fs.writeFileSync(join(f.root, 'app/README.md'), 'updated');
    fs.writeFileSync(join(f.root, 'app/tests/main.test.ts'), 'updated');
    fs.writeFileSync(join(f.root, 'app/main.spec.ts'), 'new test');
    expect(f.hash()).toBe(before);
    fs.writeFileSync(join(f.root, 'app/prompt.md'), 'Runtime instructions');
    const prompt = f.hash(); expect(prompt).not.toBe(before);
    fs.writeFileSync(join(f.root, 'app/main.ts'), 'export const value = 2;\n');
    expect(f.hash()).not.toBe(prompt);
    const code = f.hash();
    fs.writeFileSync(join(f.root, 'genome/manifest.json'), JSON.stringify({ ...f.manifest, capability_contracts: { network: true } }));
    expect(f.hash()).not.toBe(code);
  });
  it('preserves binary and invalid UTF-8 byte differences and rejects unknown hash versions', () => {
    const f = project(2);
    fs.writeFileSync(join(f.root, 'app/asset.bin'), Buffer.from([13, 10])); const binary = f.hash();
    fs.writeFileSync(join(f.root, 'app/asset.bin'), Buffer.from([10])); expect(f.hash()).not.toBe(binary);
    fs.writeFileSync(join(f.root, 'app/opaque.txt'), Buffer.from([255, 13, 10])); const opaque = f.hash();
    fs.writeFileSync(join(f.root, 'app/opaque.txt'), Buffer.from([255, 10])); expect(f.hash()).not.toBe(opaque);
    fs.writeFileSync(join(f.root, 'genome/manifest.json'), JSON.stringify({ ...f.manifest, gene_hash_version: 3 }));
    expect(f.hash).toThrow('INVALID_GENOME_MANIFEST');
  });
});
