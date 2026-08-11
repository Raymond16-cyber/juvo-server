async function createJournalService(data, res, userId) {
  const result = validateJournalInput(data);

  if (!result.isValid) {
    const error = new Error(result.errors.join(" "));
    res.status(400).json({
      message: result.errors.join(" "),
    });
  }
}

export { createJournalService };
