import TradingAccount from "../models/tradingAccounts.js";
import { createTradingAccount } from "../repositories/tradingAccountRepo.js";
import { findUserById } from "../repositories/userRepository.js";
import { validateTradingAccountInput } from "../validations/tradingAccountValidation.js";

async function createTradingAccountService(data, res, userId) {
  const result = validateTradingAccountInput(data);

  if (!result.isValid) {
    return {
      success: false,
      message: result.errors.join(" "),
    };
  }

  const user = await findUserById(userId);
  if (!user) {
    return {
      success: false,
      message: "User not found.",
    };
  }

  const tradingAccount = await createTradingAccount(result.data, userId);

  return {
    success: true,
    data: tradingAccount,
  };
}

async function deleteTradingAccountService(accountId, userId) {
  const user = await findUserById(userId);

  if (!user) {
    return {
      success: false,
      message: "User not found.",
    };
  }

  const tradingAccount = await TradingAccount.findOneAndDelete({
    _id: accountId,
    userId,
  });

  if (!tradingAccount) {
    return {
      success: false,
      message: "Trading account not found.",
    };
  }

  return {
    success: true,
    message: "Trading account deleted successfully.",
  };
}

export { createTradingAccountService, deleteTradingAccountService };
