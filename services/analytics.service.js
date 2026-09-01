import BehaviouralInsight from "../models/behaviouralInsights.js";
import Journal from "../models/Journal.js";
import TradingAccount from "../models/tradingAccounts.js";

function percent(part, whole) {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(1));
}

function round(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

async function getAnalyticsService(userId) {
  const [journals, accounts, storedInsights] = await Promise.all([
    Journal.find({ user: userId })
      .select(
        "journalDate status psychology review discipline ai trades tradingAccount createdAt",
      )
      .populate(
        "trades",
        "symbol instrument direction status profitLoss plannedRR achievedRR session openedAt closedAt riskPercentage",
      )
      .populate("tradingAccount", "accountName broker currency currentBalance")
      .sort({ journalDate: 1 })
      .lean(),
    TradingAccount.find({ userId, isArchived: false }).lean(),
    BehaviouralInsight.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
  ]);

  const trades = journals.flatMap((journal) =>
    (journal.trades || []).map((trade) => ({
      ...trade,
      journalDate: journal.journalDate,
      journalId: journal._id,
    })),
  );
  const closedTrades = trades.filter(
    (trade) => trade.status === "Closed" || trade.status === "Breakeven",
  );
  const wins = closedTrades.filter((trade) => Number(trade.profitLoss || 0) > 0);
  const losses = closedTrades.filter((trade) => Number(trade.profitLoss || 0) < 0);
  const netPnl = trades.reduce(
    (total, trade) => total + Number(trade.profitLoss || 0),
    0,
  );
  const avgRr = closedTrades.length
    ? closedTrades.reduce(
        (total, trade) =>
          total + Number(trade.achievedRR || trade.plannedRR || 0),
        0,
      ) / closedTrades.length
    : 0;
  const avgRisk = trades.length
    ? trades.reduce((total, trade) => total + Number(trade.riskPercentage || 0), 0) /
      trades.length
    : 0;

  const bySymbol = {};
  const bySession = {};
  const byDirection = { long: { trades: 0, pnl: 0 }, short: { trades: 0, pnl: 0 } };

  trades.forEach((trade) => {
    const symbol = trade.symbol || "UNKNOWN";
    const session = trade.session || "Unspecified";
    bySymbol[symbol] ??= { symbol, trades: 0, pnl: 0, wins: 0 };
    bySymbol[symbol].trades += 1;
    bySymbol[symbol].pnl += Number(trade.profitLoss || 0);
    if (Number(trade.profitLoss || 0) > 0) bySymbol[symbol].wins += 1;

    bySession[session] ??= { session, trades: 0, pnl: 0, wins: 0 };
    bySession[session].trades += 1;
    bySession[session].pnl += Number(trade.profitLoss || 0);
    if (Number(trade.profitLoss || 0) > 0) bySession[session].wins += 1;

    const direction = trade.direction === "short" ? "short" : "long";
    byDirection[direction].trades += 1;
    byDirection[direction].pnl += Number(trade.profitLoss || 0);
  });

  let running = 0;
  const equityCurve = journals.map((journal) => {
    const dayPnl = (journal.trades || []).reduce(
      (total, trade) => total + Number(trade.profitLoss || 0),
      0,
    );
    running += dayPnl;
    return {
      date: journal.journalDate,
      label: new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
      }).format(new Date(journal.journalDate)),
      pnl: round(dayPnl),
      equity: round(running),
      trades: journal.trades?.length || 0,
    };
  });

  const disciplineScores = journals
    .map((journal) => journal.discipline?.score)
    .filter((score) => Number.isFinite(score));
  const avgDiscipline = disciplineScores.length
    ? disciplineScores.reduce((total, score) => total + score, 0) /
      disciplineScores.length
    : 0;

  const revengeDays = journals.filter(
    (journal) => journal.discipline?.revengeTraded,
  ).length;
  const overtradeDays = journals.filter(
    (journal) => journal.discipline?.overTraded,
  ).length;
  const planDays = journals.filter(
    (journal) => journal.discipline?.followedTradingPlan,
  ).length;

  const computedInsights = [
    {
      title: "Plan adherence",
      body: journals.length
        ? `You marked the plan as followed on ${planDays} of ${journals.length} journaled days.`
        : "Start journaling to measure how often you follow the plan.",
      score: percent(planDays, journals.length || 1),
      category: "discipline",
    },
    {
      title: "Revenge trading pressure",
      body: revengeDays
        ? `${revengeDays} session${revengeDays === 1 ? "" : "s"} included revenge trading. Size and stop after the first emotional impulse.`
        : "No revenge-trading flags in completed journals. Keep the cool-down rule.",
      score: Math.max(0, 100 - percent(revengeDays, journals.length || 1)),
      category: "psychology",
    },
    {
      title: "Session quality",
      body:
        Object.values(bySession).sort((a, b) => b.pnl - a.pnl)[0]?.session
          ? `${Object.values(bySession).sort((a, b) => b.pnl - a.pnl)[0].session} is your strongest session by net P/L.`
          : "Log session tags on trades so Juvo can rank your windows.",
      score: Math.round(avgDiscipline || percent(wins.length, closedTrades.length || 1)),
      category: "session",
    },
  ];

  const insights = storedInsights.length
    ? storedInsights.map((insight) => ({
        _id: insight._id,
        title: insight.title,
        body: insight.body,
        score: insight.score ?? 0,
        category: insight.category,
        source: insight.source,
        createdAt: insight.createdAt,
      }))
    : computedInsights;

  const startingBalance = accounts.reduce(
    (total, account) => total + Number(account.currentBalance || 0),
    0,
  );

  return {
    success: true,
    data: {
      summary: {
        journals: journals.length,
        trades: trades.length,
        openTrades: trades.filter((trade) => trade.status === "Open").length,
        closedTrades: closedTrades.length,
        netPnl: round(netPnl),
        winRate: percent(wins.length, closedTrades.length),
        avgRr: round(avgRr),
        avgRisk: round(avgRisk),
        avgDiscipline: round(avgDiscipline, 1),
        wins: wins.length,
        losses: losses.length,
        revengeDays,
        overtradeDays,
      },
      equityCurve,
      bySymbol: Object.values(bySymbol)
        .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
        .slice(0, 8)
        .map((item) => ({
          ...item,
          pnl: round(item.pnl),
          winRate: percent(item.wins, item.trades),
        })),
      bySession: Object.values(bySession).map((item) => ({
        ...item,
        pnl: round(item.pnl),
        winRate: percent(item.wins, item.trades),
      })),
      byDirection: {
        long: {
          ...byDirection.long,
          pnl: round(byDirection.long.pnl),
        },
        short: {
          ...byDirection.short,
          pnl: round(byDirection.short.pnl),
        },
      },
      insights,
      accounts: accounts.map((account) => ({
        _id: account._id,
        accountName: account.accountName,
        broker: account.broker,
        currency: account.currency,
        currentBalance: account.currentBalance,
        currentEquity: account.currentEquity,
        profitTarget: account.profitTarget,
        maxDrawnDown: account.maxDrawnDown,
        isConnected: account.isConnected,
      })),
      startingBalance: round(startingBalance),
    },
  };
}

export { getAnalyticsService };
