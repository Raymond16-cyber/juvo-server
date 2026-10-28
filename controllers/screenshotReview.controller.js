import {
  analyzeTradeScreenshotService,
  getTradeScreenshotReviewService,
} from "../services/screenshotReview.service.js";

function getUserId(user) {
  return user?.id || user?._id;
}

async function analyzeTradeScreenshotController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const { journalId, tradeId } = req.params;
    const result = await analyzeTradeScreenshotService({
      journalId,
      tradeId,
      userId,
      file: req.file,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(result.reused ? 200 : 201).json({
      success: true,
      message: result.message,
      data: result.data,
      reused: Boolean(result.reused),
    });
  } catch (error) {
    return next(error);
  }
}

async function getTradeScreenshotReviewController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const { journalId, tradeId } = req.params;
    const result = await getTradeScreenshotReviewService(
      journalId,
      tradeId,
      userId,
    );

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Screenshot review retrieved.",
      data: result.data,
    });
  } catch (error) {
    return next(error);
  }
}

export {
  analyzeTradeScreenshotController,
  getTradeScreenshotReviewController,
};
