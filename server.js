import "./config/loadEnv.js";
import http from "http";
import app from "./app.js";
import connectDb from "./config/db.js";
import { cTraderManager } from "./brokers/ctrader/ctrader.manager.js";
import { initializeRealtime } from "./realtime/realtime.hub.js";
import { metatraderRuntime } from "./brokers/metatrader/metatrader.runtime.js";
import { connectorConfig } from "./brokers/metatrader/metatrader.security.js";
import { migrateLegacyMetaApi } from "./brokers/metatrader/metatrader.migration.js";
import { initializeMetaTraderIndexes } from "./brokers/metatrader/metatrader.initialize.js";
import { initializeBillingIndexes } from "./billing/billing.initialize.js";
import { startBillingWorker, stopBillingWorker } from "./services/billing.service.js";
import {
  startJournalStreakJob,
  stopJournalStreakJob,
} from "./jobs/journalStreak.job.js";
import {
  startJournalAutoCloseJob,
  stopJournalAutoCloseJob,
} from "./jobs/journalAutoClose.job.js";



const port = process.env.PORT || 5000;
async function startServer() {
  try {
    connectorConfig();
    await connectDb();
    await migrateLegacyMetaApi();
    await initializeMetaTraderIndexes();
    await initializeBillingIndexes();
    startJournalStreakJob();
    startJournalAutoCloseJob();
    metatraderRuntime.start();
    startBillingWorker();
    const server = http.createServer(app);
    initializeRealtime(server);

    server.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    const requiredCloudinaryEnv = [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
    ];

    const missingCloudinaryEnv = requiredCloudinaryEnv.filter(
      (key) => !process.env[key],
    );

    if (missingCloudinaryEnv.length > 0) {
      throw new Error(
        `Missing Cloudinary environment variables: ${missingCloudinaryEnv.join(", ")}`,
      );
    }

    console.log("Cloudinary environment variables are configured.");

    cTraderManager.start().catch((error) => {
      console.error("Failed to start cTrader realtime manager:", error);
    });
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      const deadline = setTimeout(() => process.exit(1), 15000);
      deadline.unref();
      server.close();
      metatraderRuntime.stop();
      stopBillingWorker();
      stopJournalStreakJob();
      stopJournalAutoCloseJob();
      process.exit(0);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    } catch (error) {
      const hiddenMessage = "Check backend configuration and database connectivity.";
      const message = error?.safeConnector
        ? error.message
        : process.env.NODE_ENV === "production"
          ? hiddenMessage
          : error?.message || hiddenMessage;
      console.error("Failed to start server:", message);
      process.exit(1);
    }
  // } catch (error) {
  //   console.error("Failed to start server:", error?.stack || error);
  //   process.exit(1);
  // }
}

void startServer();
