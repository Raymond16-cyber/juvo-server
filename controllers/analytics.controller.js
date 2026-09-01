import { getAnalyticsService } from "../services/analytics.service.js";

async function getAnalyticsController(req, res, next) {
  try {
    const result = await getAnalyticsService(req.user.id);
    return res.status(200).json({
      message: "Analytics retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

export { getAnalyticsController };
