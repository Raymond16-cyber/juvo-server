import express from "express";
import cors from "cors";
// Routes
import authRoutes from "./routes/authRoutes.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import onboardRoutes from "./routes/onboardRoute.js";
import tradingAccountRoutes from "./routes/tradingaccount.route.js";
import journalRoutes from "./routes/journal.route.js";
import aiRoutes from "./routes/ai.route.js";
import analyticsRoutes from "./routes/analytics.route.js";
import goalRoutes from "./routes/goal.route.js";
import brokerRoutes from "./routes/broker.route.js";
import billingRoutes from "./routes/billing.route.js";
import { paystackWebhookController } from "./controllers/billing.controller.js";
import waitlistRoutes from "./routes/waitlist.route.js";
import achievementRoutes from "./routes/achievement.route.js";

const app = express();
// Set only to the exact trusted proxy hops/subnets in deployments with TLS termination.
if (process.env.TRUST_PROXY_HOPS) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5)
    throw new Error("TRUST_PROXY_HOPS must be an integer between 1 and 5.");
  app.set("trust proxy", hops);
}
const configuredClientOrigin =
  process.env.NODE_ENV === "production"
    ? process.env.CLIENT_URL
    : process.env.CLIENT_ORIGIN;
const allowedOrigins = (configuredClientOrigin || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && !process.env.CLIENT_URL) {
  throw new Error("CLIENT_URL is required in production.");
}

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS."));
    },
    credentials: true,
  }),
);

// Paystack signs the exact raw body, so this must be mounted before JSON parsing.
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json", limit: "256kb" }),
  paystackWebhookController,
);
app.use(
  ["/api/broker/metatrader", "/api/brokers/metatrader"],
  express.json({ limit: "512kb", strict: true }),
);
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "JUVO backend is running." });
});

app.use("/api/auth", authRoutes);
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/onboarding", onboardRoutes);
app.use("/api/trading-account", tradingAccountRoutes);
app.use("/api/journal", journalRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/goals", goalRoutes);
app.use("/api/achievements", achievementRoutes);
app.use("/api/billing", billingRoutes);
// Broker Routes
app.use("/api/broker", brokerRoutes);
// Alias matches the cTrader app redirect URI: /api/brokers/ctrader/callback
app.use("/api/brokers", brokerRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
