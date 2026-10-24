import User from "../models/User.js";

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

function normalizeIds(value) {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    !value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.trim().length <= 100,
    )
  ) {
    return null;
  }

  return [...new Set(value.map((item) => item.trim()))];
}

export async function getDashboardGuide(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select("dashboardGuide");

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.status(200).json({
      dashboardGuide: user.dashboardGuide,
    });
  } catch (error) {
    return next(error);
  }
}

export async function updateDashboardGuide(req, res, next) {
  try {
    const body = req.body ?? {};
    const updates = {};

    for (const field of ["dismissedHints", "completedChecklist"]) {
      if (!hasOwn(body, field)) continue;

      const ids = normalizeIds(body[field]);

      if (ids === null) {
        return res.status(400).json({
          message: `${field} must be an array of valid IDs.`,
        });
      }

      updates[`dashboardGuide.${field}`] = ids;
    }

    if (hasOwn(body, "tourCompleted")) {
      if (typeof body.tourCompleted !== "boolean") {
        return res.status(400).json({
          message: "tourCompleted must be a boolean.",
        });
      }

      updates["dashboardGuide.tourCompleted"] = body.tourCompleted;

      updates["dashboardGuide.completedAt"] = body.tourCompleted
        ? new Date()
        : null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "No valid dashboard-guide fields were provided.",
      });
    }

    updates["dashboardGuide.updatedAt"] = new Date();

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
      },
    ).select("dashboardGuide");

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    return res.status(200).json({
      message: "Dashboard guide saved successfully.",
      dashboardGuide: user.dashboardGuide,
    });
  } catch (error) {
    return next(error);
  }
}
