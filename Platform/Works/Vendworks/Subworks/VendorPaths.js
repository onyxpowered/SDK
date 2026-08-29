// SDK
// Designed & Built By onyxpowered.

import { join } from 'node:path';
import { resolveShipHome } from '../../../Paths.js';

export function vendorsRootDir(shipHome = resolveShipHome()) {
  return join(shipHome, 'vendors');
}

export function connectorVendorDir(publisher, connector, shipHome = resolveShipHome()) {
  return join(vendorsRootDir(shipHome), publisher, connector);
}

export const CONNECTOR_METADATA_FILE = '.ship-connector.json';

export function connectorMetadataPath(publisher, connector, shipHome = resolveShipHome()) {
  return join(connectorVendorDir(publisher, connector, shipHome), CONNECTOR_METADATA_FILE);
}
