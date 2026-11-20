import {
  confirmBehaviourFlag,
  dismissBehaviourFlag,
  getBehaviourOverviewService,
} from "../services/behaviour.service.js";

async function getBehaviourOverviewController(req, res, next) {
  try {
    const result = await getBehaviourOverviewService(req.user.id);
    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Behaviour progress retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    return next(error);
  }
}

async function confirmBehaviourFlagController(req, res, next) {
  try {
    const payload = req.body?.data || req.body || {};
    const result = await confirmBehaviourFlag(req.user.id, payload);
    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Behaviour flag confirmed.",
      data: {
        flag: result.data.flag,
        parentId: String(result.data.parent._id),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function dismissBehaviourFlagController(req, res, next) {
  try {
    const payload = req.body?.data || req.body || {};
    const result = await dismissBehaviourFlag(req.user.id, payload);
    if (!result.success) {
      return res
        .status(result.statusCode || 400)
        .json({ message: result.message });
    }

    return res.status(200).json({
      message: "Behaviour flag dismissed.",
      data: {
        flag: result.data.flag,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export {
  confirmBehaviourFlagController,
  dismissBehaviourFlagController,
  getBehaviourOverviewController,
};
