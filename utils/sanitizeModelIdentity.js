const PROVIDER_MODEL_PATTERNS = [
  /\bgoogle\s*ai\b/gi,
  /\bgoogle\s*genai\b/gi,
  /\bgenerative\s*ai\b/gi,
  /\bgemini(?:[-\s]?(?:\d+(?:\.\d+)?|pro|flash|ultra|lite|nano|flash-lite))?\b/gi,
  /\bgpt[-\s]?\d+(?:\.\d+)?(?:[-\s]?(?:turbo|mini|o))?\b/gi,
  /\bchatgpt\b/gi,
  /\bopenai\b/gi,
  /\bclaude(?:[-\s]?\d+(?:\.\d+)?)?\b/gi,
  /\banthropic\b/gi,
  /\bgrok[-\s]?\d*\b/gi,
  /\bxai\b/gi,
  /\bspacexai\b/gi,
  /\bllama[-\s]?\d*(?:\.\d+)?\b/gi,
  /\bmistral\b/gi,
  /\bdeepseek\b/gi,
  /\bpalm\b/gi,
  /\bbard\b/gi,
  /\bAI_API_KEY\b/g,
  /\bGEMINI_[A-Z0-9_]+\b/g,
];

const USER_FACING_UNAVAILABLE =
  "Juvo AI is temporarily unavailable. Please try again shortly.";

function sanitizeModelIdentity(text) {
  if (text == null) return text;
  if (typeof text !== "string") return text;

  let next = text;
  for (const pattern of PROVIDER_MODEL_PATTERNS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, "Juvo AI");
  }

  return next.replace(/\s{2,}/g, " ").trim();
}

function toUserFacingAiError(error, fallback = USER_FACING_UNAVAILABLE) {
  const raw =
    error?.error?.message ||
    error?.message ||
    (typeof error === "string" ? error : "") ||
    "";

  const lower = String(raw).toLowerCase();
  if (
    /gemini|openai|chatgpt|claude|anthropic|grok|xai|google\s*ai|model|api[_\s-]?key|quota|rate.?limit/i.test(
      lower,
    )
  ) {
    return fallback;
  }

  const cleaned = sanitizeModelIdentity(raw);
  if (!cleaned || cleaned.length < 8) return fallback;
  if (/temporarily unavailable/i.test(cleaned)) return fallback;
  return cleaned.length > 180 ? fallback : cleaned;
}

export {
  USER_FACING_UNAVAILABLE,
  sanitizeModelIdentity,
  toUserFacingAiError,
};
