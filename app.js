import express from "express";
import cors from "cors";
// Routes
import authRoutes from "./routes/authRoutes.js";
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

app.use(notFound);
app.use(errorHandler);

export default app;
