import Journal from "../models/Journal.js";

async function getTodayJournalStatusService(userId, startOfDay, endOfDay) {
  try {
    const journal = await Journal.findOne({
      user: userId,
      journalDate: { $gte: startOfDay, $lte: endOfDay },
    })
      .select("_id journalDate status tradingAccount createdAt updatedAt")
      .lean();

    return {
      success: true,
      data: {
        hasJournalToday: Boolean(journal),
        journal,
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function createJournalService(data, res, userId) {
  const result = validateJournalInput(data);

  if (!result.isValid) {
    const error = new Error(result.errors.join(" "));
    res.status(400).json({
      message: result.errors.join(" "),
    });
  }
}

export { createJournalService, getTodayJournalStatusService };
