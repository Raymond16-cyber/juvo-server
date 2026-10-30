import {
  getTodayNoTradeDayService,
  liftNoTradeDayService,
  upsertNoTradeDayService,
} from "../services/noTradeDay.service.js";

function getUserId(user) {
  return user?.id || user?._id;
}

async function getTodayNoTradeDayController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const result = await getTodayNoTradeDayService(userId);
    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "No-trade day status retrieved.",
      data: result.data,
    });
  } catch (error) {
    return next(error);
  }
}

async function upsertNoTradeDayController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const result = await upsertNoTradeDayService(
      userId,
      req.body?.data || req.body || {},
    );

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.data.message,
      data: result.data,
      created: result.created,
      newlyEarned: result.newlyEarned || [],
    });
  } catch (error) {
    return next(error);
  }
}

async function liftNoTradeDayController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const result = await liftNoTradeDayService(
      userId,
      req.body?.data || req.body || {},
    );

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: result.data.message,
      data: result.data,
    });
  } catch (error) {
    return next(error);
  }
}

export {
  getTodayNoTradeDayController,
  liftNoTradeDayController,
  upsertNoTradeDayController,
};
