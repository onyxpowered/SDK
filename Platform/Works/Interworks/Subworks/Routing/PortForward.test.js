// SDK
// Designed & Built By onyxpowered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { createServer as createHttpServer } from 'node:http';
import {
  localIPv4Address,
  guessGatewayHost,
  encodeNatPmpMapRequest,
  decodeNatPmpMapResponse,
  requestNatPmpMapping,
  discoverUpnpGatewayLocation,
  fetchUpnpControlUrl,
  requestUpnpMapping,
  attemptUpnpPortForward,
  attemptNatPmpPortForward,
  attemptPortForward,
  manualPortForwardInstructions,
} from './PortForward.js';

test('localIPv4Address returns a dotted-quad IPv4 address or null', () => {
  const address = localIPv4Address();
  if (address !== null) {
    assert.match(address, /^\d{1,3}(\.\d{1,3}){3}$/);
  }
});

test('guessGatewayHost swaps the last octet of a given local address to .1', () => {
  assert.equal(guessGatewayHost('192.168.1.42'), '192.168.1.1');
  assert.equal(guessGatewayHost('10.0.0.55'), '10.0.0.1');
  assert.equal(guessGatewayHost(null), null);
});

test('encodeNatPmpMapRequest/decodeNatPmpMapResponse round-trip the RFC 6886 wire format', () => {
  const request = encodeNatPmpMapRequest({ protocol: 'tcp', internalPort: 8080, externalPort: 8080, lifetimeSeconds: 7200 });
  assert.equal(request.length, 12);
  assert.equal(request.readUInt8(0), 0);
  assert.equal(request.readUInt8(1), 2);
  assert.equal(request.readUInt16BE(4), 8080);
  assert.equal(request.readUInt16BE(6), 8080);
  assert.equal(request.readUInt32BE(8), 7200);

  const udpRequest = encodeNatPmpMapRequest({ protocol: 'udp', internalPort: 53 });
  assert.equal(udpRequest.readUInt8(1), 1);

  const response = Buffer.alloc(16);
  response.writeUInt8(0, 0);
  response.writeUInt8(130, 1);
  response.writeUInt16BE(0, 2);
  response.writeUInt32BE(1000, 4);
  response.writeUInt16BE(8080, 8);
  response.writeUInt16BE(9090, 10);
  response.writeUInt32BE(3600, 12);
  const decoded = decodeNatPmpMapResponse(response);
  assert.deepEqual(decoded, {
    version: 0,
    opcode: 130,
    resultCode: 0,
    secondsSinceEpoch: 1000,
    internalPort: 8080,
    externalPort: 9090,
    lifetimeSeconds: 3600,
  });
});

function startFakeNatPmpGateway(handler) {
  const socket = createSocket('udp4');
  socket.on('message', (message, rinfo) => {
    const reply = handler(message);
    if (reply) socket.send(reply, rinfo.port, rinfo.address);
  });
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => resolve(socket));
  });
}

test('requestNatPmpMapping parses a successful mapping response from a real fake gateway', async () => {
  const socket = await startFakeNatPmpGateway((message) => {
    const response = Buffer.alloc(16);
    response.writeUInt8(0, 0);
    response.writeUInt8(130, 1);
    response.writeUInt16BE(0, 2);
    response.writeUInt32BE(1234, 4);
    response.writeUInt16BE(message.readUInt16BE(4), 8);
    response.writeUInt16BE(message.readUInt16BE(6), 10);
    response.writeUInt32BE(message.readUInt32BE(8), 12);
    return response;
  });
  try {
    const result = await requestNatPmpMapping({
      gatewayHost: '127.0.0.1',
      gatewayPort: socket.address().port,
      internalPort: 4242,
      timeoutMs: 1000,
    });
    assert.equal(result.resultCode, 0);
    assert.equal(result.internalPort, 4242);
    assert.equal(result.externalPort, 4242);
  } finally {
    socket.close();
  }
});

test('requestNatPmpMapping throws when the gateway reports a non-zero result code', async () => {
  const socket = await startFakeNatPmpGateway(() => {
    const response = Buffer.alloc(16);
    response.writeUInt16BE(3, 2);
    return response;
  });
  try {
    await assert.rejects(
      () => requestNatPmpMapping({ gatewayHost: '127.0.0.1', gatewayPort: socket.address().port, internalPort: 80, timeoutMs: 1000 }),
      /result code 3/,
    );
  } finally {
    socket.close();
  }
});

test('requestNatPmpMapping times out cleanly when the gateway never replies', async () => {
  const deadSocket = createSocket('udp4');
  await new Promise((resolve, reject) => {
    deadSocket.once('error', reject);
    deadSocket.bind(0, '127.0.0.1', resolve);
  });
  const deadPort = deadSocket.address().port;
  deadSocket.close();

  await assert.rejects(
    () => requestNatPmpMapping({ gatewayHost: '127.0.0.1', gatewayPort: deadPort, internalPort: 80, timeoutMs: 100 }),
  );
});

test('requestNatPmpMapping rejects when no gateway host can be determined', async () => {
  await assert.rejects(
    () => requestNatPmpMapping({ gatewayHost: null, internalPort: 80 }),
    /could not determine a gateway host/,
  );
});

function startFakeSsdpResponder(locationUrl) {
  const socket = createSocket('udp4');
  socket.on('message', (message, rinfo) => {
    if (!message.toString('utf8').startsWith('M-SEARCH')) return;
    const reply = Buffer.from(
      ['HTTP/1.1 200 OK', `LOCATION: ${locationUrl}`, 'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1', '', ''].join('\r\n'),
    );
    socket.send(reply, rinfo.port, rinfo.address);
  });
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => resolve(socket));
  });
}

test('discoverUpnpGatewayLocation parses the LOCATION header from a real fake SSDP responder', async () => {
  const socket = await startFakeSsdpResponder('http://127.0.0.1:9999/desc.xml');
  try {
    const location = await discoverUpnpGatewayLocation({
      multicastAddress: '127.0.0.1',
      multicastPort: socket.address().port,
      timeoutMs: 1000,
    });
    assert.equal(location, 'http://127.0.0.1:9999/desc.xml');
  } finally {
    socket.close();
  }
});

const DEVICE_DESCRIPTION_XML = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
    <deviceList>
      <device>
        <deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType>
        <serviceList>
          <service>
            <serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType>
            <controlURL>/upnp/control/WANCommonIFC1</controlURL>
          </service>
        </serviceList>
        <deviceList>
          <device>
            <deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType>
            <serviceList>
              <service>
                <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
                <controlURL>/upnp/control/WANIPConn1</controlURL>
              </service>
            </serviceList>
          </device>
        </deviceList>
      </device>
    </deviceList>
  </device>
</root>`;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

test('fetchUpnpControlUrl finds the WANIPConnection service and resolves its control URL against the device description URL', async () => {
  const server = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/xml' });
    res.end(DEVICE_DESCRIPTION_XML);
  });
  try {
    const { port } = await listen(server);
    const { serviceType, controlUrl } = await fetchUpnpControlUrl(`http://127.0.0.1:${port}/desc.xml`);
    assert.equal(serviceType, 'urn:schemas-upnp-org:service:WANIPConnection:1');
    assert.equal(controlUrl, `http://127.0.0.1:${port}/upnp/control/WANIPConn1`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchUpnpControlUrl throws when no WAN connection service is present', async () => {
  const server = createHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/xml' });
    res.end('<root><device><serviceList></serviceList></device></root>');
  });
  try {
    const { port } = await listen(server);
    await assert.rejects(() => fetchUpnpControlUrl(`http://127.0.0.1:${port}/desc.xml`), /no WANIPConnection/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('requestUpnpMapping POSTs a SOAP AddPortMapping envelope with the correct SOAPAction header', async () => {
  let receivedHeaders;
  let receivedBody = '';
  const server = createHttpServer((req, res) => {
    receivedHeaders = req.headers;
    req.on('data', (chunk) => {
      receivedBody += chunk;
    });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end('<s:Envelope><s:Body><u:AddPortMappingResponse/></s:Body></s:Envelope>');
    });
  });
  try {
    const { port } = await listen(server);
    const result = await requestUpnpMapping({
      controlUrl: `http://127.0.0.1:${port}/control`,
      serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1',
      internalPort: 3000,
      internalClient: '10.0.0.5',
    });
    assert.equal(result.ok, true);
    assert.equal(receivedHeaders.soapaction, '"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping"');
    assert.match(receivedBody, /<NewExternalPort>3000<\/NewExternalPort>/);
    assert.match(receivedBody, /<NewInternalClient>10\.0\.0\.5<\/NewInternalClient>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('requestUpnpMapping throws with the response body when the router rejects the mapping', async () => {
  const server = createHttpServer((req, res) => {
    res.writeHead(500, { 'content-type': 'text/xml' });
    res.end('<s:Envelope><s:Body><s:Fault>ConflictInMapping</s:Fault></s:Body></s:Envelope>');
  });
  try {
    const { port } = await listen(server);
    await assert.rejects(
      () => requestUpnpMapping({
        controlUrl: `http://127.0.0.1:${port}/control`,
        serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1',
        internalPort: 3000,
        internalClient: '10.0.0.5',
      }),
      /ConflictInMapping/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('attemptUpnpPortForward runs discovery -> description -> AddPortMapping end to end against real fakes', async () => {
  const soapServer = createHttpServer((req, res) => {
    if (req.url === '/desc.xml') {
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end(DEVICE_DESCRIPTION_XML);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/xml' });
    res.end('<s:Envelope><s:Body><u:AddPortMappingResponse/></s:Body></s:Envelope>');
  });
  const { port: httpPort } = await listen(soapServer);
  const ssdpSocket = await startFakeSsdpResponder(`http://127.0.0.1:${httpPort}/desc.xml`);

  try {
    const result = await attemptUpnpPortForward(3000, {
      multicastAddress: '127.0.0.1',
      multicastPort: ssdpSocket.address().port,
    });
    assert.equal(result.mechanism, 'upnp');
    assert.equal(result.port, 3000);
  } finally {
    ssdpSocket.close();
    await new Promise((resolve) => soapServer.close(resolve));
  }
});

test('attemptPortForward falls back to NAT-PMP when UPnP discovery finds nothing', async () => {
  const natPmpSocket = await startFakeNatPmpGateway((message) => {
    const response = Buffer.alloc(16);
    response.writeUInt16BE(0, 2);
    response.writeUInt16BE(message.readUInt16BE(4), 8);
    response.writeUInt16BE(9999, 10);
    return response;
  });

  try {
    const result = await attemptPortForward(4000, {
      timeoutMs: 100,
      gatewayHost: '127.0.0.1',
      gatewayPort: natPmpSocket.address().port,
      multicastAddress: '127.0.0.1',
      multicastPort: 1,
    });
    assert.equal(result.mechanism, 'nat-pmp');
    assert.equal(result.port, 9999);
  } finally {
    natPmpSocket.close();
  }
});

test('attemptPortForward returns a combined error and no mechanism when both UPnP and NAT-PMP fail', async () => {
  const result = await attemptPortForward(5000, {
    timeoutMs: 100,
    gatewayHost: '127.0.0.1',
    gatewayPort: 1,
    multicastAddress: '127.0.0.1',
    multicastPort: 1,
  });

  assert.equal(result.mechanism, null);
  assert.match(result.error, /UPnP failed/);
  assert.match(result.error, /NAT-PMP failed/);
});

test('manualPortForwardInstructions mentions the port, protocol, and this machine\'s local IP', () => {
  const text = manualPortForwardInstructions(443, 'TCP');
  assert.match(text, /443/);
  assert.match(text, /TCP/);
});
