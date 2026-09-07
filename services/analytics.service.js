import BehaviouralInsight from "../models/behaviouralInsights.js";
import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import TradingAccount from "../models/tradingAccounts.js";

function percent(part, whole) {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(1));
}

function round(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

async function getAnalyticsService(userId, tradingAccountId) {
  const accounts = await TradingAccount.find({
    userId,
    isArchived: false,
  }).lean();
  const selectedAccount = tradingAccountId
    ? accounts.find(
        (account) => String(account._id) === String(tradingAccountId),
      )
    : null;
  const scopedAccounts = selectedAccount ? [selectedAccount] : accounts;

  const journalQuery = { user: userId };
  if (selectedAccount) {
    const accountTradeJournalIds = await Trade.find({
      user: userId,
      tradingAccount: selectedAccount._id,
    }).distinct("journal");
    journalQuery.$or = [
      { tradingAccount: selectedAccount._id },
      { _id: { $in: accountTradeJournalIds } },
    ];
  }

  const journals = await Journal.find(journalQuery)
    .select(
      "journalDate status psychology review discipline ai trades tradingAccount createdAt",
    )
    .populate(
      "trades",
      "symbol instrument direction status profitLoss plannedRR achievedRR session openedAt closedAt riskPercentage tradingAccount",
    )
    .populate("tradingAccount", "accountName broker currency currentBalance")
    .sort({ journalDate: 1 })
    .lean();

  const journalIds = journals.map((journal) => journal._id);
  const storedInsights = await BehaviouralInsight.find({
    user: userId,
    ...(journalIds.length
      ? { journal: { $in: journalIds } }
      : { _id: { $exists: false } }),
  })
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();

  const trades = journals.flatMap((journal) =>
    (journal.trades || [])
      .filter(
        (trade) =>
          !selectedAccount ||
          String(
            trade.tradingAccount?._id ||
              trade.tradingAccount ||
              journal.tradingAccount?._id ||
              journal.tradingAccount,
          ) === String(selectedAccount._id),
      )
      .map((trade) => ({
        ...trade,
        journalDate: journal.journalDate,
        journalId: journal._id,
      })),
  );
  const closedTrades = trades.filter(
    (trade) => trade.status === "Closed" || trade.status === "Breakeven",
  );
  const wins = closedTrades.filter(
    (trade) => Number(trade.profitLoss || 0) > 0,
  );
  const losses = closedTrades.filter(
    (trade) => Number(trade.profitLoss || 0) < 0,
  );
  const netPnl = trades.reduce(
    (total, trade) => total + Number(trade.profitLoss || 0),
    0,
  );
  const grossProfit = closedTrades.reduce(
    (total, trade) =>
      total + Math.max(0, Number(trade.profitLoss || 0)),
    0,
  );
  const grossLoss = closedTrades.reduce(
    (total, trade) =>
      total + Math.min(0, Number(trade.profitLoss || 0)),
    0,
  );
  const profitFactor = grossLoss ? grossProfit / Math.abs(grossLoss) : 0;
  const avgRr = closedTrades.length
    ? closedTrades.reduce(
        (total, trade) =>
          total + Number(trade.achievedRR || trade.plannedRR || 0),
        0,
      ) / closedTrades.length
    : 0;
  const avgRisk = trades.length
    ? trades.reduce(
        (total, trade) => total + Number(trade.riskPercentage || 0),
        0,
      ) / trades.length
    : 0;

  const bySymbol = {};
  const bySession = {};
  const byDirection = {
    long: { trades: 0, closedTrades: 0, pnl: 0, wins: 0, losses: 0 },
    short: { trades: 0, closedTrades: 0, pnl: 0, wins: 0, losses: 0 },
  };

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
    if (trade.status === "Closed" || trade.status === "Breakeven") {
      byDirection[direction].closedTrades += 1;
      if (Number(trade.profitLoss || 0) > 0) byDirection[direction].wins += 1;
      if (Number(trade.profitLoss || 0) < 0) byDirection[direction].losses += 1;
    }
  });

  let running = scopedAccounts.reduce(
    (total, account) => total + Number(account.initialBalance || 0),
    0,
  );
  let peakEquity = running;
  let maxDrawdown = 0;
  const equityCurve = journals.map((journal) => {
    const journalTrades = (journal.trades || []).filter(
      (trade) =>
        !selectedAccount ||
        String(
          trade.tradingAccount?._id ||
            trade.tradingAccount ||
            journal.tradingAccount?._id ||
            journal.tradingAccount,
        ) === String(selectedAccount._id),
    );
    const dayPnl = journalTrades.reduce(
      (total, trade) => total + Number(trade.profitLoss || 0),
      0,
    );
    running += dayPnl;
    peakEquity = Math.max(peakEquity, running);
    maxDrawdown = Math.max(maxDrawdown, peakEquity - running);
    return {
      date: journal.journalDate,
      label: new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
      }).format(new Date(journal.journalDate)),
      pnl: round(dayPnl),
      equity: round(running),
      trades: journalTrades.length,
    };
  });
  const recoveryFactor = maxDrawdown ? netPnl / maxDrawdown : 0;

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
      body: Object.values(bySession).sort((a, b) => b.pnl - a.pnl)[0]?.session
        ? `${Object.values(bySession).sort((a, b) => b.pnl - a.pnl)[0].session} is your strongest session by net P/L.`
        : "Log session tags on trades so Juvo can rank your windows.",
      score: Math.round(
        avgDiscipline || percent(wins.length, closedTrades.length || 1),
      ),
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

  const bestSession =
    Object.values(bySession).sort((a, b) => b.pnl - a.pnl)[0] || null;
  const worstSession =
    Object.values(bySession).sort((a, b) => a.pnl - b.pnl)[0] || null;
  const activeCurrencies = Array.from(
    new Set(scopedAccounts.map((account) => account.currency || "USD")),
  );
  const startingBalance = scopedAccounts.reduce(
    (total, account) => total + Number(account.initialBalance || 0),
    0,
  );

  return {
    success: true,
    data: {
      currency: selectedAccount?.currency || activeCurrencies[0] || "USD",
      currencyMode: activeCurrencies.length > 1 ? "mixed" : "single",
      tradingAccount: selectedAccount
        ? {
            _id: selectedAccount._id,
            accountName: selectedAccount.accountName,
            broker: selectedAccount.broker,
            currency: selectedAccount.currency,
            status: selectedAccount.status || "Active",
            isActive: Boolean(selectedAccount.isActive),
          }
        : null,
      summary: {
        journals: journals.length,
        trades: trades.length,
        openTrades: trades.filter((trade) => trade.status === "Open").length,
        closedTrades: closedTrades.length,
        netPnl: round(netPnl),
        winRate: percent(wins.length, closedTrades.length),
        profitFactor: round(profitFactor),
        recoveryFactor: round(recoveryFactor),
        grossProfit: round(grossProfit),
        grossLoss: round(grossLoss),
        maxDrawdown: round(maxDrawdown),
        avgRr: round(avgRr),
        avgRisk: round(avgRisk),
        avgDiscipline: round(avgDiscipline, 1),
        wins: wins.length,
        losses: losses.length,
        revengeDays,
        overtradeDays,
        bestSession: bestSession
          ? {
              session: bestSession.session,
              trades: bestSession.trades,
              pnl: round(bestSession.pnl),
              winRate: percent(bestSession.wins, bestSession.trades),
            }
          : null,
        worstSession: worstSession
          ? {
              session: worstSession.session,
              trades: worstSession.trades,
              pnl: round(worstSession.pnl),
              winRate: percent(worstSession.wins, worstSession.trades),
            }
          : null,
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
          winRate: percent(
            byDirection.long.wins,
            byDirection.long.closedTrades,
          ),
        },
        short: {
          ...byDirection.short,
          pnl: round(byDirection.short.pnl),
          winRate: percent(
            byDirection.short.wins,
            byDirection.short.closedTrades,
          ),
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
        isActive: Boolean(account.isActive),
        status: account.status || "Active",
        tradesCount: account.trades?.length || 0,
      })),
      startingBalance: round(startingBalance),
    },
  };
}

export { getAnalyticsService };
