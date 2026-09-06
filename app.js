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

const app = express();
const configuredClientOrigin =
  process.env.NODE_ENV === "production"
    ? process.env.CLIENT_URL
    : process.env.CLIENT_ORIGIN || "http://localhost:3000";
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

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "JUVO backend is running." });
});

app.use("/api/auth", authRoutes);
app.use("/api/onboarding", onboardRoutes);
app.use("/api/trading-account", tradingAccountRoutes);
app.use("/api/journal", journalRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/goals", goalRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
