/**
 * Authoritative achievement definitions for JUVO.
 * Qualification logic lives in achievement.service.js; this file is the catalog only.
 */

const TIERS = Object.freeze({
  bronze: "bronze",
  silver: "silver",
  gold: "gold",
  platinum: "platinum",
});

const CATEGORIES = Object.freeze({
  journey: "journey",
  journaling: "journaling",
  consistency: "consistency",
  trading_records: "trading_records",
  discipline: "discipline",
});

const ACHIEVEMENTS = Object.freeze([
  // —— JUVO Journey (account age from createdAt) ——
  {
    id: "journey_7_days",
    category: CATEGORIES.journey,
    tier: TIERS.bronze,
    title: "First Week",
    description: "Joined JUVO seven days ago.",
    criteriaLabel: "Account age reaches 7 days",
    icon: "calendar-check",
    threshold: 7,
    metric: "account_age_days",
  },
  {
    id: "journey_30_days",
    category: CATEGORIES.journey,
    tier: TIERS.silver,
    title: "One Month In",
    description: "Joined JUVO thirty days ago.",
    criteriaLabel: "Account age reaches 30 days",
    icon: "calendar-days",
    threshold: 30,
    metric: "account_age_days",
  },
  {
    id: "journey_100_days",
    category: CATEGORIES.journey,
    tier: TIERS.gold,
    title: "Hundred Days",
    description: "Joined JUVO one hundred days ago.",
    criteriaLabel: "Account age reaches 100 days",
    icon: "calendar-range",
    threshold: 100,
    metric: "account_age_days",
  },
  {
    id: "journey_365_days",
    category: CATEGORIES.journey,
    tier: TIERS.platinum,
    title: "Full Year",
    description: "Joined JUVO one year ago.",
    criteriaLabel: "Account age reaches 365 days",
    icon: "award",
    threshold: 365,
    metric: "account_age_days",
  },

  // —— Journaling ——
  {
    id: "first_journal",
    category: CATEGORIES.journaling,
    tier: TIERS.bronze,
    title: "First Journal",
    description: "Recorded your first meaningful journal entry or no-trade day.",
    criteriaLabel: "1 qualifying journaling day",
    icon: "notebook-pen",
    threshold: 1,
    metric: "qualifying_days",
  },
  {
    id: "consistent_recorder",
    category: CATEGORIES.journaling,
    tier: TIERS.silver,
    title: "Consistent Recorder",
    description: "Journaled on seven distinct days.",
    criteriaLabel: "7 distinct qualifying journaling days",
    icon: "book-open",
    threshold: 7,
    metric: "qualifying_days",
  },
  {
    id: "long_term_learner",
    category: CATEGORIES.journaling,
    tier: TIERS.platinum,
    title: "Long-Term Learner",
    description: "Journaled on one hundred distinct days.",
    criteriaLabel: "100 distinct qualifying journaling days",
    icon: "library",
    threshold: 100,
    metric: "qualifying_days",
  },
  {
    id: "reflective_trader",
    category: CATEGORIES.journaling,
    tier: TIERS.gold,
    title: "Reflective Trader",
    description: "Completed ten end-of-day journal reviews.",
    criteriaLabel: "10 journals marked Completed",
    icon: "message-square-quote",
    threshold: 10,
    metric: "completed_reviews",
  },
  {
    id: "no_trade_wisdom",
    category: CATEGORIES.journaling,
    tier: TIERS.silver,
    title: "No-Trade Wisdom",
    description: "Explicitly recorded ten no-trade days.",
    criteriaLabel: "10 confirmed no-trade days",
    icon: "shield-off",
    threshold: 10,
    metric: "no_trade_days",
  },

  // —— Consistency (streaks — uses journal streak service stats) ——
  {
    id: "streak_7",
    category: CATEGORIES.consistency,
    tier: TIERS.silver,
    title: "Week of Fire",
    description: "Kept a seven-day qualifying journaling streak.",
    criteriaLabel: "Longest streak reaches 7 consecutive days",
    icon: "flame",
    threshold: 7,
    metric: "longest_streak",
  },
  {
    id: "streak_30",
    category: CATEGORIES.consistency,
    tier: TIERS.gold,
    title: "Month of Fire",
    description: "Kept a thirty-day qualifying journaling streak.",
    criteriaLabel: "Longest streak reaches 30 consecutive days",
    icon: "flame",
    threshold: 30,
    metric: "longest_streak",
  },

  // —— Trading Records ——
  {
    id: "journal_builder",
    category: CATEGORIES.trading_records,
    tier: TIERS.silver,
    title: "Journal Builder",
    description: "Documented twenty-five trades in your journal.",
    criteriaLabel: "25 properly journaled trades",
    icon: "candlestick-chart",
    threshold: 25,
    metric: "trade_count",
  },
  {
    id: "journal_archivist",
    category: CATEGORIES.trading_records,
    tier: TIERS.platinum,
    title: "Journal Archivist",
    description: "Documented one hundred trades in your journal.",
    criteriaLabel: "100 properly journaled trades",
    icon: "archive",
    threshold: 100,
    metric: "trade_count",
  },

  // —— Discipline ——
  {
    id: "plan_reviewer",
    category: CATEGORIES.discipline,
    tier: TIERS.bronze,
    title: "Plan Reviewer",
    description: "Answered plan-follow questions on ten completed reviews.",
    criteriaLabel: "10 journals with plan-follow recorded",
    icon: "clipboard-check",
    threshold: 10,
    metric: "plan_answered_count",
  },
  {
    id: "risk_guardian",
    category: CATEGORIES.discipline,
    tier: TIERS.silver,
    title: "Risk Guardian",
    description: "Marked risk management as followed on twenty-five reviews.",
    criteriaLabel: "25 journals with followedRiskManagement = true",
    icon: "shield-check",
    threshold: 25,
    metric: "risk_followed_count",
  },
  {
    id: "plan_adherent_90",
    category: CATEGORIES.discipline,
    tier: TIERS.gold,
    title: "Plan Adherent",
    description:
      "Followed your trading plan on at least 90% of reviewed days (minimum 20 evaluated).",
    criteriaLabel: "≥90% plan adherence after 20+ evaluated journals",
    icon: "target",
    threshold: 90,
    metric: "plan_adherence_pct",
    minSample: 20,
  },
]);

const ACHIEVEMENT_BY_ID = Object.freeze(
  Object.fromEntries(ACHIEVEMENTS.map((item) => [item.id, item])),
);

function getAchievementDefinition(id) {
  return ACHIEVEMENT_BY_ID[id] || null;
}

function listAchievementDefinitions() {
  return ACHIEVEMENTS.slice();
}

export {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  CATEGORIES,
  TIERS,
  getAchievementDefinition,
  listAchievementDefinitions,
};
