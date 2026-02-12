import { config } from './config.js';
import { createAppServer } from './app.js';

const { server } = createAppServer();

server.listen(config.port, '0.0.0.0', () => {
  console.log(`backend listening on :${config.port}`);
});
