// SDK
// Designed & Built By onyxpowered.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { validateShipConfig } from './ConfigSchema.js';

const CONFIG_FILE_NAME = 'ship.config.js';
const DEFAULT_PRIORITY = 'normal';
const DEFAULT_READY_TIMEOUT_MS = 30000;

export function configFilePath(appRootDir) {
  return join(appRootDir, CONFIG_FILE_NAME);
}

function defaultImport(href) {
  return import(href);
}

let importCallCounter = 0;

export async function loadRawConfig(appRootDir, { importFn = defaultImport } = {}) {
  const filePath = configFilePath(appRootDir);
  let module;
  try {
    // Node's ESM loader caches a module by its exact resolved URL for the life
    // of the process -- a plain import() of the same ship.config.js path on a
    // later deploy would silently return whatever was loaded the FIRST time,
    // ignoring any edits made on disk since. A cache-busting query string
    // forces a fresh read every call; the file's own content is what actually
    // matters here, its URL is otherwise an implementation detail. A monotonic
    // counter (not Date.now()) guarantees a distinct value even for two calls
    // landing in the same millisecond.
    const href = `${pathToFileURL(filePath).href}?t=${++importCallCounter}`;
    module = await importFn(href);
  } catch (error) {
    throw new Error(`failed to load ${filePath}: ${error.message}`);
  }
  if (module.default == null || typeof module.default !== 'object') {
    throw new Error(`${filePath} must have a default export (export default { blocks: { ... } })`);
  }
  return module.default;
}

export function normalizeShipConfig(config) {
  const appPriority = config.priority ?? DEFAULT_PRIORITY;
  const blocks = {};
  for (const [name, block] of Object.entries(config.blocks)) {
    blocks[name] = Object.freeze({
      name,
      command: block.command,
      priority: block.priority ?? appPriority,
      dependsOn: Object.freeze([...(block.dependsOn ?? [])]),
      expose: block.expose ?? false,
      allowance: Object.freeze({ ...(block.allowance ?? {}) }),
      healthCheck: block.healthCheck ? Object.freeze({ ...block.healthCheck }) : null,
      readyTimeoutMs: block.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    });
  }
  return Object.freeze({
    priority: appPriority,
    blocks: Object.freeze(blocks),
  });
}

export async function loadShipConfig(appRootDir, options = {}) {
  const raw = await loadRawConfig(appRootDir, options);
  validateShipConfig(raw);
  const normalized = normalizeShipConfig(raw);
  return Object.freeze({ ...normalized, appRootDir });
}
