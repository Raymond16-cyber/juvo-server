import Goal from "../models/Goals.js";
import TradingAccount from "../models/tradingAccounts.js";
import { validateGoalInput } from "../validations/goal.validation.js";
import { getReviewedObservationCounts } from "./behaviour.service.js";

async function listGoalsService(userId) {
  const goals = await Goal.find({ user: userId })
    .populate("tradingAccount", "accountName broker currency accountCurrency")
    .sort({ status: 1, createdAt: -1 })
    .lean();

  const challenges = [
    ...new Set(
      goals
        .map((goal) => goal.behaviorChallenge)
        .filter((challenge) => typeof challenge === "string"),
    ),
  ];
  const reviewedCounts = await getReviewedObservationCounts(userId, challenges);
  const data = goals.map((goal) =>
    goal.behaviorChallenge
      ? {
          ...goal,
          currentValue: Math.min(
            Number(goal.targetValue || 0),
            reviewedCounts.get(goal.behaviorChallenge) || 0,
          ),
          progressSource: "reviewed_observations",
        }
      : goal,
  );

  return { success: true, data };
}

async function createGoalService(data, userId) {
  const result = validateGoalInput(data);

  if (!result.isValid) {
    return { success: false, statusCode: 400, message: result.errors.join(" ") };
  }

  const account = await TradingAccount.findOne({
    _id: result.data.tradingAccount,
    userId,
  });

  if (!account) {
    return {
      success: false,
      statusCode: 404,
      message: "Trading account not found.",
    };
  }

  const goal = await Goal.create({
    user: userId,
    ...result.data,
  });

  return { success: true, data: goal };
}

async function updateGoalService(goalId, data, userId) {
  const result = validateGoalInput(data, { partial: true });

  if (!result.isValid) {
    return { success: false, statusCode: 400, message: result.errors.join(" ") };
  }

  const existing = await Goal.findOne({ _id: goalId, user: userId })
    .select("autoManaged startsAt endsAt")
    .lean();
  if (!existing) {
    return { success: false, statusCode: 404, message: "Goal not found." };
  }
  const updates = { ...result.data };
  const startsAt = updates.startsAt || existing.startsAt;
  const endsAt = updates.endsAt || existing.endsAt;
  if (
    startsAt &&
    endsAt &&
    new Date(endsAt).getTime() <= new Date(startsAt).getTime()
  ) {
    return {
      success: false,
      statusCode: 400,
      message: "Goal end date must be after the start date.",
    };
  }
  if (existing.autoManaged && updates.status === "Archived") {
    updates.behaviorPausedAt = new Date();
  } else if (existing.autoManaged && updates.status === "Active") {
    updates.behaviorPausedAt = null;
  }

  const goal = await Goal.findOneAndUpdate(
    { _id: goalId, user: userId },
    { $set: updates },
    { new: true, runValidators: true },
  ).populate("tradingAccount", "accountName broker currency accountCurrency");

  if (!goal) {
    return { success: false, statusCode: 404, message: "Goal not found." };
  }

  let responseGoal = goal.toObject();
  if (goal.behaviorChallenge) {
    const reviewedCounts = await getReviewedObservationCounts(userId, [
      goal.behaviorChallenge,
    ]);
    responseGoal = {
      ...responseGoal,
      currentValue: Math.min(
        Number(goal.targetValue || 0),
        reviewedCounts.get(goal.behaviorChallenge) || 0,
      ),
      progressSource: "reviewed_observations",
    };
  }

  return { success: true, data: responseGoal };
}

async function deleteGoalService(goalId, userId) {
  const existing = await Goal.findOne({ _id: goalId, user: userId })
    .select("autoManaged")
    .lean();
  if (existing?.autoManaged) {
    return {
      success: false,
      statusCode: 409,
      message: "Pause this behaviour-linked objective instead of removing it.",
    };
  }
  const goal = await Goal.findOneAndDelete({ _id: goalId, user: userId });

  if (!goal) {
    return { success: false, statusCode: 404, message: "Goal not found." };
  }

  return { success: true, data: { _id: goalId } };
}

export {
  createGoalService,
  deleteGoalService,
  listGoalsService,
  updateGoalService,
};
