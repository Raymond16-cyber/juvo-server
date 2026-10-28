import { GoogleGenAI } from "@google/genai";

const XAI_STT_URL = "https://api.x.ai/v1/stt";
const XAI_STT_MODEL = "grok-voice-transcribe-2.0";
const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const ALLOWED_AUDIO_MIME_TYPES = new Set([
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

function readEnv(name) {
  const raw = process.env[name] || "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

function normalizeMime(mimeType = "") {
  return String(mimeType).split(";")[0].trim().toLowerCase();
}

function extensionForMime(mimeType) {
  switch (normalizeMime(mimeType)) {
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "video/mp4":
      return "mp4";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    case "audio/aac":
      return "aac";
    case "audio/flac":
      return "flac";
    case "video/webm":
    case "audio/webm":
    default:
      return "webm";
  }
}

function validateAudioFile(file) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    return { ok: false, message: "Record a short voice note first." };
  }

  if (file.buffer.length > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      message: "Voice note must be 10 MB or smaller.",
    };
  }

  const mimeType = normalizeMime(file.mimetype);
  if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
    return {
      ok: false,
      message: "Unsupported audio format. Use WebM, MP4, WAV, OGG, or AAC.",
    };
  }

  return { ok: true, mimeType };
}

function cleanTranscript(text) {
  return String(text || "")
    .replace(/^```(?:text|plain)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function transcribeWithXai({ buffer, mimeType, filename }) {
  const apiKey = readEnv("XAI_API_KEY");
  if (!apiKey) {
    return {
      success: false,
      statusCode: 503,
      message: "XAI_API_KEY is not configured.",
    };
  }

  const form = new FormData();
  form.append("model", XAI_STT_MODEL);
  form.append("format", "true");
  form.append("language", "en");
  form.append("filler_words", "false");
  form.append(
    "file",
    new Blob([buffer], { type: mimeType }),
    filename || `voice-note.${extensionForMime(mimeType)}`,
  );

  const response = await fetch(XAI_STT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      success: false,
      statusCode: response.status >= 400 ? response.status : 502,
      message:
        payload?.error?.message ||
        payload?.message ||
        "Unable to transcribe this voice note with Grok Voice.",
    };
  }

  const text = cleanTranscript(payload?.text);
  if (!text) {
    return {
      success: false,
      statusCode: 502,
      message: "Grok Voice returned an empty transcript.",
    };
  }

  return {
    success: true,
    text,
    provider: "xai",
    model: XAI_STT_MODEL,
    language: payload?.language || "en",
  };
}

async function transcribeWithGemini({ buffer, mimeType }) {
  const apiKey = readEnv("AI_API_KEY");
  if (!apiKey) {
    return {
      success: false,
      statusCode: 503,
      message: "No transcription provider is configured.",
    };
  }

  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: GEMINI_FALLBACK_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Transcribe this trader voice note accurately.",
              "Return only the spoken words as plain text.",
              "Preserve meaning, punctuation, and trading terms.",
              "Do not summarize, translate, or add commentary.",
            ].join(" "),
          },
          {
            inlineData: {
              mimeType,
              data: buffer.toString("base64"),
            },
          },
        ],
      },
    ],
  });

  let text = "";
  try {
    text = cleanTranscript(response?.text || "");
  } catch {
    const parts = response?.candidates?.[0]?.content?.parts || [];
    text = cleanTranscript(
      parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join(" "),
    );
  }

  if (!text) {
    return {
      success: false,
      statusCode: 502,
      message: "Transcription returned an empty transcript.",
    };
  }

  return {
    success: true,
    text,
    provider: "gemini",
    model: GEMINI_FALLBACK_MODEL,
    language: null,
  };
}

async function transcribeAudioService(file) {
  const validation = validateAudioFile(file);
  if (!validation.ok) {
    return { success: false, statusCode: 400, message: validation.message };
  }

  try {
    if (readEnv("XAI_API_KEY")) {
      const xaiResult = await transcribeWithXai({
        buffer: file.buffer,
        mimeType: validation.mimeType,
        filename: file.originalname,
      });
      if (xaiResult.success) return xaiResult;
      // Fall through to Gemini when SpaceXAI is configured but unavailable.
      console.error("XAI STT failed:", xaiResult.message);
    }

    return await transcribeWithGemini({
      buffer: file.buffer,
      mimeType: validation.mimeType,
    });
  } catch (error) {
    console.error("Transcription failed:", error?.message || error);
    return {
      success: false,
      statusCode: 502,
      message: "Unable to transcribe this voice note right now.",
    };
  }
}

export {
  ALLOWED_AUDIO_MIME_TYPES,
  GEMINI_FALLBACK_MODEL,
  MAX_AUDIO_BYTES,
  XAI_STT_MODEL,
  cleanTranscript,
  transcribeAudioService,
  validateAudioFile,
};
