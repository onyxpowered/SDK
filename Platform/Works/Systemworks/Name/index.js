import { createServer } from 'node:http';

const port = process.env.PORT || 4227;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Shipped.');
});

server.listen(port, () => {
  console.log(`listening on ${port}`);
});
