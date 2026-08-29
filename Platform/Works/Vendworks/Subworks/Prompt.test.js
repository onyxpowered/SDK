// Ship
// Designed & Built By onyxpowered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeConfigField, promptForConnectorConfig, defaultAsk, defaultAskSecret } from './Prompt.js';

test('Prompt: describeConfigField treats a plain string as the description', () => {
  assert.deepEqual(describeConfigField('the Stripe secret key'), {
    description: 'the Stripe secret key',
    secret: false,
    default: undefined,
  });
});

test('Prompt: describeConfigField reads description/secret/default off a descriptor object', () => {
  assert.deepEqual(describeConfigField({ description: 'region', secret: false, default: 'us-east-1' }), {
    description: 'region',
    secret: false,
    default: 'us-east-1',
  });
});

test('Prompt: describeConfigField marks secret fields', () => {
  assert.equal(describeConfigField({ description: 'api key', secret: true }).secret, true);
});

test('Prompt: describeConfigField falls back to blank metadata for an undeclared or malformed descriptor', () => {
  assert.deepEqual(describeConfigField(undefined), { description: '', secret: false, default: undefined });
  assert.deepEqual(describeConfigField(42), { description: '', secret: false, default: undefined });
});

test('Prompt: promptForConnectorConfig asks once per key, in order, and collects the answers', async () => {
  const questions = [];
  const connector = {
    configSchema: {
      apiKey: { description: 'API key', secret: true },
      region: { description: 'region', default: 'us-east-1' },
    },
  };
  const ask = async (question) => {
    questions.push(['ask', question]);
    return '';
  };
  const askSecret = async (question) => {
    questions.push(['askSecret', question]);
    return 'sk_live_123';
  };
  const values = await promptForConnectorConfig({
    connector,
    keys: ['apiKey', 'region'],
    ask,
    askSecret,
  });
  assert.deepEqual(values, { apiKey: 'sk_live_123', region: 'us-east-1' });
  assert.deepEqual(questions, [
    ['askSecret', 'apiKey (API key): '],
    ['ask', 'region (region) [us-east-1]: '],
  ]);
});

test('Prompt: promptForConnectorConfig routes non-secret fields through ask, never askSecret', async () => {
  let askSecretCalls = 0;
  const values = await promptForConnectorConfig({
    connector: { configSchema: { name: 'display name' } },
    keys: ['name'],
    ask: async () => 'onyx',
    askSecret: async () => {
      askSecretCalls += 1;
      return 'never';
    },
  });
  assert.equal(values.name, 'onyx');
  assert.equal(askSecretCalls, 0);
});

test('Prompt: promptForConnectorConfig trims whitespace from a typed answer', async () => {
  const values = await promptForConnectorConfig({
    connector: { configSchema: { token: 'token' } },
    keys: ['token'],
    ask: async () => '  spaced-out-token  \n',
  });
  assert.equal(values.token, 'spaced-out-token');
});

test('Prompt: promptForConnectorConfig requires an array of keys', async () => {
  await assert.rejects(
    promptForConnectorConfig({ connector: {}, keys: undefined, ask: async () => '' }),
    /requires an array of keys/,
  );
});

test('Prompt: defaultAsk and defaultAskSecret are exported as real callables for CLI wiring', () => {
  assert.equal(typeof defaultAsk, 'function');
  assert.equal(typeof defaultAskSecret, 'function');
});
