import { Readable } from "node:stream";
import cloudinary from "./cloudinary.js";

const SCREENSHOT_FOLDER = "juvo/trade-screenshots";

function uploadTradeScreenshot(file) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        type: "authenticated",
        folder: SCREENSHOT_FOLDER,
        use_filename: false,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result?.public_id) {
          reject(error || new Error("Screenshot upload failed."));
          return;
        }

        resolve({
          publicId: result.public_id,
          format: result.format,
          bytes: result.bytes,
        });
      },
    );

    Readable.from(file.buffer).pipe(uploadStream);
  });
}

function destroyTradeScreenshot(publicId) {
  if (!publicId) return Promise.resolve();
  return cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "authenticated",
    invalidate: true,
  });
}

function buildScreenshotUrl(publicId) {
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const imageUrl = cloudinary.url(publicId, {
    resource_type: "image",
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: expiresAt,
  });

  return { imageUrl, expiresAt };
}

export {
  buildScreenshotUrl,
  destroyTradeScreenshot,
  uploadTradeScreenshot,
};
