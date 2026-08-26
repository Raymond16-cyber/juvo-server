const PROFILE_EXPERIENCE_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
  "professional",
];
const PROFILE_TRADING_STYLES = [
  "scalping",
  "day_trading",
  "swing_trading",
  "position_trading",
];
const PROFILE_INSTRUMENTS = [
  "forex",
  "stocks",
  "crypto",
  "commodities",
  "indices",
  "futures",
];
const PROFILE_CHALLENGES = [
  "fomo",
  "revenge_trading",
  "overtrading",
  "impatience",
  "poor_risk_management",
  "emotional_trading",
  "lack_of_discipline",
  "inconsistent_strategy",
];
const THEME_OPTIONS = ["light", "dark", "system"];
const WEEK_START_OPTIONS = ["sunday", "monday"];

function validateOnboardingInput(payload) {
  const errors = [];
  const data = {
    country: (payload.country || "").trim(),
    timezone: (payload.timezone || "").trim(),
    experienceLevel: (payload.experienceLevel || "").trim(),
    tradingStyle: (payload.tradingStyle || "").trim(),
    instruments: Array.isArray(payload.instruments) ? payload.instruments : [],
    biggestChallenges: Array.isArray(payload.biggestChallenges)
      ? payload.biggestChallenges
      : [],
    theme: (payload.theme || "").trim(),
    preferredCurrency: (payload.preferredCurrency || "").trim(),
    weekStartsOn: (payload.weekStartsOn || "").trim(),
    notificationsEnabled:
      payload.notificationsEnabled === undefined
        ? undefined
        : Boolean(payload.notificationsEnabled),
    reminderTime: (payload.reminderTime || "").trim(),
    pushToken: (payload.pushToken || "").trim(),
    currentStep:
      payload.currentStep === undefined
        ? undefined
        : Number(payload.currentStep),
  };

  if (!data.country) errors.push("Country is required.");
  if (!data.timezone) errors.push("Timezone is required.");

  if (!data.experienceLevel) {
    errors.push("Experience level is required.");
  } else if (!PROFILE_EXPERIENCE_LEVELS.includes(data.experienceLevel)) {
    errors.push("Experience level is invalid.");
  }

  if (
    data.tradingStyle &&
    !PROFILE_TRADING_STYLES.includes(data.tradingStyle)
  ) {
    errors.push("Trading style is invalid.");
  }

  if (!Array.isArray(data.instruments) || data.instruments.length === 0) {
    errors.push("At least one instrument is required.");
  } else if (
    data.instruments.some(
      (instrument) => !PROFILE_INSTRUMENTS.includes(instrument),
    )
  ) {
    errors.push("One or more instruments are invalid.");
  }

  if (
    Array.isArray(payload.biggestChallenges) &&
    payload.biggestChallenges.some(
      (challenge) => !PROFILE_CHALLENGES.includes(challenge),
    )
  ) {
    errors.push("One or more challenges are invalid.");
  }

  if (data.theme && !THEME_OPTIONS.includes(data.theme)) {
    errors.push("Theme is invalid.");
  }

  if (!data.preferredCurrency) errors.push("Preferred currency is required.");

  if (data.weekStartsOn && !WEEK_START_OPTIONS.includes(data.weekStartsOn)) {
    errors.push("Week start day is invalid.");
  }

  if (
    data.reminderTime &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.reminderTime)
  ) {
    errors.push("Reminder time must be in HH:MM format.");
  }

  if (data.pushToken && data.pushToken.length < 10) {
    errors.push("Push token is invalid.");
  }

  if (
    data.currentStep !== undefined &&
    (Number.isNaN(data.currentStep) || data.currentStep < 0)
  ) {
    errors.push("Current step is invalid.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data,
  };
}

export { validateOnboardingInput };
