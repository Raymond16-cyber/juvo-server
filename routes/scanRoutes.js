import express from "express";
import multer from "multer";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  uploadScan,
  listScans,
  deleteScan,
} from "../controllers/scanController.js";

const upload = multer({ storage: multer.memoryStorage() });
const scanRoutes = express.Router();

scanRoutes.post(
  "/ocr",
  requireAuth,
  upload.single("image"),
  uploadScan
);

scanRoutes.get("/", requireAuth, listScans);
scanRoutes.delete("/:id", requireAuth, deleteScan);

export default scanRoutes;
