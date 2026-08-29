// SDK
// Designed & Built By onyxpowered.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { blockLogPath } from '../../../Paths.js';

function toLines(chunk) {
  return chunk
    .toString('utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

export function attachBlockLogCapture(child, appName, blockName, options = {}) {
  const { shipHome, now = () => new Date().toISOString(), writeFn = appendFile } = options;
  const logPath = blockLogPath(appName, blockName, shipHome);
  let ready = mkdir(dirname(logPath), { recursive: true });

  function write(stream, line) {
    const entry = { timestamp: now(), stream, line };
    ready = ready.then(() => writeFn(logPath, `${JSON.stringify(entry)}\n`)).catch(() => {});
  }

  child.stdout?.on('data', (chunk) => {
    for (const line of toLines(chunk)) write('stdout', line);
  });
  child.stderr?.on('data', (chunk) => {
    for (const line of toLines(chunk)) write('stderr', line);
  });

  return { logPath };
}

export async function readBlockLogs(appName, blockName, lineCount = 100, options = {}) {
  const { shipHome } = options;
  const logPath = blockLogPath(appName, blockName, shipHome);
  if (!existsSync(logPath)) {
    return [];
  }
  const raw = await readFile(logPath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.length > 0);
  return lines.slice(-lineCount).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
}
