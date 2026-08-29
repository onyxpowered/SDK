// SDK
// Designed & Built By onyxpowered.

import { boot } from '../../../Platform.js';

const shipHome = process.env.SHIP_HOME;
const works = [
  { name: 'Vault', modulePath: '../Vault/Vault.js' },
  { name: 'Systemworks', modulePath: './Systemworks/Systemworks.js' },
];

await boot({ shipHome, works, requiredVersions: { Vault: '0.1.0' } });
process.stdout.write('daemon-harness-ready\n');
