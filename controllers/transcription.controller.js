import { transcribeAudioService } from "../services/transcription.service.js";

function getUserId(user) {
  return user?.id || user?._id;
}

async function transcribeAudioController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const result = await transcribeAudioService(req.file);
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Voice note transcribed.",
      data: {
        text: result.text,
        language: result.language,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export { transcribeAudioController };
