import {
  createGoalService,
  deleteGoalService,
  listGoalsService,
  updateGoalService,
} from "../services/goal.service.js";

async function listGoalsController(req, res, next) {
  try {
    const result = await listGoalsService(req.user.id);
    return res.status(200).json({
      message: "Goals retrieved successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function createGoalController(req, res, next) {
  try {
    const result = await createGoalService(
      req.body?.data || req.body,
      req.user.id,
    );

    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }

    return res.status(201).json({
      message: "Goal created successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function updateGoalController(req, res, next) {
  try {
    const result = await updateGoalService(
      req.params.goalId,
      req.body?.data || req.body,
      req.user.id,
    );

    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }

    return res.status(200).json({
      message: "Goal updated successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteGoalController(req, res, next) {
  try {
    const result = await deleteGoalService(req.params.goalId, req.user.id);

    if (!result.success) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }

    return res.status(200).json({
      message: "Goal deleted successfully.",
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
}

export {
  createGoalController,
  deleteGoalController,
  listGoalsController,
  updateGoalController,
};
