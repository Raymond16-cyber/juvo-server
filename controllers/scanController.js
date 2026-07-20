import {
  processOcrScan,
  getUserScans,
  removeUserScan,
} from "../services/scanService.js";

export async function uploadScan(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image provided." });
    }

    const userId = String(req.user._id);
    const scanType = req.body.type === "ocr" ? "ocr" : "document";

    const result = await processOcrScan(userId, req.file.buffer, scanType);

    return res.status(201).json({
      message: "Scan processed successfully.",
      scan: result.scan,
      text: result.text,
    });
  } catch (error) {
    return next(error);
  }
}

export async function listScans(req, res, next) {
  try {
    const userId = String(req.user._id);
    const limit = parseInt(req.query.limit, 10) || 20;
    const scans = await getUserScans(userId, limit);

    return res.status(200).json({ scans });
  } catch (error) {
    return next(error);
  }
}

export async function deleteScan(req, res, next) {
  try {
    const userId = String(req.user._id);
    const { id } = req.params;

    const scan = await removeUserScan(userId, id);

    return res.status(200).json({
      message: "Scan deleted successfully.",
      scanId: scan.id,
    });
  } catch (error) {
    return next(error);
  }
}
