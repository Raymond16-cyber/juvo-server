import mongoose from "mongoose";

const CATEGORIES = [
  "Performance",
  "Risk Management",
  "Discipline",
  "Psychology",
  "Consistency",
  "Journaling",
  "Custom",
];
const TARGET_TYPES = ["Percentage", "Currency", "Count", "Boolean"];
const PRIORITIES = ["Low", "Medium", "High"];
const STATUSES = ["Active", "Completed", "Failed", "Archived"];

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function validateGoalInput(payload = {}, { partial = false } = {}) {
  const errors = [];
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  const category = String(payload.category || "Custom").trim();
  const targetType = String(payload.targetType || "").trim();
  const unit = String(payload.unit || "").trim();
  const priority = String(payload.priority || "Medium").trim();
  const status = String(payload.status || "Active").trim();
  const notes = String(payload.notes || "").trim();
  const tradingAccount = String(payload.tradingAccount || "").trim();
  const targetValue = Number(payload.targetValue);
  const currentValue =
    payload.currentValue === undefined || payload.currentValue === ""
      ? 0
      : Number(payload.currentValue);

  if (!partial || payload.tradingAccount !== undefined) {
    if (!tradingAccount || !isValidObjectId(tradingAccount)) {
      errors.push("Trading account is required.");
    }
  }
  if (!partial || payload.title !== undefined) {
    if (!title) errors.push("Goal title is required.");
  }
  if (!partial || payload.targetType !== undefined) {
    if (!TARGET_TYPES.includes(targetType)) {
      errors.push("Goal target type is invalid.");
    }
  }
  if (!partial || payload.targetValue !== undefined) {
    if (!Number.isFinite(targetValue)) {
      errors.push("Goal target value is required.");
    }
  }
  if (payload.category !== undefined && !CATEGORIES.includes(category)) {
    errors.push("Goal category is invalid.");
  }
  if (payload.priority !== undefined && !PRIORITIES.includes(priority)) {
    errors.push("Goal priority is invalid.");
  }
  if (payload.status !== undefined && !STATUSES.includes(status)) {
    errors.push("Goal status is invalid.");
  }
  if (
    payload.currentValue !== undefined &&
    !Number.isFinite(currentValue)
  ) {
    errors.push("Current value must be a number.");
  }

  const startsAt = payload.startsAt ? new Date(payload.startsAt) : new Date();
  const endsAt = payload.endsAt
    ? new Date(payload.endsAt)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    errors.push("Goal dates are invalid.");
  } else if (endsAt <= startsAt) {
    errors.push("Goal end date must be after the start date.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      ...(tradingAccount ? { tradingAccount } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(payload.category !== undefined || !partial ? { category } : {}),
      ...(targetType ? { targetType } : {}),
      ...(Number.isFinite(targetValue) ? { targetValue } : {}),
      ...(payload.currentValue !== undefined || !partial
        ? { currentValue }
        : {}),
      ...(unit ? { unit } : {}),
      ...(payload.priority !== undefined || !partial ? { priority } : {}),
      ...(payload.status !== undefined ? { status } : {}),
      startsAt,
      endsAt,
      ...(notes ? { notes } : {}),
    },
  };
}

export { validateGoalInput };
