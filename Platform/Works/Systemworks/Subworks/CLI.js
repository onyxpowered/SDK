#!/usr/bin/env node
// SDK
// Designed & Built By onyxpowered.

import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sendIpcRequest } from './IPC.js';
import { installService, uninstallService } from './ServiceRegistration.js';
import { VERSION } from './Version.js';
import { readLogs } from '../Systemworks.js';
import { createVault } from '../../../Vault/Vault.js';
import { setDaemonToken, resolveServicesUrl } from '../../Interworks/Interworks.js';
import { createVendworks, createRegistryClient } from '../../Vendworks/Vendworks.js';
import { readBlockLogs } from '../../Blockworks/Subworks/BlockLogs.js';
import { scaffoldNewApp } from './Scaffold.js';
import { importSource } from './Import.js';
import { boot } from '../../../Platform.js';
import { resolveShipHome, socketPath, daemonLogPath, appsDir } from '../../../Paths.js';
import { field, formatResult, printSuccess, printSystem, printError } from './Output.js';

const CHAR_CODE_CTRL_C = 3;
const CHAR_CODE_BACKSPACE = 127;

async function readLineNoMask(promptText) {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(field(promptText));
  rl.close();
  return answer;
}

function readLineMasked(promptText) {
  return new Promise((promiseResolve, promiseReject) => {
    process.stdout.write(field(promptText));
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw ?? false;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      if (!wasRaw) stdin.pause();
      process.stdout.write('\n');
    }

    function onData(char) {
      const code = char.charCodeAt(0);
      if (code === CHAR_CODE_CTRL_C) {
        cleanup();
        promiseReject(new Error('passphrase entry cancelled'));
        return;
      }
      if (char === '\r' || char === '\n') {
        cleanup();
        promiseResolve(value);
        return;
      }
      if (code === CHAR_CODE_BACKSPACE || char === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    }

    stdin.on('data', onData);
  });
}

async function defaultPromptPassphrase(promptText) {
  if (!process.stdin.isTTY) {
    return readLineNoMask(promptText);
  }
  return readLineMasked(promptText);
}

async function promptSequence(labels) {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const answers = [];
  let labelIndex = 0;
  return new Promise((promiseResolve) => {
    function askNext() {
      if (labelIndex >= labels.length) {
        rl.close();
        promiseResolve(answers);
        return;
      }
      process.stdout.write(field(labels[labelIndex]));
      labelIndex += 1;
    }
    rl.on('line', (line) => {
      answers.push(line);
      askNext();
    });
    askNext();
  });
}

async function defaultPromptCredentials() {
  if (!process.stdin.isTTY) {
    // readline/promises' question() can drop the 'line' event for a second
    // sequential prompt when stdin is a pipe with all its data already
    // buffered -- the event fires before the second question() call attaches
    // its listener. A single persistent 'line' listener avoids the race.
    const [email, password] = await promptSequence(['email', 'password']);
    return { email, password };
  }
  const email = await readLineNoMask('email');
  const password = await readLineMasked('password');
  return { email, password };
}

function parseFlags(args) {
  const positionals = [];
  const flags = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) {
        flags[arg.slice(2)] = true;
      } else {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function parseAppBlockTarget(raw) {
  if (!raw) {
    throw new Error('usage: sdk stop <app> or sdk stop <app>:<block>');
  }
  const [appName, blockName] = raw.split(':');
  return { appName, blockName: blockName || undefined };
}

function resolveDeployArgs(args) {
  const { positionals, flags } = parseFlags(args);
  const appRootDir = resolve(positionals[0] ?? process.cwd());
  const appName = flags.name ?? basename(appRootDir);
  const port = flags.port !== undefined ? Number(flags.port) : undefined;
  const hostname = typeof flags.hostname === 'string' ? flags.hostname : undefined;
  return { appName, appRootDir, port, hostname };
}

// A deploy can genuinely take a while: Block spawn + health check (up to the
// Block's own readyTimeoutMs, 30s by default, if it's just slow to become
// healthy rather than crashing outright), then for Preview mode a real
// network round trip to Services on top of that (DNS + TLS + WebSocket
// handshake, plus its own internal ~10s wait for helloAck). The IPC layer's
// default 5s timeout is tuned for instant calls like ping/version/stop and is
// too short here -- give this one real headroom instead of failing loud on
// what's actually still in progress.
const DEPLOY_IPC_TIMEOUT_MS = 60000;

async function deployViaIpc(args, ctx, mode) {
  const { appName, appRootDir, port, hostname } = resolveDeployArgs(args);
  return sendIpcRequest(ctx.socketPath, { type: 'deploy', appName, appRootDir, mode, port, hostname }, DEPLOY_IPC_TIMEOUT_MS);
}

function createConnectorVendworks(ctx) {
  return createVault({ shipHome: ctx.shipHome }).then((vault) =>
    createVendworks({ vault, registryClient: createRegistryClient(), shipHome: ctx.shipHome }),
  );
}

const COMMAND_TABLE = {
  version: async (args, ctx) => {
    try {
      const result = await sendIpcRequest(ctx.socketPath, { type: 'version' });
      return { source: 'daemon', ...result };
    } catch {
      return { source: 'cli', version: ctx.version ?? VERSION };
    }
  },

  'daemon install': async (args, ctx) => {
    return installService({
      nodePath: ctx.nodePath,
      scriptPath: ctx.scriptPath,
      logPath: ctx.logPath,
      shipHome: ctx.shipHome,
    });
  },

  'daemon uninstall': async () => {
    return uninstallService();
  },

  'daemon stop': async (args, ctx) => {
    return sendIpcRequest(ctx.socketPath, { type: 'shutdown' });
  },

  'daemon status': async (args, ctx) => {
    try {
      const result = await sendIpcRequest(ctx.socketPath, { type: 'ping' });
      return { running: true, ...result };
    } catch {
      return { running: false };
    }
  },

  logs: async (args, ctx) => {
    const [first, second] = args;
    if (first !== undefined && Number.isNaN(Number(first))) {
      const { appName, blockName } = parseAppBlockTarget(first);
      const lineCount = Number(second) || 100;
      const entries = await readBlockLogs(appName, blockName ?? 'web', lineCount, { shipHome: ctx.shipHome });
      return { appName, blockName: blockName ?? 'web', entries };
    }
    const lineCount = Number(first) || 100;
    return readLogs(ctx.shipHome, lineCount);
  },

  'vault export': async (args, ctx) => {
    const [destPath = join(ctx.shipHome, `sdk-vault-backup-${Date.now()}.json`)] = args;
    const promptPassphrase = ctx.promptPassphrase ?? defaultPromptPassphrase;
    const passphrase = await promptPassphrase('Vault export passphrase');
    const vault = await createVault({ shipHome: ctx.shipHome });
    const path = await vault.export(passphrase, destPath);
    return { exported: path };
  },

  'vault import': async (args, ctx) => {
    const [bundlePath] = args;
    if (!bundlePath) {
      throw new Error('usage: sdk vault import <bundlePath>');
    }
    const promptPassphrase = ctx.promptPassphrase ?? defaultPromptPassphrase;
    const passphrase = await promptPassphrase('Vault import passphrase');
    const vault = await createVault({ shipHome: ctx.shipHome });
    await vault.import(passphrase, bundlePath);
    return { imported: bundlePath };
  },

  login: async (args, ctx) => {
    const { flags } = parseFlags(args);
    const promptCredentials = ctx.promptCredentials ?? defaultPromptCredentials;
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const { email, password } = await promptCredentials();
    const servicesUrl = resolveServicesUrl();
    const endpoint = flags.signup ? 'signup' : 'login';
    const response = await fetchImpl(`${servicesUrl}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? `${endpoint} failed with status ${response.status}`);
    }
    const vault = await createVault({ shipHome: ctx.shipHome });
    await setDaemonToken(vault, body.token, { accountId: body.accountId });
    return { accountId: body.accountId, email: body.email, loggedIn: true };
  },

  new: async (args, ctx) => {
    const { positionals } = parseFlags(args);
    const [appName] = positionals;
    if (!appName) {
      throw new Error('usage: sdk new <appName>');
    }
    // Scaffolds at the filesystem root (~/<appName>), never at cwd -- running
    // `sdk new` from inside a repo you happen to be working in (Ship's own,
    // or any other) should never drop a starter project into it.
    const destinationDir = resolve(homedir(), appName);
    return scaffoldNewApp(appName, destinationDir);
  },

  import: async (args, ctx) => {
    const { positionals, flags } = parseFlags(args);
    const [source] = positionals;
    return importSource(source, {
      appsDir: appsDir(ctx.shipHome),
      subPath: flags.path,
      from: flags.from,
      appName: flags.name,
    });
  },

  deploy: async (args, ctx) => deployViaIpc(args, ctx, 'post'),
  'deploy preview': async (args, ctx) => deployViaIpc(args, ctx, 'preview'),
  'deploy production': async (args, ctx) => deployViaIpc(args, ctx, 'production'),
  preview: async (args, ctx) => deployViaIpc(args, ctx, 'preview'),
  production: async (args, ctx) => deployViaIpc(args, ctx, 'production'),

  stop: async (args, ctx) => {
    const { appName, blockName } = parseAppBlockTarget(args[0]);
    return sendIpcRequest(ctx.socketPath, { type: 'stop', appName, blockName });
  },

  'connector install': async (args, ctx) => {
    const [name] = args;
    if (!name) throw new Error('usage: sdk connector install <name>');
    const vendworks = await createConnectorVendworks(ctx);
    return vendworks.install(name);
  },

  'connector uninstall': async (args, ctx) => {
    const [name] = args;
    if (!name) throw new Error('usage: sdk connector uninstall <name>');
    const vendworks = await createConnectorVendworks(ctx);
    return vendworks.uninstall(name);
  },

  'connector list': async (args, ctx) => {
    const vendworks = await createConnectorVendworks(ctx);
    return vendworks.list();
  },

  'connector publish': async (args, ctx) => {
    const { positionals, flags } = parseFlags(args);
    const [name, version, sourceDir] = positionals;
    if (!name || !version || !sourceDir) {
      throw new Error('usage: sdk connector publish <name> <version> <sourceDir> [--token=TOKEN]');
    }
    const vendworks = await createConnectorVendworks(ctx);
    return vendworks.publish({ name, version, sourceDir, token: flags.token });
  },
};

export function resolveCommand(argv) {
  const twoWord = argv.slice(0, 2).join(' ');
  if (Object.prototype.hasOwnProperty.call(COMMAND_TABLE, twoWord)) {
    return { key: twoWord, rest: argv.slice(2) };
  }
  const oneWord = argv[0];
  if (oneWord !== undefined && Object.prototype.hasOwnProperty.call(COMMAND_TABLE, oneWord)) {
    return { key: oneWord, rest: argv.slice(1) };
  }
  return null;
}

export async function dispatch(argv, ctx) {
  const resolved = resolveCommand(argv);
  if (!resolved) {
    throw new Error(`unknown command: ${argv.join(' ') || '(none)'}`);
  }
  return COMMAND_TABLE[resolved.key](resolved.rest, ctx);
}

function buildCliContext() {
  const shipHome = resolveShipHome();
  return {
    version: VERSION,
    shipHome,
    socketPath: socketPath(shipHome),
    logPath: daemonLogPath(shipHome),
    nodePath: process.execPath,
    scriptPath: process.argv[1],
  };
}

export async function main(argv = process.argv.slice(2)) {
  const ctx = buildCliContext();

  if (argv[0] === 'daemon' && argv[1] === 'start') {
    const { flags } = parseFlags(argv.slice(2));
    const verbose = Boolean(flags.dev || flags.verbose);
    const { readyReport } = await boot({ shipHome: ctx.shipHome, verbose });
    // boot() normally only logs to the daemon's log file, never stdout -- run
    // this directly in a foreground terminal (not backgrounded with & or
    // installed via `sdk daemon install`) and it would otherwise look
    // indistinguishable from a hang, since the daemon blocks here forever by
    // design once it's up. --dev (or --verbose) tees Block lifecycle
    // transitions, IPC traffic, and health-check timing here live, on top of
    // that same confirmation.
    printSuccess(`Ship daemon ready (pid ${process.pid}), listening on ${readyReport.socket}.`);
    printSystem('this process runs in the foreground -- ctrl+c to stop, or run with & to background it.');
    if (verbose) printSystem('--dev: internal Block lifecycle, IPC, and health-check activity will print below.');
    return readyReport;
  }

  return dispatch(argv, ctx);
}

function isDirectRun() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const cliArgv = process.argv.slice(2);
  const isDaemonStart = cliArgv[0] === 'daemon' && cliArgv[1] === 'start';
  main(cliArgv).then(
    (result) => {
      // daemon start already printed its own human-readable confirmation above --
      // the readyReport it returns (server/composition/shutdown handles) isn't
      // meant for a field-by-field dump.
      if (result !== undefined && !isDaemonStart) {
        const formatted = formatResult(result);
        if (formatted) console.log(formatted);
      }
    },
    (err) => {
      printError(err.message);
      process.exitCode = 1;
    },
  );
}
