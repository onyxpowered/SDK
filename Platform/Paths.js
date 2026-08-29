// SDK
// Designed & Built By onyxpowered.

import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const MAX_SAFE_SOCKET_PATH_LENGTH = 100;

export function resolveShipHome() {
  return process.env.SHIP_HOME ?? join(homedir(), '.ship');
}

export function vaultDir(shipHome = resolveShipHome()) {
  return join(shipHome, 'vault');
}

export function blockworksDir(shipHome = resolveShipHome()) {
  return join(shipHome, 'blockworks');
}

export function logsDir(shipHome = resolveShipHome()) {
  return join(shipHome, 'logs');
}

export function appsDir(shipHome = resolveShipHome()) {
  return join(shipHome, 'apps');
}

export function blockLogPath(appName, blockName, shipHome = resolveShipHome()) {
  return join(logsDir(shipHome), 'blocks', appName, `${blockName}.log`);
}

export function daemonLogPath(shipHome = resolveShipHome()) {
  return join(logsDir(shipHome), 'daemon.log');
}

function shipHomeHash(shipHome) {
  return createHash('sha256').update(shipHome).digest('hex').slice(0, 16);
}

export function socketPath(shipHome = resolveShipHome()) {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\ship-daemon-${shipHomeHash(shipHome)}`;
  }
  const preferred = join(shipHome, 'daemon.sock');
  if (preferred.length <= MAX_SAFE_SOCKET_PATH_LENGTH) {
    return preferred;
  }
  return join(tmpdir(), `ship-${shipHomeHash(shipHome)}.sock`);
}

export function pidFilePath(shipHome = resolveShipHome()) {
  return join(shipHome, 'daemon.pid');
}
