import express from "express";
import cors from "cors";
// Routes
import authRoutes from "./routes/authRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import scanRoutes from "./routes/scanRoutes.js";
import studySetRoutes from "./routes/studySetRoutes.js";
import aiRoutes from "./routes/AIRoute.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN || "*";

app.use(
  cors({
    origin: clientOrigin,
  })
);
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "MyHub backend is running." });
});

app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/scan", scanRoutes);
app.use("/api/studysets", studySetRoutes);
app.use("/api/ai",aiRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
