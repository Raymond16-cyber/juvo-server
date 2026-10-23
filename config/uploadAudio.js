import { Readable } from "node:stream";
import cloudinary from "../config/cloudinary.js";

const uploadAudio = (file) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        type: "authenticated",
        folder: "juvo/voice-notes",
        use_filename: false,
        unique_filename: true,
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve({
          publicId: result.public_id,
          format: result.format,
          bytes: result.bytes,
          duration: result.duration ?? null,
        });
      },
    );

    Readable.from([file.buffer]).pipe(uploadStream);
  });

export default uploadAudio;
