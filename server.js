import "./config/loadEnv.js";
import http from "http";
import app from "./app.js";
import connectDb from "./config/db.js";
import { cTraderManager } from "./brokers/ctrader/ctrader.manager.js";
import { initializeRealtime } from "./realtime/realtime.hub.js";

const port = process.env.PORT || 5000;
async function startServer() {
  try {
    await connectDb();
    const server = http.createServer(app);
    initializeRealtime(server);

    server.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    cTraderManager.start().catch((error) => {
      console.error("Failed to start cTrader realtime manager:", error);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

void startServer();
