import { createWorker } from "tesseract.js";
import {
  createScan,
  findScansByUserId,
  deleteScanById,
} from "../repositories/scanRepository.js";

export async function processOcrScan(userId, imageBuffer, type = "document") {
  const base64Image = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;

  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(base64Image);

    const scan = await createScan({
      userId,
      type,
      text: text.trim(),
    });

    return {
      scan,
      text: text.trim(),
    };
  } finally {
    await worker.terminate();
  }
}

export async function getUserScans(userId, limit) {
  return findScansByUserId(userId, limit);
}

export async function removeUserScan(userId, scanId) {
  return deleteScanById(userId, scanId);
}
