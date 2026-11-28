const SESSION_WINDOWS = [
  { session: "New York", timeZone: "America/New_York", start: 8, end: 17 },
  { session: "London", timeZone: "Europe/London", start: 8, end: 17 },
  { session: "Tokyo", timeZone: "Asia/Tokyo", start: 9, end: 18 },
  { session: "Asian", timeZone: "Australia/Sydney", start: 8, end: 17 },
];

export function inferTradingSession(timestamp) {
  if (timestamp == null || timestamp === "") return undefined;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;

  for (const window of SESSION_WINDOWS) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: window.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type === "hour" || part.type === "minute");
    const localMinutes =
      Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 +
      Number(parts.find((part) => part.type === "minute")?.value || 0);

    if (
      localMinutes >= window.start * 60 &&
      localMinutes < window.end * 60
    ) {
      return window.session;
    }
  }

  return "Asian";
}
