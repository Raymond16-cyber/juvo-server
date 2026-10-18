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
  console.log(today);
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

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone,
    });

    return true;
  } catch {
    return false;
  }
}

function getUserTimeZone(user) {
  const timeZone = user?.profile?.timezone;

  return isValidTimeZone(timeZone) ? timeZone : "UTC";
}

function getZonedDateParts(date, timeZone) {
  const safeTimeZone = isValidTimeZone(timeZone) ? timeZone : "UTC";

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone,
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

// THis functions changes wrong time zones to the fallback UTC time zone
function normalizeTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) {
    return "UTC";
  }

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone.trim(),
    });
    console.log("fallback timezone",timeZone)
    return timeZone.trim();
  } catch {
    return "UTC";
  }
}

export {
  getTodayBounds,
  getUserTimeZone,
  getZonedDateParts,
  zonedTimeToUtc,
  isValidTimeZone,
  normalizeTimeZone,
};
