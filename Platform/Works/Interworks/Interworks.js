// SDK
// Designed & Built By onyxpowered.

export const VERSION = '0.1.0';

export { MODES, MODE_NAMES, isValidMode, resolveInterworksTarget, slugifyAppName } from './Subworks/Mode.js';

export {
  validateBlockHandle,
  waitUntilReady,
  createStaticBlockHandle,
  blockOrigin,
} from './Subworks/Block.js';

export {
  getDaemonToken,
  setDaemonToken,
  clearDaemonToken,
  requireDaemonToken,
  hasDaemonToken,
  authorizationHeader,
  resolveServicesUrl,
} from './Subworks/Auth.js';

export {
  computeArtifactIntegrity,
  deployArtifact,
  verifyArtifactIntegrity,
  integrityManifestPath,
} from './Subworks/Artifact.js';

export { getOrCreateCa, rotateCa } from './Subworks/Post/Ca.js';
export { getOrCreateLeafCertificate, DEFAULT_LEAF_HOSTNAMES } from './Subworks/Post/Leaf.js';
export { installCaTrust, uninstallCaTrust, manualTrustInstructions } from './Subworks/Post/Trust.js';
export { startPostServer } from './Subworks/Post/Server.js';

export { createTunnelClient } from './Subworks/Tunnel/Client.js';

export {
  DEFAULT_PREVIEW_DOMAIN,
  SHIP_BASE_PATH_ENV_VAR,
  previewPath,
  previewUrl,
  shipBasePathEnv,
  mergeBlockEnv,
  createPreviewTunnel,
} from './Subworks/Routing/Preview.js';

export { attemptPortForward, manualPortForwardInstructions } from './Subworks/Routing/PortForward.js';

export {
  LETS_ENCRYPT_DIRECTORY_URL,
  issueProductionCertificate,
  bootstrapProductionRouting,
} from './Subworks/Routing/Production.js';

import { MODES } from './Subworks/Mode.js';
import { getOrCreateCa } from './Subworks/Post/Ca.js';
import { getOrCreateLeafCertificate } from './Subworks/Post/Leaf.js';
import { startPostServer } from './Subworks/Post/Server.js';
import { createPreviewTunnel } from './Subworks/Routing/Preview.js';
import { bootstrapProductionRouting } from './Subworks/Routing/Production.js';

export async function startInterworks(target) {
  if (target.mode === MODES.POST) {
    const ca = await getOrCreateCa(target.vault, target.caOptions);
    const leaf = await getOrCreateLeafCertificate(target.vault, ca, target.hostnames, target.leafOptions);
    return startPostServer({ leaf, blockHandle: target.blockHandle, port: target.port, hostname: target.hostname });
  }
  if (target.mode === MODES.PREVIEW) {
    return createPreviewTunnel({
      servicesUrl: target.servicesUrl,
      token: target.token,
      appSlug: target.appSlug,
      blockHandle: target.blockHandle,
      previewDomain: target.previewDomain,
      reconnect: target.reconnect,
    });
  }
  if (target.mode === MODES.PRODUCTION) {
    return bootstrapProductionRouting(target);
  }
  throw new Error(`unknown Interworks mode: ${target.mode}`);
}
