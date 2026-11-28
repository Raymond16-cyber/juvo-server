export function derivePlannedRR({
  direction,
  entryPrice,
  stopLoss,
  takeProfit,
}) {
  if (
    !["long", "short"].includes(direction) ||
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLoss) ||
    !Number.isFinite(takeProfit)
  ) {
    return undefined;
  }

  const validLevels =
    direction === "long"
      ? stopLoss < entryPrice && takeProfit > entryPrice
      : stopLoss > entryPrice && takeProfit < entryPrice;
  if (!validLevels) return undefined;

  return Number(
    (Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss)).toFixed(4),
  );
}
