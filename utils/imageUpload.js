import multer from "multer";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_SCREENSHOT_BYTES,
  normalizeDeclaredMime,
} from "./screenshotImage.js";

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SCREENSHOT_BYTES,
    files: 1,
  },
  fileFilter(req, file, callback) {
    const mimeType = normalizeDeclaredMime(file.mimetype);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      callback(new Error("Screenshot must be a JPEG, PNG, or WebP image."));
      return;
    }
    callback(null, true);
  },
});

function handleScreenshotUpload(req, res, next) {
  imageUpload.single("screenshot")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Screenshot must be a JPEG, PNG, or WebP image up to 5 MB."
        : error.message || "Unable to read the screenshot.";

    res.status(400).json({ success: false, message });
  });
}

export { handleScreenshotUpload };
