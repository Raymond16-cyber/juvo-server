import "../config/loadEnv.js";
import { GoogleGenAI } from "@google/genai";
import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Journal from "../models/Journal.js";
import Goal from "../models/Goals.js";
import "../models/PlanSuggestion.js";
import TradingPlan from "../models/tradingPlan.js";
import "../models/Trades.js";
import User from "../models/User.js";
import { createPlanSuggestionService } from "./tradingPlan.service.js";
import {
  resolveReportingCurrency,
  resolveTradeCurrency,
} from "./currency/currency.utils.js";
import {
  JUVO_CHAT_SYSTEM_INSTRUCTIONS,
  JUVO_JOURNAL_ANALYSIS_INSTRUCTIONS,
  JUVO_SCREENSHOT_REVIEW_INSTRUCTIONS,
} from "../prompts/aiPrompts.js";
import {
  USER_FACING_UNAVAILABLE,
  sanitizeModelIdentity,
  toUserFacingAiError,
} from "../utils/sanitizeModelIdentity.js";
import { normalizeScreenshotReview } from "../utils/screenshotImage.js";

const MODEL = "gemini-3.5-flash-lite";
const SCREENSHOT_ANALYSIS_TIMEOUT_MS = 55_000;

function readApiKey() {
  const raw = process.env.AI_API_KEY || "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

function getClient() {
  const apiKey = readApiKey();

  if (!apiKey) {
    return null;
  }

  return new GoogleGenAI({ apiKey });
}

function readGeminiText(response) {
  try {
    const direct = String(response?.text || "").trim();
    if (direct) return direct;
  } catch {
    // Some Gemini responses throw from the text getter. Read parts instead.
  }

  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function geminiErrorMessage(error) {
  // Server logs only — may include provider details.
  return (
    error?.error?.message ||
    error?.message ||
    "Juvo AI upstream request failed."
  );
}

function userFacingAiFailure(error, fallback = USER_FACING_UNAVAILABLE) {
  return toUserFacingAiError(error, fallback);
}

function parseJsonText(text) {
  if (!text) return null;

  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function toGeminiRequest(messages = []) {
  const systemParts = [];
  const contents = [];

  messages.forEach((message) => {
    const text = String(message.content || "").trim();
    if (!text) return;

    if (message.role === "system") {
      systemParts.push(text);
      return;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text }],
    });
  });

  return {
    systemInstruction: systemParts.join("\n\n"),
    contents,
  };
}

async function completeWithGemini(messages) {
  const client = getClient();

  if (!client) {
    return {
      success: false,
      statusCode: 503,
      message: "Juvo AI is temporarily unavailable.",
    };
  }

  const { systemInstruction, contents } = toGeminiRequest(messages);

  if (!contents.length) {
    return {
      success: false,
      statusCode: 400,
      message: "Message is required.",
    };
  }

  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction,
      },
    });

    const text = sanitizeModelIdentity(readGeminiText(response));

    if (!text) {
      return {
        success: false,
        statusCode: 502,
        message: "Juvo AI returned an empty reply.",
      };
    }

    return {
      success: true,
      text,
    };
  } catch (error) {
    console.error("Juvo AI upstream error:", geminiErrorMessage(error));
    return {
      success: false,
      statusCode: 502,
      message: userFacingAiFailure(error),
    };
  }
}

async function buildTraderContext(userId) {
  const [user, journals, activePlans, activeBehaviourGoals] = await Promise.all([
    User.findById(userId)
      .select("fullName profile preferences stats subscription")
      .lean(),
    Journal.find({ user: userId })
      .select(
        "journalDate status psychology review discipline ai trades totalProfitLoss behaviourFlags",
      )
      .populate(
        "trades",
        "symbol instrument direction status profitLoss profitLossCurrency plannedRR achievedRR session notes openedAt closedAt tradingAccount behaviourFlags",
      )
      .populate("tradingAccount", "currency accountCurrency")
      .sort({ journalDate: -1 })
      .limit(12)
      .lean(),
    TradingPlan.find({ userId, status: "Active" })
      .select(
        "name version planKey maxRiskPerTrade maxDailyTrades maxDailyLoss maxWeeklyLoss maxMonthlyLoss maxConsecutiveLosses minimumRR allowedSessions rules checklist tradingAccount strategyLabel entryTimeframe analysisTimeframe",
      )
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean(),
    Goal.find({
      user: userId,
      status: "Active",
      behaviorChallenge: { $type: "string" },
    })
      .select("title description behaviorChallenge targetValue currentValue unit")
      .sort({ updatedAt: -1 })
      .limit(12)
      .lean(),
  ]);
  const reportingCurrency = resolveReportingCurrency(user);

  const recentJournals = journals.map((journal) => {
    const trades = journal.trades || [];
    return {
      date: journal.journalDate,
      status: journal.status,
      psychology: journal.psychology,
      review: journal.review,
      discipline: journal.discipline,
      ai: journal.ai,
      behaviourFlags: journal.behaviourFlags || [],
      trades: trades.map((trade) => ({
        symbol: trade.symbol,
        instrument: trade.instrument,
        direction: trade.direction,
        status: trade.status,
        profitLoss: trade.profitLoss,
        profitLossCurrency: resolveTradeCurrency(
          trade,
          journal.tradingAccount,
          reportingCurrency,
        ),
        plannedRR: trade.plannedRR,
        achievedRR: trade.achievedRR,
        session: trade.session,
        notes: trade.notes,
        behaviourFlags: trade.behaviourFlags || [],
      })),
    };
  });

  return {
    trader: {
      name: user?.fullName,
      experienceLevel: user?.profile?.experienceLevel,
      tradingStyle: user?.profile?.tradingStyle,
      instruments: user?.profile?.instruments,
      biggestChallenges: user?.profile?.biggestChallenges,
      timezone: user?.profile?.timezone,
      reportingCurrency,
      stats: user?.stats,
      selectedChallenges: user?.profile?.biggestChallenges || [],
      challengeProgress: user?.profile?.challengeProgress || [],
    },
    activeTradingPlans: activePlans,
    activeBehaviourGoals,
    recentJournals,
  };
}

async function analyzeJournalWithAi(journal) {
  const trades = journal.trades || [];
  const payload = {
    date: journal.journalDate,
    status: journal.status,
    journalCurrency: resolveTradeCurrency(
      trades[0],
      journal.tradingAccount,
      "USD",
    ),
    psychology: journal.psychology,
    review: journal.review,
    discipline: journal.discipline,
    trades: trades.map((trade) => ({
      symbol: trade.symbol,
      instrument: trade.instrument,
      direction: trade.direction,
      status: trade.status,
      profitLoss: trade.profitLoss,
      profitLossCurrency: resolveTradeCurrency(
        trade,
        trade.tradingAccount || journal.tradingAccount,
        "USD",
      ),
      plannedRR: trade.plannedRR,
      achievedRR: trade.achievedRR,
      session: trade.session,
      notes: trade.notes,
      riskPercentage: trade.riskPercentage,
    })),
  };

  const result = await completeWithGemini([
    { role: "system", content: JUVO_JOURNAL_ANALYSIS_INSTRUCTIONS },
    { role: "user", content: JSON.stringify(payload) },
  ]);

  if (!result.success) {
    return { summary: "", feedback: "", analysis: null, error: result.message };
  }

  const analysis = parseJsonText(result.text) || {
    summary: result.text,
    feedback: result.text,
  };

  return {
    summary: analysis.summary || result.text,
    feedback: analysis.feedback || result.text,
    analysis,
  };
}

function titleFromMessage(message) {
  const compact = String(message || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "New conversation";
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
}

const PLAN_SUGGESTION_BLOCK =
  /<<<JUVO_PLAN_SUGGESTION>>>\s*([\s\S]*?)\s*<<<END_JUVO_PLAN_SUGGESTION>>>/i;

function extractPlanSuggestionsFromReply(rawText) {
  const text = String(rawText || "");
  const match = text.match(PLAN_SUGGESTION_BLOCK);
  if (!match) {
    return { reply: text.trim(), suggestions: [] };
  }

  const reply = text.replace(PLAN_SUGGESTION_BLOCK, "").trim();
  const parsed = parseJsonText(match[1]) || {};
  const list = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
    : parsed.title || parsed.proposedRule
      ? [parsed]
      : [];

  return {
    reply,
    suggestions: list.slice(0, 2),
  };
}

async function listConversationsService(userId) {
  const conversations = await Conversation.find({ user: userId })
    .select("title lastMessageAt createdAt updatedAt messages")
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean();

  return {
    success: true,
    data: conversations.map((conversation) => ({
      _id: conversation._id,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
      preview:
        conversation.messages?.[conversation.messages.length - 1]?.content ||
        "",
      messageCount: conversation.messages?.length || 0,
    })),
  };
}

async function getConversationService(conversationId, userId) {
  const conversation = await Conversation.findOne({
    _id: conversationId,
    user: userId,
  })
    .populate("messages.planSuggestions")
    .lean();

  if (!conversation) {
    return {
      success: false,
      statusCode: 404,
      message: "Conversation not found.",
    };
  }

  const data = {
    ...conversation,
    messages: (conversation.messages || []).map((message) => ({
      ...message,
      planSuggestionDetails: Array.isArray(message.planSuggestions)
        ? message.planSuggestions.filter(
            (item) => item && typeof item === "object" && item._id,
          )
        : [],
    })),
  };

  return { success: true, data };
}

async function deleteConversationsService(conversationIds, userId) {
  if (!Array.isArray(conversationIds) || !conversationIds.length) {
    return {
      success: false,
      statusCode: 400,
      message: "Select at least one conversation.",
    };
  }
  if (
    conversationIds.length > 100 ||
    conversationIds.some((id) => !mongoose.Types.ObjectId.isValid(id))
  ) {
    return {
      success: false,
      statusCode: 400,
      message: "Conversation selection is invalid.",
    };
  }

  const result = await Conversation.deleteMany({
    _id: { $in: conversationIds },
    user: userId,
  });
  return { success: true, deletedCount: result.deletedCount || 0 };
}

function buildScreenshotTradePrompt(tradeContext = {}) {
  return [
    "Review this trading chart screenshot for a closed or closing trade.",
    "Trade context JSON follows. Omit nothing that is present, and do not invent missing values.",
    JSON.stringify(tradeContext),
  ].join("\n\n");
}

async function analyzeTradeScreenshotWithAi({
  imageBuffer,
  mimeType,
  tradeContext,
}) {
  const client = getClient();

  if (!client) {
    return {
      success: false,
      statusCode: 503,
      message: "Juvo AI is temporarily unavailable.",
    };
  }

  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
    return {
      success: false,
      statusCode: 400,
      message: "Choose a chart screenshot to review.",
    };
  }

  try {
    const response = await Promise.race([
      client.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: buildScreenshotTradePrompt(tradeContext) },
              {
                inlineData: {
                  mimeType,
                  data: imageBuffer.toString("base64"),
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction: JUVO_SCREENSHOT_REVIEW_INSTRUCTIONS,
          responseMimeType: "application/json",
        },
      }),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("Screenshot analysis timed out. Try again shortly."));
        }, SCREENSHOT_ANALYSIS_TIMEOUT_MS);
      }),
    ]);

    const text = sanitizeModelIdentity(readGeminiText(response));
    if (!text) {
      return {
        success: false,
        statusCode: 502,
        message: "Juvo AI returned an empty screenshot review.",
      };
    }

    const parsed = parseJsonText(text);
    const review = normalizeScreenshotReview(parsed);
    if (!review) {
      return {
        success: false,
        statusCode: 502,
        message: "Juvo AI returned an incomplete screenshot review.",
      };
    }

    return {
      success: true,
      review,
      rawText: text,
    };
  } catch (error) {
    console.error("Juvo screenshot AI error:", geminiErrorMessage(error));
    return {
      success: false,
      statusCode: 502,
      message: userFacingAiFailure(error),
    };
  }
}

async function chatWithJuvoService({
  userId,
  conversationId,
  message,
  journalIds,
}) {
  const content = String(message || "").trim();

  if (!content) {
    return { success: false, statusCode: 400, message: "Message is required." };
  }

  let conversation = null;

  if (conversationId) {
    conversation = await Conversation.findOne({
      _id: conversationId,
      user: userId,
    });
    if (!conversation) {
      return {
        success: false,
        statusCode: 404,
        message: "Conversation not found.",
      };
    }
  } else {
    conversation = await Conversation.create({
      user: userId,
      title: titleFromMessage(content),
      messages: [],
    });
  }

  const selectedIds = Array.isArray(journalIds)
    ? journalIds
        .map((id) => String(id || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .slice(0, 12)
    : [];

  let context;
  if (selectedIds.length) {
    const journals = await Journal.find({
      user: userId,
      _id: { $in: selectedIds },
    })
      .select(
        "journalDate status psychology review discipline ai trades totalProfitLoss behaviourFlags",
      )
      .populate(
        "trades",
        "symbol instrument direction status profitLoss profitLossCurrency plannedRR achievedRR session notes openedAt closedAt tradingAccount behaviourFlags",
      )
      .populate("tradingAccount", "currency accountCurrency")
      .lean();

    const [user, activePlans, activeBehaviourGoals] = await Promise.all([
      User.findById(userId)
        .select("fullName profile preferences stats subscription")
        .lean(),
      TradingPlan.find({ userId, status: "Active" })
        .select(
          "name version planKey maxRiskPerTrade maxDailyTrades maxDailyLoss maxWeeklyLoss maxMonthlyLoss maxConsecutiveLosses minimumRR allowedSessions rules checklist tradingAccount strategyLabel entryTimeframe analysisTimeframe",
        )
        .sort({ updatedAt: -1 })
        .limit(5)
        .lean(),
      Goal.find({
        user: userId,
        status: "Active",
        behaviorChallenge: { $type: "string" },
      })
        .select("title description behaviorChallenge targetValue currentValue unit")
        .sort({ updatedAt: -1 })
        .limit(12)
        .lean(),
    ]);
    const reportingCurrency = resolveReportingCurrency(user);
    context = {
      mode: "ask_your_journal",
      trader: {
        name: user?.fullName,
        experienceLevel: user?.profile?.experienceLevel,
        tradingStyle: user?.profile?.tradingStyle,
        timezone: user?.profile?.timezone,
        reportingCurrency,
        selectedChallenges: user?.profile?.biggestChallenges || [],
        challengeProgress: user?.profile?.challengeProgress || [],
      },
      activeTradingPlans: activePlans,
      activeBehaviourGoals,
      selectedJournals: journals.map((journal) => ({
        id: String(journal._id),
        date: journal.journalDate,
        status: journal.status,
        psychology: journal.psychology,
        review: journal.review,
        discipline: journal.discipline,
        ai: journal.ai,
        behaviourFlags: journal.behaviourFlags || [],
        trades: (journal.trades || []).map((trade) => ({
          symbol: trade.symbol,
          instrument: trade.instrument,
          direction: trade.direction,
          status: trade.status,
          profitLoss: trade.profitLoss,
          profitLossCurrency: resolveTradeCurrency(
            trade,
            journal.tradingAccount,
            reportingCurrency,
          ),
          plannedRR: trade.plannedRR,
          achievedRR: trade.achievedRR,
          session: trade.session,
          notes: trade.notes,
          behaviourFlags: trade.behaviourFlags || [],
        })),
      })),
    };
  } else {
    context = await buildTraderContext(userId);
  }

  const history = (conversation.messages || []).slice(-16).map((item) => ({
    role: item.role,
    content: item.content,
  }));

  const result = await completeWithGemini([
    { role: "system", content: JUVO_CHAT_SYSTEM_INSTRUCTIONS },
    {
      role: "system",
      content: `Trader context from JUVO journal data. Use this as evidence, never invent missing trades.\n${JSON.stringify(context)}`,
    },
    ...history,
    { role: "user", content },
  ]);

  if (!result.success) {
    return result;
  }

  const extracted = extractPlanSuggestionsFromReply(result.text);
  const reply = sanitizeModelIdentity(extracted.reply || result.text);
  const now = new Date();
  conversation.messages.push({ role: "user", content, createdAt: now });

  const suggestionIds = [];
  const suggestionPayloads = [];
  for (const rawSuggestion of extracted.suggestions) {
    try {
      const created = await createPlanSuggestionService(userId, rawSuggestion, {
        conversationId: conversation._id,
        messageCreatedAt: now,
      });
      if (created.success && created.data?._id) {
        suggestionIds.push(created.data._id);
        suggestionPayloads.push(created.data);
      }
    } catch (error) {
      console.error("Failed to persist plan suggestion:", error?.message || error);
    }
  }

  conversation.messages.push({
    role: "assistant",
    content: reply,
    createdAt: now,
    planSuggestions: suggestionIds,
  });
  conversation.lastMessageAt = now;
  if (conversation.title === "New conversation") {
    conversation.title = titleFromMessage(content);
  }
  await conversation.save();

  const messages = (conversation.messages || []).map((message) => {
    const plain = typeof message.toObject === "function" ? message.toObject() : message;
    if (
      plain.role === "assistant" &&
      Array.isArray(plain.planSuggestions) &&
      plain.planSuggestions.length &&
      suggestionPayloads.length
    ) {
      return {
        ...plain,
        planSuggestionDetails: suggestionPayloads.filter((item) =>
          plain.planSuggestions.some(
            (id) => String(id) === String(item._id),
          ),
        ),
      };
    }
    return plain;
  });

  return {
    success: true,
    data: {
      conversationId: conversation._id,
      title: conversation.title,
      reply,
      messages,
      planSuggestions: suggestionPayloads,
    },
  };
}

export {
  MODEL as JUVO_AI_MODEL,
  analyzeJournalWithAi,
  analyzeTradeScreenshotWithAi,
  buildScreenshotTradePrompt,
  chatWithJuvoService,
  completeWithGemini,
  deleteConversationsService,
  getConversationService,
  listConversationsService,
  parseJsonText,
  sanitizeModelIdentity,
};
