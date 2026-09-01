function getZonedDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function zonedTimeToUtc(
  { year, month, day, hour, minute, second, millisecond },
  timeZone,
) {
  const utcGuess = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(utcGuess))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    millisecond,
  );

  return new Date(utcGuess - (zonedAsUtc - utcGuess));
}

function getTodayBounds(timeZone = "UTC") {
  const today = getZonedDateParts(new Date(), timeZone);

  return {
    startOfDay: zonedTimeToUtc(
      { ...today, hour: 0, minute: 0, second: 0, millisecond: 0 },
      timeZone,
    ),
    endOfDay: zonedTimeToUtc(
      { ...today, hour: 23, minute: 59, second: 59, millisecond: 999 },
      timeZone,
    ),
  };
}

function getUserTimeZone(user) {
  return user?.profile?.timezone || "UTC";
}

export { getTodayBounds, getUserTimeZone, getZonedDateParts, zonedTimeToUtc };
