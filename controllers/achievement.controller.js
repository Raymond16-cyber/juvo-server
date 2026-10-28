import {
  getAchievementsService,
  markAchievementsCelebratedService,
  setFeaturedAchievementsService,
} from "../services/achievements/achievement.service.js";

function getUserId(user) {
  return user?.id || user?._id;
}

async function getAchievementsController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const result = await getAchievementsService(userId);
    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Achievements retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function celebrateAchievementsController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const result = await markAchievementsCelebratedService(
      userId,
      req.body?.achievementIds,
    );

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Achievements marked as celebrated.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function setFeaturedAchievementsController(req, res, next) {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    const result = await setFeaturedAchievementsService(
      userId,
      req.body?.achievementIds,
    );

    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Featured achievements updated.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

export {
  celebrateAchievementsController,
  getAchievementsController,
  setFeaturedAchievementsController,
};
