const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

const SCREENSHOT_REVIEW_FIELDS = Object.freeze([
  "chartObservations",
  "marketStructure",
  "setupAnalysis",
  "entryExitReview",
  "riskManagement",
  "whatWentWell",
  "whatCouldBeImproved",
  "keyLesson",
  "confidenceAndLimitations",
]);

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function normalizeDeclaredMime(mimeType = "") {
  const mime = String(mimeType).split(";")[0].trim().toLowerCase();
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.subarray(0, 8).equals(png)) {
    return "image/png";
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function validateScreenshotFile(file) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    return { ok: false, message: "Choose a chart screenshot to review." };
  }

  if (file.buffer.length === 0 || file.buffer.length > MAX_SCREENSHOT_BYTES) {
    return { ok: false, message: "Screenshot must be a JPEG, PNG, or WebP image up to 5 MB." };
  }

  const declared = normalizeDeclaredMime(file.mimetype);
  const detected = detectImageMime(file.buffer);

  if (
    !detected ||
    !ALLOWED_IMAGE_MIME_TYPES.has(declared) ||
    declared !== detected
  ) {
    return {
      ok: false,
      message: "Screenshot must be a JPEG, PNG, or WebP image.",
    };
  }

  return { ok: true, mimeType: detected };
}

function normalizeScreenshotReview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const review = {};
  for (const field of SCREENSHOT_REVIEW_FIELDS) {
    const text = typeof value[field] === "string" ? value[field].trim() : "";
    if (!text) return null;
    review[field] = text.slice(0, 4000);
  }

  return review;
}

export {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_SCREENSHOT_BYTES,
  SCREENSHOT_REVIEW_FIELDS,
  detectImageMime,
  normalizeDeclaredMime,
  normalizeScreenshotReview,
  validateScreenshotFile,
};
