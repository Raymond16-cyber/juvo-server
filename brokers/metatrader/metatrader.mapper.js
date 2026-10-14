import { connectorError as metaError } from "./metatrader.security.js";

const numeric = (value) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const protectiveLevel = (value) => value === 0 ? undefined : numeric(value);
const date = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value) : undefined;
const clean = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
export function tradeOrigin(reason) {
  if (reason?.endsWith("_EXPERT")) return "ea";
  if (/_REASON_(CLIENT|MOBILE|WEB)$/.test(reason || "")) return "manual";
  return "unknown";
}

export function mapMetaAccount(info, connection) {
  // Native account currency never inherits the user's reporting currency.
  const currency = info?.currency?.trim().toUpperCase();
  if (!currency || !info.login || numeric(info.balance) === undefined || numeric(info.equity) === undefined) {
    throw metaError("ACCOUNT_INCOMPLETE", "Waiting for the broker account currency and balances.", 409);
  }
  if (!/^[A-Z]{3,8}$/.test(currency)) throw metaError("CURRENCY", "The broker returned an unsupported currency identifier.", 409);
  return clean({ accountName: `${info.broker || connection.server} ${String(info.login).slice(-4)}`,
    accountNumber: String(info.login), accountType: info.type === "ACCOUNT_TRADE_MODE_DEMO" ? "demo" : info.type === "ACCOUNT_TRADE_MODE_CONTEST" ? "challenge" : "live",
    broker: info.broker || connection.server, server: info.server || connection.server, platform: connection.platform,
    currency, accountCurrency: currency, currentBalance: info.balance, currentEquity: info.equity,
    margin: numeric(info.margin), freeMargin: numeric(info.freeMargin), leverage: numeric(info.leverage) === undefined ? "Unknown" : `1:${info.leverage}`,
    isConnected: true, lastSyncedAt: new Date() });
}

export function mapMetaPosition(position, connection) {
  if (!position?.id || !position.symbol || !["POSITION_TYPE_BUY", "POSITION_TYPE_SELL"].includes(position.type)) return null;
  return clean({ provider: "metatrader", platform: connection.platform, externalAccountId: connection.externalAccountId,
    externalPositionId: `${connection.externalAccountId}:${position.id}`, externalTicket: String(position.id),
    symbol: position.symbol, direction: position.type === "POSITION_TYPE_BUY" ? "long" : "short",
    volume: numeric(position.volume), lotSize: numeric(position.volume), entryPrice: numeric(position.openPrice),
    stopLoss: protectiveLevel(position.stopLoss), takeProfit: protectiveLevel(position.takeProfit), swap: numeric(position.swap),
    openedAt: date(position.time), brokerUpdatedAt: date(position.updateTime), status: "open", syncedAt: new Date(),
    comment: position.comment?.slice(0, 256), brokerMetadata: clean({ magic: position.magic, comment: position.comment?.slice(0, 256), origin: tradeOrigin(position.reason) }) });
}

export function liveMetaPosition(position) {
  const gross = numeric(position.profit);
  return clean({ currentPrice: numeric(position.currentPrice), grossUnrealizedPnl: gross,
    pnlTimestamp: Date.now(), quoteTimestamp: date(position.updateTime)?.getTime(), floatingPnlIsIndicative: false });
}

export function pickHistoryEvent(value) {
  const keys = ["id", "type", "entryType", "symbol", "magic", "time", "doneTime", "updateTime", "volume", "price", "openPrice", "commission", "swap", "fee", "profit", "positionId", "orderId", "comment", "platform", "reason", "stopLoss", "takeProfit", "state"];
  return clean(Object.fromEntries(keys.map((key) => [key, key === "comment" ? value[key]?.slice(0, 256) : value[key]])));
}

function instrument(symbol) {
  if (/^(XAU|XAG|WTI|BRENT)/i.test(symbol)) return "commodities";
  if (/^(BTC|ETH|SOL)/i.test(symbol)) return "crypto";
  if (/^(EUR|USD|GBP|AUD|NZD|CAD|CHF|JPY)(EUR|USD|GBP|AUD|NZD|CAD|CHF|JPY)/i.test(symbol)) return "forex";
  return "others";
}

export function normalizeMetaDeals(deals, connection) {
  const unique = [...new Map(deals.map((deal) => [String(deal.id), deal])).values()];
  unique.sort((a, b) => new Date(a.time) - new Date(b.time) || String(a.id).localeCompare(String(b.id), "en", { numeric: true }));
  const inventories = new Map();
  const trades = [];
  let incomplete = 0;
  for (const deal of unique) {
    if (!["DEAL_TYPE_BUY", "DEAL_TYPE_SELL"].includes(deal.type)) continue;
    const volume = numeric(deal.volume);
    const price = numeric(deal.price);
    const time = date(deal.time);
    if (!deal.positionId || !deal.symbol || !time || !volume || price === undefined) { incomplete++; continue; }
    const key = String(deal.positionId);
    let inventory = inventories.get(key);
    const isIn = deal.entryType === "DEAL_ENTRY_IN";
    const reversal = deal.entryType === "DEAL_ENTRY_INOUT";
    const isOut = ["DEAL_ENTRY_OUT", "DEAL_ENTRY_OUT_BY"].includes(deal.entryType);
    if (!isIn && !isOut && !reversal) { incomplete++; continue; }
    let remaining = volume;
    if (isOut || reversal) {
      if (!inventory || inventory.volume <= 1e-8 || (!reversal && volume > inventory.volume + 1e-8)) { incomplete++; continue; }
      const closed = Math.min(volume, inventory.volume);
      const ratio = closed / inventory.volume;
      const commission = (numeric(deal.commission) || 0) * (reversal ? closed / volume : 1) + inventory.commission * ratio;
      const swap = (numeric(deal.swap) || 0) + inventory.swap * ratio;
      if (numeric(deal.profit) === undefined) { incomplete++; continue; }
      const fee = (numeric(deal.fee) || 0) * (reversal ? closed / volume : 1) + (inventory.fee || 0) * ratio;
      const profitLoss = Number((deal.profit + commission + swap + fee).toFixed(8));
      trades.push(clean({ source: "metatrader", platform: connection.platform,
        externalId: `${connection.tradingAccount || connection.externalAccountId}:deal:${deal.id}`, externalDealId: String(deal.id),
        externalPositionId: key, externalOrderId: deal.orderId == null ? undefined : String(deal.orderId),
        symbol: deal.symbol, instrument: instrument(deal.symbol), direction: inventory.direction,
        entryPrice: inventory.price, exitPrice: price, lotSize: closed, openedAt: inventory.openedAt, closedAt: time,
        stopLoss: protectiveLevel(deal.stopLoss) ?? inventory.stopLoss, takeProfit: protectiveLevel(deal.takeProfit) ?? inventory.takeProfit,
        profitLoss, commission, swap, fee, status: profitLoss === 0 ? "Breakeven" : "Closed",
        brokerMetadata: clean({ magic: deal.magic ?? inventory.magic, comment: deal.comment?.slice(0, 256), origin: inventory.origin,
          partialClose: closed < inventory.volume - 1e-8 }) }));
      inventory.volume -= closed;
      inventory.commission *= 1 - ratio;
      inventory.swap *= 1 - ratio;
      inventory.fee = (inventory.fee || 0) * (1 - ratio);
      remaining -= closed;
      if (inventory.volume <= 1e-8) { inventories.delete(key); inventory = undefined; }
    }
    if ((isIn || reversal) && remaining > 1e-8) {
      const direction = deal.type === "DEAL_TYPE_BUY" ? "long" : "short";
      if (inventory && inventory.direction !== direction) { incomplete++; continue; }
      const previous = inventory?.volume || 0;
      inventories.set(key, { volume: previous + remaining, price: ((inventory?.price || 0) * previous + price * remaining) / (previous + remaining),
        direction, openedAt: inventory?.openedAt || time,
        commission: (inventory?.commission || 0) + (numeric(deal.commission) || 0) * remaining / volume,
        swap: (inventory?.swap || 0) + (isIn ? numeric(deal.swap) || 0 : 0),
        fee: (inventory?.fee || 0) + (numeric(deal.fee) || 0) * remaining / volume,
        stopLoss: protectiveLevel(deal.stopLoss), takeProfit: protectiveLevel(deal.takeProfit), magic: deal.magic, origin: inventory?.origin || tradeOrigin(deal.reason) });
    }
  }
  return { trades, incomplete };
}
