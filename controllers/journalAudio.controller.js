import mongoose from "mongoose";
import Journal from "../models/Journal.js";
import cloudinary from "../config/cloudinary.js";
import audioUpload from "../utils/audioUpload.js";

async function uploadBeforeTradingAudioController(req, res, next) {
  let uploadedAudio;

  try {
    const { journalId } = req.params;
    const userId = req.user.id;

    if (!mongoose.isValidObjectId(journalId)) {
      return res.status(400).json({ message: "Invalid journal ID." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Please provide an audio file." });
    }

    const journal = await Journal.findOne({
      _id: journalId,
      user: userId,
    });

    if (!journal) {
      return res.status(404).json({ message: "Journal not found." });
    }

    // Upload to Cloudinary before saving its metadata.
    uploadedAudio = await audioUpload(req.file);

    const previousPublicId = journal.psychology?.beforeTradingAudio?.publicId;

    if (typeof req.body.transcript === "string") {
      journal.set("psychology.beforeTrading", req.body.transcript);
    }
    journal.set("psychology.beforeTradingAudio", uploadedAudio);
    await journal.save();

    // Best-effort cleanup if this recording replaced an older one.
    if (previousPublicId && previousPublicId !== uploadedAudio.publicId) {
      try {
        await cloudinary.uploader.destroy(previousPublicId, {
          resource_type: "video",
          type: "authenticated",
        });
      } catch (cleanupError) {
        console.error("Could not remove replaced voice note.");
      }
    }

    return res.status(200).json({
      message: "Before-trading audio saved successfully.",
      data: {
        beforeTradingAudio: uploadedAudio,
      },
    });
  } catch (error) {
    // Avoid leaving a newly uploaded asset behind if saving the journal fails.
    if (uploadedAudio?.publicId) {
      try {
        await cloudinary.uploader.destroy(uploadedAudio.publicId, {
          resource_type: "video",
          type: "authenticated",
        });
      } catch {
        // The original error remains the important one.
      }
    }

    return next(error);
  }
}

async function getBeforeTradingAudioController(req, res, next) {
  try {
    const { journalId } = req.params;

    if (!mongoose.isValidObjectId(journalId)) {
      return res.status(400).json({ message: "Invalid journal ID." });
    }

    const journal = await Journal.findOne({
      _id: journalId,
      user: req.user.id,
    }).select("psychology.beforeTradingAudio");

    if (!journal) {
      return res.status(404).json({ message: "Journal not found." });
    }

    const audio = journal.psychology?.beforeTradingAudio;

    if (!audio?.publicId || !audio?.format) {
      return res.status(404).json({
        message: "No before-trading audio found.",
      });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    const playbackUrl = cloudinary.utils.private_download_url(
      audio.publicId,
      audio.format,
      {
        resource_type: "video",
        type: "authenticated",
        expires_at: expiresAt,
        secure: true,
      },
    );

    res.set("Cache-Control", "no-store");

    return res.status(200).json({
      message: "Audio access granted.",
      data: {
        playbackUrl,
        expiresAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export { uploadBeforeTradingAudioController, getBeforeTradingAudioController };
