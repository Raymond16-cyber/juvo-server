import { getUserTradingAccounts } from "../repositories/tradingAccountRepo.js";
import {
  createTradingAccountService,
  deleteTradingAccountService,
} from "../services/tradingAccountService.js";

const createTradingAccountController = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { data } = req.body;
    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }

    const createTradingAccountResult = await createTradingAccountService(
      data,
      res,
      userId,
    );

    if (createTradingAccountResult.success) {
      return res.status(201).json({
        message: "Trading account created successfully.",
        data: createTradingAccountResult.data,
      });
    }
  } catch (err) {
    next(err);
  }
};

const getUserTradingAccountsController = async (req, res, next) => {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }
    const tradingAccounts = await getUserTradingAccounts(userId);
    if (!tradingAccounts || tradingAccounts.length === 0) {
      return res.status(404).json({
        message: "No trading accounts found for the user.",
      });
    }
    return res.status(200).json({
      message: "Trading accounts retrieved successfully.",
      data: tradingAccounts,
    });
  } catch (err) {
    next(err);
  }
};

const deleteTradingAccountController = async (req, res, next) => {
  const userId = req.user.id;
  const { accountId } = req.params;
  if (!userId) {
    return res.status(400).json({
      message: "User is not signed in.",
    });
  }
  const result = await deleteTradingAccountService(accountId, userId);
  if (result.success) {
    return res.status(200).json({
      message: "Trading account deleted successfully.",
      accountId
    });
  } else {
    return res.status(400).json({
      message: result.message || "Failed to delete trading account.",
    });
  }
};

export {
  createTradingAccountController,
  getUserTradingAccountsController,
  deleteTradingAccountController,
};
