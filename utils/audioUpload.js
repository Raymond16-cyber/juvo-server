import multer from "multer";

const allowedAudioTypes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
]);

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 1,
  },

  fileFilter: (req, file, callback) => {
    const mimeType = file.mimetype.split(";")[0].trim().toLowerCase();

    const allowedAudioTypes = new Set([
      "audio/webm",
      "audio/ogg",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/aac",
      "audio/flac",
      "video/webm",
      "video/mp4",
    ]);

    if (!allowedAudioTypes.has(mimeType)) {
      return callback(new Error("Unsupported audio format."));
    }

    callback(null, true);
  },
});

export default audioUpload;
