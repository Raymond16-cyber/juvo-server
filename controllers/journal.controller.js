import { createJournalService } from "../services/journal.service.js";

async function createJournalController(req, res, next) {
  try {
    const userId = req.user.id;
    const { data } = req.body;
    if (!userId) {
      return res.status(400).json({
        message: "User is not signed in.",
      });
    }

    const createJournalResult = await createJournalService(data, res, userId);

    if (createJournalResult.success) {
      return res.status(201).json({
        message: "Journal created successfully.",
        data: createJournalResult.data,
      });
    }
  } catch (err) {
    next(err);
  }
}

export { createJournalController };
