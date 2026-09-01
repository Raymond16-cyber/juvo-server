import Goal from "../models/Goals.js";
import TradingAccount from "../models/tradingAccounts.js";
import { validateGoalInput } from "../validations/goal.validation.js";

async function listGoalsService(userId) {
  const goals = await Goal.find({ user: userId })
    .populate("tradingAccount", "accountName broker currency")
    .sort({ status: 1, createdAt: -1 })
    .lean();

  return { success: true, data: goals };
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

  const goal = await Goal.findOneAndUpdate(
    { _id: goalId, user: userId },
    { $set: result.data },
    { new: true },
  ).populate("tradingAccount", "accountName broker currency");

  if (!goal) {
    return { success: false, statusCode: 404, message: "Goal not found." };
  }

  return { success: true, data: goal };
}

async function deleteGoalService(goalId, userId) {
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
