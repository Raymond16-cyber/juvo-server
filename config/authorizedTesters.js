/**
 * Private beta allowlists.
 *
 * Edit these arrays, deploy/restart the server, and testers can use JUVO
 * without running the beta CLI against your cloud database.
 *
 * CODES: single-use by default (tracked in Mongo after first redeem).
 * EMAILS: these accounts can activate their 24h window without a code.
 */

const AUTHORIZED_TESTER_EMAILS = [
  "isaacdigital001@gmail.com",
  "femisorofolapomile@gmail.com",
  "chibukeemmanuel87@gmail.com",
  "papiloprince043@gmail.com",
];

const AUTHORIZED_TESTER_CODES = [
  "JUVO-TEST-7K3M-9P2Q-4X8R",
  "JUVO-TEST-A2N5-H8J1-W6C3",
  "JUVO-TEST-M4B9-T7Y2-L5V8",
  "JUVO-TEST-Q1R6-Z3K8-P9N4",
  "JUVO-TEST-F8D2-X5C7-J3M1",
  "JUVO-TEST-W9H4-B6N2-S7K5",
  "JUVO-TEST-L3P8-V1Y6-C4R9",
  "JUVO-TEST-N7K2-M5X8-T1Q4",
  "JUVO-TEST-Y6C3-R9H5-D2P7",
  "JUVO-TEST-S4J8-K1W6-B3N9",
];

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function isAuthorizedTesterEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return AUTHORIZED_TESTER_EMAILS.map(normalizeEmail).includes(normalized);
}

function isAuthorizedTesterCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return false;
  return AUTHORIZED_TESTER_CODES.map(normalizeCode).includes(normalized);
}

export {
  AUTHORIZED_TESTER_CODES,
  AUTHORIZED_TESTER_EMAILS,
  isAuthorizedTesterCode,
  isAuthorizedTesterEmail,
  normalizeCode,
  normalizeEmail,
};
