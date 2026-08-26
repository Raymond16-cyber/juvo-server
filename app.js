import express from "express";
import cors from "cors";
// Routes
import authRoutes from "./routes/authRoutes.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import onboardRoutes from "./routes/onboardRoute.js";
import tradingAccountRoutes from "./routes/tradingaccount.route.js";
import journalRoutes from "./routes/journal.route.js";

const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN || "*";

app.use(
  cors({
    origin: clientOrigin,
    credentials: true,
  }),
);

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "MyHub backend is running." });
});

app.use("/api/auth", authRoutes);
app.use("/api/onboarding", onboardRoutes);
app.use("/api/trading-account", tradingAccountRoutes);
app.use("/api/journal", journalRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
