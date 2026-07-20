import Scan from "../models/Scan.js";

export async function createScan(scanData) {
  const scan = await Scan.create(scanData);
  return scan;
}

export async function findScansByUserId(userId, limit = 20) {
  return Scan.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export async function deleteScanById(userId, scanId) {
  const scan = await Scan.findOneAndDelete({ _id: scanId, userId });
  if (!scan) {
    const error = new Error("Scan not found.");
    error.status = 404;
    throw error;
  }
  return scan;
}
