// SDK
// Designed & Built By onyxpowered.

import { loadShipConfig } from './Subworks/Loader.js';
import { createBlockStateStore } from './Subworks/State.js';
import { createSupervisor } from './Subworks/Supervisor.js';
import { readBlockLogs } from './Subworks/BlockLogs.js';
import { VERSION } from './Subworks/Version.js';
import { resolveShipHome, blockworksDir } from '../../Paths.js';

export { VERSION };
export { readBlockLogs };

export async function createBlockworks(options = {}) {
  const shipHome = options.shipHome ?? resolveShipHome();
  const stateStore = options.stateStore ?? (await createBlockStateStore(options.blockworksDir ?? blockworksDir(shipHome)));

  const {
    stateStore: _ignoredStateStore,
    shipHome: _ignoredShipHome,
    blockworksDir: _ignoredBlockworksDir,
    ...supervisorOptions
  } = options;

  const supervisor = createSupervisor({
    ...supervisorOptions,
    stateStore,
    shipHome,
  });

  async function deployApp(appName, appRootDir, loaderOptions = {}, extraEnv = {}) {
    const config = await loadShipConfig(appRootDir, loaderOptions);
    await supervisor.registerApp(appName, config, extraEnv);
    return config;
  }

  return Object.freeze({
    deployApp,
    stopApp: supervisor.stopApp,
    stopBlock: supervisor.stopBlock,
    getBlockStatus: supervisor.getBlockStatus,
    getAppStatus: supervisor.getAppStatus,
    startPolling: supervisor.startPolling,
    stopPolling: supervisor.stopPolling,
    runTick: supervisor.runTick,
    async listKnownBlocks() {
      return stateStore.listAllKnownBlocks();
    },
    async readLogs(appName, blockName, lineCount = 100) {
      return readBlockLogs(appName, blockName, lineCount, { shipHome });
    },
  });
}
