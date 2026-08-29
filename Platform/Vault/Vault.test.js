// SDK
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault } from './Vault.js';
import { RESERVED_ROLE } from './Subworks/Interface.js';
import { encrypt, decrypt, generateKey, DEFAULT_SCRYPT_PARAMS } from './Subworks/Crypto.js';

async function withTempShipHome(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ship-vault-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Crypto: scrypt cost parameter is at least 2^17, not the weak 2009 interactive-login default', () => {
  assert.ok(DEFAULT_SCRYPT_PARAMS.N >= 131072);
});

test('Crypto: AES-GCM round trip', () => {
  const key = generateKey();
  const plaintext = Buffer.from('the operator owns the machine');
  const { iv, authTag, ciphertext } = encrypt(key, plaintext);
  const decrypted = decrypt(key, { iv, authTag, ciphertext });
  assert.equal(decrypted.toString('utf8'), 'the operator owns the machine');
});

test('Crypto: tampered ciphertext fails to decrypt', () => {
  const key = generateKey();
  const plaintext = Buffer.from('secret');
  const { iv, authTag, ciphertext } = encrypt(key, plaintext);
  ciphertext[0] ^= 0xff;
  assert.throws(() => decrypt(key, { iv, authTag, ciphertext }));
});

test('Crypto: a tampered auth tag fails to decrypt', () => {
  const key = generateKey();
  const plaintext = Buffer.from('secret');
  const { iv, authTag, ciphertext } = encrypt(key, plaintext);
  authTag[0] ^= 0xff;
  assert.throws(() => decrypt(key, { iv, authTag, ciphertext }));
});

test('Crypto: a tampered IV never silently returns the original plaintext', () => {
  const key = generateKey();
  const plaintext = Buffer.from('secret');
  const { iv, authTag, ciphertext } = encrypt(key, plaintext);
  iv[0] ^= 0xff;
  let decrypted;
  try {
    decrypted = decrypt(key, { iv, authTag, ciphertext });
  } catch {
    decrypted = null;
  }
  assert.notEqual(decrypted?.toString('utf8'), 'secret');
});

test('Vault: write/read round trip for a declared role', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    await vault.interface.declareRole('connector-stripe');
    await vault.interface.write('connector-stripe', 'apiKey', 'sk_live_example');
    const value = await vault.interface.read('connector-stripe', 'apiKey');
    assert.equal(value, 'sk_live_example');
  });
});

test('Vault: values are actually encrypted at rest on disk', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    await vault.interface.declareRole('role-a');
    await vault.interface.write('role-a', 'secret', 'super-secret-value');
    const filePath = join(vault.rootDir, 'roles', 'role-a', 'secret.json');
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(filePath, 'utf8');
    assert.ok(!raw.includes('super-secret-value'));
    const record = JSON.parse(raw);
    assert.ok(record.iv && record.authTag && record.ciphertext);
  });
});

test('Vault: undeclared role cannot be read or written', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    await assert.rejects(() => vault.interface.write('never-declared', 'x', 1));
    await assert.rejects(() => vault.interface.read('never-declared', 'x'));
  });
});

test('Vault: reserved _ship namespace is unreachable via declared-role API', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    await assert.rejects(() => vault.interface.read(RESERVED_ROLE, 'anything'));
    await assert.rejects(() => vault.interface.write(RESERVED_ROLE, 'anything', 1));
    await assert.rejects(() => vault.interface.declareRole(RESERVED_ROLE));
    await assert.rejects(() => vault.interface.wipeRole(RESERVED_ROLE));
  });
});

test('Vault: every case-variant of the reserved role ("_Ship", "_SHIP", "_ShIp") is blocked at the Interface layer, not just the exact-cased form', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    for (const variant of ['_Ship', '_SHIP', '_ShIp']) {
      await assert.rejects(() => vault.interface.read(variant, 'anything'), /_ship namespace/);
      await assert.rejects(() => vault.interface.write(variant, 'anything', 1), /_ship namespace/);
      await assert.rejects(() => vault.interface.declareRole(variant), /_ship is reserved/);
      await assert.rejects(() => vault.interface.wipeRole(variant), /_ship namespace/);
    }
  });
});

test('Vault: reserved namespace round trips via readReserved/writeReserved', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    await vault.interface.writeReserved('daemon/pid', 12345);
    const value = await vault.interface.readReserved('daemon/pid');
    assert.equal(value, 12345);
  });
});

test('Vault: wipeRole removes all data for that role', async () => {
  await withTempShipHome(async (shipHome) => {
    const vault = await createVault({ shipHome });
    await vault.interface.declareRole('temp-role');
    await vault.interface.write('temp-role', 'a', 1);
    await vault.interface.wipeRole('temp-role');
    await assert.rejects(() => vault.interface.read('temp-role', 'a'));
  });
});

test('Vault: a second Vault instance against the same shipHome reuses the persisted key and reads the same value', async () => {
  await withTempShipHome(async (shipHome) => {
    const vaultA = await createVault({ shipHome });
    await vaultA.interface.declareRole('role-a');
    await vaultA.interface.write('role-a', 'secret', 'persisted-across-restart');

    const vaultB = await createVault({ shipHome });
    const value = await vaultB.interface.read('role-a', 'secret');
    assert.equal(value, 'persisted-across-restart');
  });
});

test('Vault: export/import round trip preserves data across a fresh Vault', async () => {
  await withTempShipHome(async (shipHomeA) => {
    await withTempShipHome(async (shipHomeB) => {
      const vaultA = await createVault({ shipHome: shipHomeA });
      await vaultA.interface.declareRole('connector-x');
      await vaultA.interface.write('connector-x', 'token', 'abc123');
      await vaultA.interface.writeReserved('daemon/pid', 999);

      const bundlePath = join(shipHomeA, 'backup.json');
      await vaultA.export('correct horse battery staple', bundlePath);

      const vaultB = await createVault({ shipHome: shipHomeB });
      await vaultB.import('correct horse battery staple', bundlePath);

      const token = await vaultB.interface.read('connector-x', 'token');
      assert.equal(token, 'abc123');
      const pid = await vaultB.interface.readReserved('daemon/pid');
      assert.equal(pid, 999);
    });
  });
});

test('Vault: import fails loud with wrong passphrase', async () => {
  await withTempShipHome(async (shipHomeA) => {
    await withTempShipHome(async (shipHomeB) => {
      const vaultA = await createVault({ shipHome: shipHomeA });
      await vaultA.interface.declareRole('r');
      await vaultA.interface.write('r', 'k', 'v');
      const bundlePath = join(shipHomeA, 'backup.json');
      await vaultA.export('right-passphrase', bundlePath);

      const vaultB = await createVault({ shipHome: shipHomeB });
      await assert.rejects(() => vaultB.import('wrong-passphrase', bundlePath));
    });
  });
});

test('Vault: import fails loud on a corrupt/wrong-version bundle', async () => {
  await withTempShipHome(async (shipHome) => {
    const { writeFile } = await import('node:fs/promises');
    const bundlePath = join(shipHome, 'bad.json');
    await writeFile(bundlePath, JSON.stringify({ formatVersion: 999, kdf: { name: 'scrypt' } }));
    const vault = await createVault({ shipHome });
    await assert.rejects(() => vault.import('anything', bundlePath), /unsupported Vault bundle format version/);
  });
});

test('Vault: import fails loud on a bundle claiming an unsupported KDF name', async () => {
  await withTempShipHome(async (shipHome) => {
    const { writeFile } = await import('node:fs/promises');
    const bundlePath = join(shipHome, 'bad-kdf.json');
    await writeFile(bundlePath, JSON.stringify({ formatVersion: 1, kdf: { name: 'argon2' } }));
    const vault = await createVault({ shipHome });
    await assert.rejects(() => vault.import('anything', bundlePath), /unsupported Vault bundle KDF/);
  });
});

test('Vault: import fails loud on a bundle with the kdf field omitted entirely', async () => {
  await withTempShipHome(async (shipHome) => {
    const { writeFile } = await import('node:fs/promises');
    const bundlePath = join(shipHome, 'missing-kdf.json');
    await writeFile(bundlePath, JSON.stringify({ formatVersion: 1 }));
    const vault = await createVault({ shipHome });
    await assert.rejects(() => vault.import('anything', bundlePath), /unsupported Vault bundle KDF/);
  });
});
