import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import TradingPlan from "../models/tradingPlan.js";
import TradingStrategy from "../models/tradingStrategy.js";
import {
  buildScreenshotUrl,
  destroyTradeScreenshot,
  uploadTradeScreenshot,
} from "../config/uploadTradeScreenshot.js";
import { analyzeTradeScreenshotWithAi } from "./ai.service.js";
import {
  normalizeScreenshotReview,
  validateScreenshotFile,
} from "../utils/screenshotImage.js";

const PROCESSING_STALE_MS = 2 * 60 * 1000;

function resolveExistingScreenshotAnalysis(existing, now = Date.now()) {
  if (!existing?.status) {
    return { action: "create" };
  }

  if (existing.status === "ready") {
    if (normalizeScreenshotReview(existing.review)) {
      return { action: "return_cached" };
    }
    // Incomplete stored payload cannot be reused; allow a fresh analysis.
    return { action: "reclaim" };
  }

  if (existing.status === "processing") {
    const startedAt = existing.startedAt
      ? new Date(existing.startedAt).getTime()
      : 0;
    if (startedAt && now - startedAt < PROCESSING_STALE_MS) {
      return { action: "conflict" };
    }
    return { action: "reclaim" };
  }

  return { action: "create" };
}

function presentScreenshotAnalysis(analysis) {
  if (!analysis || analysis.status !== "ready") {
    return null;
  }

  const review = normalizeScreenshotReview(analysis.review);
  if (!review) {
    return null;
  }

  let imageUrl = null;
  let imageExpiresAt = null;

  if (analysis.publicId) {
    try {
      const signed = buildScreenshotUrl(analysis.publicId);
      imageUrl = signed.imageUrl;
      imageExpiresAt = new Date(signed.expiresAt * 1000).toISOString();
    } catch {
      imageUrl = null;
      imageExpiresAt = null;
    }
  }

  return {
    status: "ready",
    mimeType: analysis.mimeType || null,
    analyzedAt: analysis.analyzedAt || null,
    review,
    imageUrl,
    imageExpiresAt,
  };
}

function presentTradeForClient(trade) {
  if (!trade) return trade;
  const plain =
    typeof trade.toObject === "function"
      ? trade.toObject()
      : { ...trade };

  const presented = presentScreenshotAnalysis(plain.screenshotAnalysis);
  if (presented) {
    plain.screenshotAnalysis = presented;
  } else {
    delete plain.screenshotAnalysis;
  }

  return plain;
}

function compactDefined(entries) {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === "string" && !value.trim()) return false;
      if (Array.isArray(value) && !value.length) return false;
      return true;
    }),
  );
}

function buildTradeContextPayload({
  trade,
  journal,
  strategy,
  plan,
}) {
  return compactDefined({
    symbol: trade.symbol,
    instrument: trade.instrument,
    direction: trade.direction,
    status: trade.status,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    lotSize: trade.lotSize,
    riskPercentage: trade.riskPercentage,
    plannedRR: trade.plannedRR,
    achievedRR: trade.achievedRR,
    profitLoss: trade.profitLoss,
    profitLossCurrency: trade.profitLossCurrency,
    session: trade.session,
    notes: trade.notes,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    psychology: journal?.psychology
      ? compactDefined({
          beforeTrading: journal.psychology.beforeTrading,
          afterTrading: journal.psychology.afterTrading,
          confidenceBefore: journal.psychology.confidenceBefore,
          confidenceAfter: journal.psychology.confidenceAfter,
        })
      : undefined,
    strategy: strategy
      ? compactDefined({
          name: strategy.name,
          description: strategy.description,
          prerequisites: strategy.prerequisites,
          timeframe: strategy.timeframe,
          session: strategy.session,
          notes: strategy.notes,
        })
      : undefined,
    plan: plan
      ? compactDefined({
          name: plan.name,
          maxRiskPerTrade: plan.maxRiskPerTrade,
          maxDailyTrades: plan.maxDailyTrades,
          maxDailyLoss: plan.maxDailyLoss,
          minimumRR: plan.minimumRR,
          allowedSessions: plan.allowedSessions,
        })
      : undefined,
  });
}

async function loadStrategyContext(journal) {
  let strategy = null;
  let plan = null;

  if (journal?.tradingStrategy) {
    strategy = await TradingStrategy.findById(journal.tradingStrategy)
      .select("name description prerequisites timeframe session notes")
      .lean();
  }

  if (journal?.tradingPlan) {
    plan = await TradingPlan.findById(journal.tradingPlan)
      .select(
        "name maxRiskPerTrade maxDailyTrades maxDailyLoss minimumRR allowedSessions strategy",
      )
      .lean();

    if (!strategy && plan?.strategy) {
      strategy = await TradingStrategy.findById(plan.strategy)
        .select("name description prerequisites timeframe session notes")
        .lean();
    }
  }

  return { strategy, plan };
}

async function findOwnedTrade(journalId, tradeId, userId) {
  const journal = await Journal.findOne({ _id: journalId, user: userId })
    .select("_id psychology tradingPlan tradingStrategy")
    .lean();

  if (!journal) {
    return {
      success: false,
      statusCode: 404,
      message: "Journal not found.",
    };
  }

  const trade = await Trade.findOne({
    _id: tradeId,
    journal: journalId,
    user: userId,
  });

  if (!trade) {
    return {
      success: false,
      statusCode: 404,
      message: "Trade not found.",
    };
  }

  return { success: true, journal, trade };
}

async function getTradeScreenshotReviewService(journalId, tradeId, userId) {
  const owned = await findOwnedTrade(journalId, tradeId, userId);
  if (!owned.success) return owned;

  const presented = presentScreenshotAnalysis(owned.trade.screenshotAnalysis);
  if (!presented) {
    return {
      success: false,
      statusCode: 404,
      message: "No screenshot review is saved for this trade.",
    };
  }

  return {
    success: true,
    data: {
      tradeId: String(owned.trade._id),
      ...presented,
    },
  };
}

async function clearProcessingLock(tradeId, userId, publicId) {
  if (publicId) {
    try {
      await destroyTradeScreenshot(publicId);
    } catch (error) {
      console.error("Failed to destroy orphaned trade screenshot:", error?.message || error);
    }
  }

  await Trade.updateOne(
    { _id: tradeId, user: userId },
    {
      $unset: { screenshotAnalysis: 1 },
    },
  );
}

async function analyzeTradeScreenshotService({
  journalId,
  tradeId,
  userId,
  file,
}) {
  const validation = validateScreenshotFile(file);
  if (!validation.ok) {
    return { success: false, statusCode: 400, message: validation.message };
  }

  const owned = await findOwnedTrade(journalId, tradeId, userId);
  if (!owned.success) return owned;

  const decision = resolveExistingScreenshotAnalysis(
    owned.trade.screenshotAnalysis,
  );

  if (decision.action === "return_cached") {
    const presented = presentScreenshotAnalysis(owned.trade.screenshotAnalysis);
    return {
      success: true,
      reused: true,
      data: {
        tradeId: String(owned.trade._id),
        ...presented,
      },
      message: "Saved screenshot review loaded.",
    };
  }

  if (decision.action === "conflict") {
    return {
      success: false,
      statusCode: 409,
      message: "Screenshot analysis is already in progress for this trade.",
    };
  }

  if (decision.action === "reclaim") {
    if (owned.trade.screenshotAnalysis?.publicId) {
      try {
        await destroyTradeScreenshot(owned.trade.screenshotAnalysis.publicId);
      } catch (error) {
        console.error(
          "Failed to destroy stale trade screenshot:",
          error?.message || error,
        );
      }
    }

    // Clear a broken ready/processing document so the atomic claim can proceed.
    await Trade.updateOne(
      {
        _id: tradeId,
        journal: journalId,
        user: userId,
        "screenshotAnalysis.status": {
          $in: ["ready", "processing", "failed"],
        },
      },
      { $unset: { screenshotAnalysis: 1 } },
    );
  }

  const claim = await Trade.findOneAndUpdate(
    {
      _id: tradeId,
      journal: journalId,
      user: userId,
      $or: [
        { "screenshotAnalysis.status": { $exists: false } },
        { "screenshotAnalysis.status": { $nin: ["ready", "processing"] } },
        {
          "screenshotAnalysis.status": "processing",
          "screenshotAnalysis.startedAt": {
            $lte: new Date(Date.now() - PROCESSING_STALE_MS),
          },
        },
      ],
    },
    {
      $set: {
        screenshotAnalysis: {
          status: "processing",
          startedAt: new Date(),
        },
      },
    },
    { new: true },
  );

  if (!claim) {
    const latest = await Trade.findOne({
      _id: tradeId,
      journal: journalId,
      user: userId,
    }).select("screenshotAnalysis");

    const presented = presentScreenshotAnalysis(latest?.screenshotAnalysis);
    if (presented) {
      return {
        success: true,
        reused: true,
        data: {
          tradeId: String(latest._id),
          ...presented,
        },
        message: "Saved screenshot review loaded.",
      };
    }

    return {
      success: false,
      statusCode: 409,
      message: "Screenshot analysis is already in progress for this trade.",
    };
  }

  let uploadedPublicId = null;

  try {
    const uploaded = await uploadTradeScreenshot(file);
    uploadedPublicId = uploaded.publicId;

    await Trade.updateOne(
      { _id: tradeId, user: userId },
      {
        $set: {
          "screenshotAnalysis.publicId": uploaded.publicId,
          "screenshotAnalysis.mimeType": validation.mimeType,
          "screenshotAnalysis.bytes": uploaded.bytes,
          "screenshotAnalysis.status": "processing",
        },
      },
    );

    const { strategy, plan } = await loadStrategyContext(owned.journal);
    const tradeContext = buildTradeContextPayload({
      trade: claim,
      journal: owned.journal,
      strategy,
      plan,
    });

    // Prefer the latest closed values if the trade was closed between claim and analyze.
    const latestTrade = await Trade.findOne({
      _id: tradeId,
      journal: journalId,
      user: userId,
    }).lean();
    const analysisContext = buildTradeContextPayload({
      trade: latestTrade || claim,
      journal: owned.journal,
      strategy,
      plan,
    });

    const aiResult = await analyzeTradeScreenshotWithAi({
      imageBuffer: file.buffer,
      mimeType: validation.mimeType,
      tradeContext: analysisContext || tradeContext,
    });

    if (!aiResult.success) {
      await clearProcessingLock(tradeId, userId, uploadedPublicId);
      return {
        success: false,
        statusCode: aiResult.statusCode || 502,
        message: aiResult.message || "Unable to analyze the screenshot.",
      };
    }

    const analyzedAt = new Date();
    const saved = await Trade.findOneAndUpdate(
      { _id: tradeId, user: userId },
      {
        $set: {
          screenshotAnalysis: {
            publicId: uploadedPublicId,
            mimeType: validation.mimeType,
            bytes: uploaded.bytes,
            status: "ready",
            startedAt: claim.screenshotAnalysis?.startedAt || analyzedAt,
            analyzedAt,
            review: aiResult.review,
          },
        },
        // Keep a string reference for export/history consumers that already read screenshots[].
        $addToSet: { screenshots: uploadedPublicId },
      },
      { new: true },
    );

    if (!saved) {
      await clearProcessingLock(tradeId, userId, uploadedPublicId);
      return {
        success: false,
        statusCode: 500,
        message: "Unable to save the screenshot review.",
      };
    }

    const presented = presentScreenshotAnalysis(saved.screenshotAnalysis);
    return {
      success: true,
      reused: false,
      data: {
        tradeId: String(saved._id),
        ...presented,
      },
      message: "Screenshot review saved.",
    };
  } catch (error) {
    await clearProcessingLock(tradeId, userId, uploadedPublicId);
    console.error(
      "Screenshot review failed:",
      error?.message || error,
    );
    return {
      success: false,
      statusCode: 500,
      message: "Unable to analyze the screenshot right now.",
    };
  }
}

export {
  PROCESSING_STALE_MS,
  analyzeTradeScreenshotService,
  buildTradeContextPayload,
  getTradeScreenshotReviewService,
  presentScreenshotAnalysis,
  presentTradeForClient,
  resolveExistingScreenshotAnalysis,
};
