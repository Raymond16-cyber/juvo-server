import "../config/loadEnv.js";
import { testCTraderSocketConnection } from "../brokers/ctrader/ctrader.socket.js";
import { CTRADER_JSON_ENDPOINT } from "../brokers/ctrader/ctrader.constants.js";

console.log("[ctrader-socket-test] Starting socket-only diagnostic");
console.log("[ctrader-socket-test] Endpoint:", CTRADER_JSON_ENDPOINT);
console.log("[ctrader-socket-test] Node:", process.version);
console.log("[ctrader-socket-test] Platform:", `${process.platform} ${process.arch}`);

try {
  const result = await testCTraderSocketConnection({
    url: CTRADER_JSON_ENDPOINT,
  });
  console.log("[ctrader-socket-test] WebSocket connected successfully");
  console.log("[ctrader-socket-test] Result:", result);
  process.exit(0);
} catch (error) {
  console.error("[ctrader-socket-test] WebSocket connection failed");
  console.error("[ctrader-socket-test] Message:", error.message);
  console.error("[ctrader-socket-test] Code:", error.code || error.details?.code);
  console.error("[ctrader-socket-test] Host:", error.host || error.details?.host);
  console.error("[ctrader-socket-test] Port:", error.port || error.details?.port);
  process.exit(1);
}
