import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { startEmailOutboxWorker } from "./lib/email-outbox";
import { startFiscalWorker } from "./lib/fiscal-worker";
import { attachRealtimeServer } from "./lib/realtime";

const rawPort = process.env["API_PORT"] ?? process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "API_PORT (or PORT) environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);
const host = process.env["API_HOST"];

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
attachRealtimeServer(server);
server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
const onListening = () => {
  logger.info({ host: host ?? "0.0.0.0", port }, "Server listening");
  startEmailOutboxWorker();
  startFiscalWorker();
};

if (host) {
  server.listen(port, host, onListening);
} else {
  server.listen(port, onListening);
}
