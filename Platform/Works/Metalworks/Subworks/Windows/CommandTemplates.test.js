// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProcessSampleScript,
  buildTreeSnapshotScript,
  parseProcessSampleOutput,
  parseTreeSnapshotOutput,
  looksLikePolicyBlock,
  PROBE_SCRIPT,
  UTF8_INIT_SCRIPT,
} from './CommandTemplates.js';

test('CommandTemplates: buildProcessSampleScript joins the pid list and always selects exact fields + ConvertTo-Json -Compress, never table output', () => {
  const script = buildProcessSampleScript([100, 200, 300]);
  assert.equal(
    script,
    'Get-Process -Id 100,200,300 -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64,StartTime | ConvertTo-Json -Compress',
  );
});

test('CommandTemplates: buildProcessSampleScript is a static template -- only the pid list varies between calls', () => {
  const a = buildProcessSampleScript([1]);
  const b = buildProcessSampleScript([2]);
  const withoutIds = (s) => s.replace(/-Id [\d,]+/, '-Id X');
  assert.equal(withoutIds(a), withoutIds(b));
});

test('CommandTemplates: buildTreeSnapshotScript selects the exact ProcessId/ParentProcessId fields via Select-Object + ConvertTo-Json -Compress', () => {
  assert.equal(
    buildTreeSnapshotScript(),
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress',
  );
});

test('CommandTemplates: parseProcessSampleOutput handles the single-object JSON shape ConvertTo-Json emits for exactly one result', () => {
  const raw = '{"Id":100,"CPU":12.5,"WorkingSet64":204800,"StartTime":"2026-08-18T10:00:00Z"}';
  const result = parseProcessSampleOutput(raw, [100]);
  const sample = result.get(100);
  assert.equal(sample.cpuTimeMs, 12500);
  assert.equal(sample.rssBytes, 204800);
  assert.equal(sample.alive, true);
  assert.equal(sample.fingerprint, '2026-08-18T10:00:00Z');
});

test('CommandTemplates: parseProcessSampleOutput handles the array JSON shape ConvertTo-Json emits for two or more results', () => {
  const raw = '[{"Id":100,"CPU":1,"WorkingSet64":100,"StartTime":"a"},{"Id":200,"CPU":2,"WorkingSet64":200,"StartTime":"b"}]';
  const result = parseProcessSampleOutput(raw, [100, 200]);
  assert.equal(result.get(100).cpuTimeMs, 1000);
  assert.equal(result.get(200).cpuTimeMs, 2000);
});

test('CommandTemplates: parseProcessSampleOutput synthesizes a confirmed-exit entry for a requested pid missing from the output', () => {
  const raw = '{"Id":100,"CPU":1,"WorkingSet64":100,"StartTime":"a"}';
  const result = parseProcessSampleOutput(raw, [100, 999]);
  assert.equal(result.get(999).alive, false);
  assert.equal(result.get(999).rssBytes, null);
});

test('CommandTemplates: parseProcessSampleOutput treats empty output as every requested pid having exited', () => {
  const result = parseProcessSampleOutput('', [100, 200]);
  assert.equal(result.get(100).alive, false);
  assert.equal(result.get(200).alive, false);
});

test('CommandTemplates: parseProcessSampleOutput treats malformed JSON as empty rather than throwing', () => {
  const result = parseProcessSampleOutput('not json at all {{{', [100]);
  assert.equal(result.get(100).alive, false);
});

test('CommandTemplates: parseProcessSampleOutput stringifies a non-primitive StartTime (older .NET JSON date shape) into a stable fingerprint token', () => {
  const raw = '{"Id":100,"CPU":0,"WorkingSet64":0,"StartTime":{"DateTime":"/Date(1234567890000)/"}}';
  const result = parseProcessSampleOutput(raw, [100]);
  assert.equal(result.get(100).fingerprint, JSON.stringify({ DateTime: '/Date(1234567890000)/' }));
});

test('CommandTemplates: parseProcessSampleOutput defaults a missing/null CPU to zero rather than NaN (freshly-started process)', () => {
  const raw = '{"Id":100,"CPU":null,"WorkingSet64":1000,"StartTime":"a"}';
  const result = parseProcessSampleOutput(raw, [100]);
  assert.equal(result.get(100).cpuTimeMs, 0);
});

test('CommandTemplates: parseTreeSnapshotOutput builds a pid->ppid map from the array shape', () => {
  const raw = '[{"ProcessId":1,"ParentProcessId":0},{"ProcessId":500,"ParentProcessId":1}]';
  const map = parseTreeSnapshotOutput(raw);
  assert.equal(map.get(500), 1);
  assert.equal(map.get(1), 0);
});

test('CommandTemplates: parseTreeSnapshotOutput builds a pid->ppid map from the single-object shape', () => {
  const raw = '{"ProcessId":1,"ParentProcessId":0}';
  const map = parseTreeSnapshotOutput(raw);
  assert.equal(map.get(1), 0);
});

test('CommandTemplates: parseTreeSnapshotOutput is resilient to malformed output', () => {
  const map = parseTreeSnapshotOutput('garbage');
  assert.equal(map.size, 0);
});

test('CommandTemplates: looksLikePolicyBlock recognizes common AppLocker/execution-policy denial phrasing, case-insensitively', () => {
  assert.equal(looksLikePolicyBlock('File cannot be loaded because running scripts is disabled on this system.'), true);
  assert.equal(looksLikePolicyBlock('THE EXECUTION OF SCRIPTS IS DISABLED ON THIS SYSTEM'), true);
  assert.equal(looksLikePolicyBlock('This script is blocked by Group Policy.'), true);
});

test('CommandTemplates: looksLikePolicyBlock returns false for ordinary output', () => {
  assert.equal(looksLikePolicyBlock('ship-metalworks-probe-ok'), false);
  assert.equal(looksLikePolicyBlock(''), false);
  assert.equal(looksLikePolicyBlock(null), false);
});

test('CommandTemplates: PROBE_SCRIPT is a trivial echo with no side effects on real system state', () => {
  assert.match(PROBE_SCRIPT, /^Write-Output/);
  assert.doesNotMatch(PROBE_SCRIPT, /Get-Process|Get-CimInstance|Remove-|Set-|New-/);
});

test('CommandTemplates: UTF8_INIT_SCRIPT sets console input/output encoding to UTF8', () => {
  assert.match(UTF8_INIT_SCRIPT, /UTF8/);
});
