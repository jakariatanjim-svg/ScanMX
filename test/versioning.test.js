import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helperPath = fileURLToPath(new URL('../scripts/resolve-version.mjs', import.meta.url));

function makeTaggedRepo(tags = []) {
  const cwd = mkdtempSync(join(tmpdir(), 'scanmx-version-test-'));
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'user.name', 'ScanMX test'], { cwd });
  execFileSync('git', ['config', 'user.email', 'scanmx-test@example.invalid'], { cwd });
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'version test fixture'], { cwd });
  for (const tag of tags) execFileSync('git', ['tag', tag], { cwd });
  return cwd;
}

function runVersion(cwd, override = '') {
  return spawnSync(process.execPath, [helperPath], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, VERSION_OVERRIDE: override },
  });
}

function resolveVersion(cwd, override = '') {
  const result = runVersion(cwd, override);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('first version is v1.0 and invalid tags do not advance it', (t) => {
  const cwd = makeTaggedRepo(['scanmx-2026-10-12-10-09-31-1', 'v1.10', 'not-a-version']);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.match(resolveVersion(cwd), /version=1\.0\ntag=v1\.0/);
});

test('version tags are compared numerically and minor versions roll over at nine', (t) => {
  const cwd = makeTaggedRepo(['v1.9', 'v1.10', 'v2.8']);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.match(resolveVersion(cwd), /version=2\.9\ntag=v2\.9/);
  execFileSync('git', ['tag', 'v2.9'], { cwd });
  assert.match(resolveVersion(cwd), /version=3\.0\ntag=v3\.0/);
});

test('a major-only override normalizes to minor zero', (t) => {
  const cwd = makeTaggedRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.match(resolveVersion(cwd, '3'), /version=3\.0\ntag=v3\.0/);
});

test('a lower override warns and malformed overrides fail', (t) => {
  const cwd = makeTaggedRepo(['v2.2']);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const lower = runVersion(cwd, '1.4');
  assert.equal(lower.status, 0, lower.stderr);
  assert.match(lower.stdout, /version=1\.4\ntag=v1\.4/);
  assert.match(lower.stdout, /::warning::/);
  const invalid = runVersion(cwd, '1.10');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout, /::error::Invalid version override/);
});
