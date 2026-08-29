// SDK
// Designed & Built By onyxpowered.

import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('hello from the ship end-to-end test app\n');
});

server.listen(39192, '127.0.0.1', () => {
  process.stdout.write('e2e test app listening\n');
  process.stdout.write(`SHIP_BASE_PATH=${process.env.SHIP_BASE_PATH ?? ''}\n`);
});
