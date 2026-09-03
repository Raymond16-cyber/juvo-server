import {
  activateTradingAccountService,
  createTradingAccountService,
  deleteTradingAccountService,
  getTradingAccountByIdService,
  getUserTradingAccountsService,
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

    return res.status(400).json({
      message: createTradingAccountResult.message || "Failed to create trading account.",
    });
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
    const tradingAccounts = await getUserTradingAccountsService(userId);
    return res.status(200).json({
      message: tradingAccounts.length
        ? "Trading accounts retrieved successfully."
        : "No trading accounts found for the user.",
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

const getTradingAccountByIdController = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { accountId } = req.params;
    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }

    const result = await getTradingAccountByIdService(accountId, userId);
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        message: result.message,
      });
    }

    return res.status(200).json({
      message: "Trading account retrieved successfully.",
      data: result.data,
    });
  } catch (err) {
    next(err);
  }
};

const activateTradingAccountController = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { accountId } = req.params;
    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }

    const result = await activateTradingAccountService(accountId, userId);
    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        message: result.message,
      });
    }

    return res.status(200).json({
      message: "Trading account set as active.",
      data: result.data,
    });
  } catch (err) {
    next(err);
  }
};

export {
  activateTradingAccountController,
  createTradingAccountController,
  deleteTradingAccountController,
  getTradingAccountByIdController,
  getUserTradingAccountsController,
};
