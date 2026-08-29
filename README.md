<h1 align="left" style="margin: 0 0 10px 0; font-size: 64px; font-weight: 900; letter-spacing: -0.08em; line-height: 0.9;">
  SDK
</h1>
<p align="left" style="margin: 0 0 18px 0; font-size: 18px; color: #6b7280; line-height: 1.4;">
designed and built by onyxpowered.
</p>

the messier and developer centered version of Ship, the self-hosted developer platform for shipping apps to your own machines, with previews, throttling, and monitoring built in. no third-party host is required in the loop.

what's included:

one, all test files.
two, more notes.
three, a local Preview stand-in, and `--dev` flags for internal daemon visibility.

and a note: we take CLI design seriously. clean, colored, square-glyph output -- no more raw JSON dumps.

## requirements

one, node. if you're a developer, you already have this.
two, a basic operating system. as long as it's not FreeBSD, you should be fine.

## install

```bash
git clone https://github.com/onyxpowered/SDK.git
cd SDK
npm link
```

this (should) put a real `sdk` command on your Terminal PATH.

### one, start the daemon.

start the local daemon once per machine. 

to run it in the foreground:

```bash
sdk daemon start
```

or, if you want it to survive terminal closes and reboots:

```bash
sdk daemon install
```

add `--dev` (or `--verbose`) to also print Block lifecycle transitions, IPC traffic, and health-check timing live, on top of the usual quiet confirmation:

```bash
sdk daemon start --dev
```

### two, create an account.

```bash
sdk login --signup
```

### three, create or import an app.

if you want to start fresh:

```bash
sdk new my-app
```

or import:

```bash
sdk import /path/to/existing/app --name=my-app
```

if you imported an existing repo or app, add a `ship.config.js` file so SDK can discover ports and runtime settings. the default shape looks like this:

```js
export default {
  blocks: {
    web: {
      command: 'npm start',
      expose: true,
      healthCheck: { port: 3000 },
    },
  },
};
```

that's temporary. we're working on a smarter framework detection system. it will be thrown in here first for testing.

if you already have an app scaffolded, make sure `healthCheck.port` reflects the port your service actually listens on.

### four, deploy your app.

SDK has two ways to view your app.

one, Preview. this is essentially a shareable URL to your project. it expires after a day, and looks like: preview.onyxpowered.com/your-project.

if you have questions about Preview or how it works, take a look at Legal.

```bash
sdk deploy preview ./my-app
```

and for real production, to your own app:

```bash
sdk deploy ./my-app
```

### five, keep an eye on it.

```bash
sdk logs <app name>
sdk daemon status
```

### six, tear it down, cleanly.

to stop hosting your app:

```bash
sdk stop my-app
```

and to stop SDK entirely:

```bash
sdk daemon uninstall
```

### seven, run the tests.

```bash
npm test
```

every Ship file that lands in here gets its own `.test.js` sitting right next to it. this SDK stays current with Ship through a sync script, not a fork:

```bash
npm run sync
```

pulls Ship's latest `Platform/` tree in, rewriting only what has to differ (the `// Ship` header becomes `// SDK`, and a handful of literal `ship`-invocation strings become `sdk`, like the CLI's own usage text). your own `.test.js` files are never touched by it.

### eight, work offline with a local Preview.

Preview mode normally needs the real `preview.onyxpowered.com` backend up to hand out a tunnel and a URL. bring up a local stand-in instead:

```bash
npm run preview
```

then point the CLI at it and go:

```bash
SHIP_SERVICES_URL=http://127.0.0.1:4230 sdk login --signup
SHIP_SERVICES_URL=http://127.0.0.1:4230 sdk deploy preview ./my-app
```

it speaks the exact tunnel protocol Ship's real client already does, so the preview URL it hands back is real and curlable -- your actual app answers through it. it isn't a security boundary and doesn't persist accounts across restarts; it exists so Preview-mode work doesn't have to wait on that box being up.

### further reading.

thank you for trying to work with this SDK. it's in early testing, and improvements are constantly being made. if you want a more minimal version with a clean tree, head to [the Ship project.](https://github.com/onyxpowered/Ship)

if you have questions, comments, or, you guessed it, pull requests, hit up community@onyxpowered.com.

xoxo,

onyxpowered and the SDK team.