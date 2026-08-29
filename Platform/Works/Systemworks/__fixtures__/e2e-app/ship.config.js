// SDK
// Designed & Built By onyxpowered.

export default {
  blocks: {
    web: {
      command: 'node server.js',
      expose: true,
      healthCheck: { port: 39191 },
    },
  },
};
