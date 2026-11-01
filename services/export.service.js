import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import TradingAccount from "../models/tradingAccounts.js";
import User from "../models/User.js";
import { getAnalyticsService } from "./analytics.service.js";
import { getUserJournalsService } from "./journal.service.js";
import { resolveReportingCurrency } from "./currency/currency.utils.js";
import { getUserTimeZone } from "../utils/timezone.js";

function parseDate(value, name) {
  if (value === undefined || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${name} must use YYYY-MM-DD format.`);
    error.status = 400;
    error.code = "EXPORT_DATE_INVALID";
    throw error;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    const error = new Error(`${name} is not a valid date.`);
    error.status = 400;
    error.code = "EXPORT_DATE_INVALID";
    throw error;
  }
  return date;
}

function resolveRange(query = {}) {
  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");
  if (from && to && from > to) {
    const error = new Error("from must be on or before to.");
    error.status = 400;
    error.code = "EXPORT_DATE_RANGE_INVALID";
    throw error;
  }
  if (to) to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

function inRange(value, range) {
  if (!range.from && !range.to) return true;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) &&
    (!range.from || date >= range.from) &&
    (!range.to || date <= range.to);
}

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return fallback;
  return String(value);
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function accountValue(account, key) {
  return account && typeof account === "object" ? account[key] : null;
}

function relationId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value._id ? String(value._id) : null;
}

async function buildExportData(userId, query) {
  const range = resolveRange(query);
  const accountId = query.accountId ? String(query.accountId) : null;
  if (accountId && !/^[a-f\d]{24}$/i.test(accountId)) {
    const error = new Error("accountId is invalid.");
    error.status = 400;
    error.code = "EXPORT_ACCOUNT_INVALID";
    throw error;
  }
  const [user, journalResult, analyticsResult, accounts] = await Promise.all([
    User.findById(userId).select("fullName email profile.timezone preferences.reportingCurrency").lean(),
    getUserJournalsService(userId, { includeExportFields: true }),
    getAnalyticsService(userId, accountId, range),
    TradingAccount.find({ userId, isArchived: { $ne: true } })
      .select("accountName broker accountType currency accountCurrency currentBalance currentEquity status isActive")
      .lean(),
  ]);
  if (!user || !journalResult?.success || !analyticsResult?.success) {
    const error = new Error("Unable to prepare export data.");
    error.status = 500;
    throw error;
  }
  if (
    accountId &&
    !accounts.some((account) => String(account._id) === accountId)
  ) {
    const error = new Error("Trading account not found.");
    error.status = 404;
    error.code = "EXPORT_ACCOUNT_NOT_FOUND";
    throw error;
  }

  const journals = journalResult.data.filter((journal) =>
    inRange(journal.journalDate, range) &&
    (!accountId ||
      relationId(journal.tradingAccount) === accountId ||
      (journal.trades || []).some(
        (trade) => relationId(trade.tradingAccount) === accountId,
      )),
  );
  const trades = journals.flatMap((journal) =>
    (journal.trades || []).map((trade) => ({
      ...trade,
      journalDate: journal.journalDate,
      journalId: journal._id,
      journalAccount: journal.tradingAccount,
    })),
  );
  const analytics = analyticsResult.data;

  return {
    user,
    journals,
    trades,
    accounts,
    analytics,
    reportingCurrency: resolveReportingCurrency(user),
    timeZone: getUserTimeZone(user),
    range,
    generatedAt: new Date(),
  };
}

function displayDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function filenameDate(date) {
  return date.toISOString().slice(0, 10);
}

function rangeLabel(range) {
  return range.from || range.to
    ? `${displayDate(range.from) || "start"} to ${displayDate(range.to) || "present"}`
    : "All available records";
}

function tradeRows(data) {
  return data.trades.map((trade) => {
    const account = trade.tradingAccount || trade.journalAccount;
    return [
      displayDate(trade.journalDate || trade.openedAt || trade.createdAt),
      safeText(trade.symbol),
      safeText(trade.instrument),
      safeText(trade.direction),
      safeText(trade.status),
      numberOrNull(trade.entryPrice),
      numberOrNull(trade.exitPrice),
      numberOrNull(trade.stopLoss),
      numberOrNull(trade.takeProfit),
      numberOrNull(trade.lotSize),
      numberOrNull(trade.riskPercentage),
      numberOrNull(trade.profitLoss),
      safeText(trade.profitLossCurrency || accountValue(account, "currency")),
      numberOrNull(trade.profitLossReporting),
      numberOrNull(trade.plannedRR),
      numberOrNull(trade.achievedRR),
      safeText(trade.session),
      safeText(trade.notes),
    ];
  });
}

function journalRows(data) {
  return data.journals.map((journal) => [
    displayDate(journal.journalDate),
    safeText(journal.status),
    (journal.trades || []).length,
    safeText(journal.psychology?.beforeTrading),
    safeText(journal.psychology?.afterTrading),
    safeText(journal.review?.whatWentWell),
    safeText(journal.review?.whatCouldImprove),
    safeText(journal.review?.lessonsLearned),
    safeText(journal.discipline?.followedTradingPlan),
    safeText(journal.discipline?.followedRiskManagement),
    numberOrNull(journal.totalProfitLossReporting),
  ]);
}

function accountRows(data) {
  return data.accounts.map((account) => [
    safeText(account.accountName),
    safeText(account.broker),
    safeText(account.accountType),
    safeText(account.currency || account.accountCurrency),
    safeText(account.status),
    Boolean(account.isActive),
    numberOrNull(account.currentBalance),
    numberOrNull(account.currentEquity),
  ]);
}

function addWorksheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map(([header, key, width]) => ({ header, key, width }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1220" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + columns.length)}1` };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    }
  });
  return sheet;
}

export async function buildExcelExport(userId, query = {}) {
  const data = await buildExportData(userId, query);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JUVO";
  workbook.created = data.generatedAt;

  const overview = workbook.addWorksheet("Overview");
  overview.columns = [{ width: 30 }, { width: 28 }];
  [
    ["JUVO Trading Data Export", ""],
    ["User", safeText(data.user.fullName)],
    ["Email", safeText(data.user.email)],
    ["Generated", data.generatedAt],
    ["Reporting period", rangeLabel(data.range)],
    ["Reporting currency", data.reportingCurrency],
    ["Total journals", data.journals.length],
    ["Total trades", data.trades.length],
    ["Net P/L", numberOrNull(data.analytics.summary?.netPnl)],
    ["Win rate", numberOrNull(data.analytics.summary?.winRate)],
    ["Wins", numberOrNull(data.analytics.summary?.wins)],
    ["Losses", numberOrNull(data.analytics.summary?.losses)],
    ["Max drawdown", numberOrNull(data.analytics.summary?.maxDrawdown)],
    ["Average RR", numberOrNull(data.analytics.summary?.avgRr)],
  ].forEach((row) => overview.addRow(row));
  overview.getRow(1).font = { bold: true, size: 16, color: { argb: "FF00A8CC" } };
  overview.getColumn(2).numFmt = "0.00";

  addWorksheet(workbook, "Trade History", [
    ["Date", "date", 14], ["Symbol", "symbol", 14], ["Instrument", "instrument", 16],
    ["Direction", "direction", 12], ["Status", "status", 12], ["Entry", "entry", 14],
    ["Exit", "exit", 14], ["Stop Loss", "stopLoss", 14], ["Take Profit", "takeProfit", 14],
    ["Lot Size", "lotSize", 12], ["Risk %", "risk", 12], ["Native P/L", "nativePnl", 14],
    ["Currency", "currency", 12], ["Reporting P/L", "reportingPnl", 16], ["Planned RR", "plannedRr", 14],
    ["Achieved RR", "achievedRr", 14], ["Session", "session", 14], ["Notes", "notes", 36],
  ], tradeRows(data));
  addWorksheet(workbook, "Journal Entries", [
    ["Date", "date", 14], ["Status", "status", 14], ["Trades", "trades", 10],
    ["Before Trading", "before", 28], ["After Trading", "after", 28],
    ["What Went Well", "well", 28], ["What Could Improve", "improve", 28],
    ["Lessons Learned", "lessons", 28], ["Plan Followed", "plan", 16],
    ["Risk Managed", "risk", 16], ["Reporting P/L", "pnl", 16],
  ], journalRows(data));
  addWorksheet(workbook, "Trading Accounts", [
    ["Account Name", "name", 24], ["Broker", "broker", 18], ["Account Type", "type", 16],
    ["Currency", "currency", 12], ["Status", "status", 14], ["Active", "active", 10],
    ["Balance", "balance", 16], ["Equity", "equity", 16],
  ], accountRows(data));
  addWorksheet(workbook, "Performance Analytics", [
    ["Metric", "metric", 28], ["Value", "value", 22],
  ], Object.entries(data.analytics.summary || {}).filter(([, value]) => typeof value !== "object"));

  return workbook.xlsx.writeBuffer();
}

function pdfText(value) {
  return safeText(value).replace(/[^\x20-\x7E\n]/g, "");
}

export async function writePdfExport(userId, query, response) {
  const data = await buildExportData(userId, query);
  const doc = new PDFDocument({ margin: 42, size: "A4", bufferPages: true });
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Cache-Control", "no-store");
  doc.pipe(response);

  const heading = (title) => {
    doc.moveDown(0.8).fontSize(15).fillColor("#0b1220").text(title);
    doc.moveDown(0.25).strokeColor("#00a8cc").lineWidth(1).moveTo(42, doc.y).lineTo(553, doc.y).stroke();
    doc.moveDown(0.5).fillColor("#111827");
  };
  const row = (label, value) => doc.fontSize(9).fillColor("#4b5563").text(`${label}: `, { continued: true }).fillColor("#111827").text(pdfText(value));

  doc.fontSize(24).fillColor("#0b1220").text("JUVO");
  doc.fontSize(18).fillColor("#111827").text("Trading Journal & Performance Report");
  doc.moveDown(0.5);
  row("Trader", data.user.fullName);
  row("Generated", data.generatedAt.toISOString());
  row("Reporting period", rangeLabel(data.range));
  row("Reporting currency", data.reportingCurrency);

  heading("Trading overview");
  const summary = data.analytics.summary || {};
  [
    ["Total journals", data.journals.length], ["Total trades", data.trades.length],
    ["Wins", summary.wins], ["Losses", summary.losses], ["Win rate", summary.winRate],
    ["Net P/L", summary.netPnl], ["Profit factor", summary.profitFactor],
    ["Average RR", summary.avgRr], ["Maximum drawdown", summary.maxDrawdown],
  ].forEach(([label, value]) => row(label, value ?? "Unavailable"));

  heading("Trade history");
  const headers = ["Date", "Symbol", "Direction", "Status", "Entry", "Exit", "P/L"];
  const widths = [62, 82, 65, 60, 75, 75, 70];
  const drawTradeHeader = () => {
    let x = 42;
    doc.fontSize(8).fillColor("#ffffff");
    doc.rect(42, doc.y, 511, 18).fill("#0b1220");
    headers.forEach((header, index) => {
      doc.fillColor("#ffffff").text(header, x + 4, doc.y + 5, { width: widths[index] - 8 });
      x += widths[index];
    });
    doc.y += 22;
  };
  drawTradeHeader();
  for (const trade of data.trades) {
    if (doc.y > 750) {
      doc.addPage();
      drawTradeHeader();
    }
    const values = [
      displayDate(trade.journalDate || trade.openedAt), safeText(trade.symbol),
      safeText(trade.direction), safeText(trade.status), numberOrNull(trade.entryPrice) ?? "",
      numberOrNull(trade.exitPrice) ?? "", numberOrNull(trade.profitLoss) ?? "",
    ];
    let x = 42;
    const y = doc.y;
    values.forEach((value, index) => {
      doc.fontSize(7.5).fillColor("#374151").text(pdfText(value), x + 4, y, { width: widths[index] - 8 });
      x += widths[index];
    });
    doc.y = y + 18;
  }
  if (!data.trades.length) doc.fontSize(10).fillColor("#4b5563").text("No trade records are available for this period.");

  heading("Journal entries");
  for (const journal of data.journals) {
    if (doc.y > 720) doc.addPage();
    doc.fontSize(10).fillColor("#111827").text(`${displayDate(journal.journalDate)} · ${pdfText(journal.status)}`);
    doc.fontSize(8.5).fillColor("#4b5563").text(`Trades: ${(journal.trades || []).length} · P/L: ${journal.totalProfitLossReporting ?? "Unavailable"}`);
    doc.moveDown(0.25);
    const lesson = journal.review?.lessonsLearned || journal.review?.whatCouldImprove || "No review note recorded.";
    doc.text(pdfText(lesson), { width: 510 });
    doc.moveDown(0.45);
  }
  if (!data.journals.length) doc.fontSize(10).text("No journal entries are available for this period.");

  heading("Trading accounts");
  data.accounts.forEach((account) => row(
    safeText(account.accountName, "Account"),
    `${safeText(account.broker)} · ${safeText(account.currency || account.accountCurrency)} · ${safeText(account.status)}`,
  ));
  if (!data.accounts.length) doc.fontSize(10).text("No trading accounts are available.");

  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(index);
    doc.fontSize(8).fillColor("#6b7280").text(`JUVO · Page ${index + 1} of ${pages.count}`, 42, 806, { align: "center", width: 511 });
  }
  doc.end();
}

export { filenameDate };
