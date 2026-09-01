import "../config/loadEnv.js";
import { GoogleGenAI } from "@google/genai";
import Conversation from "../models/Conversation.js";
import Journal from "../models/Journal.js";
import "../models/Trades.js";
import User from "../models/User.js";
import {
  JUVO_CHAT_SYSTEM_INSTRUCTIONS,
  JUVO_JOURNAL_ANALYSIS_INSTRUCTIONS,
} from "../prompts/aiPrompts.js";

const MODEL = "gemini-3.1-flash-lite";

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
  return (
    error?.error?.message ||
    error?.message ||
    "Unable to reach Gemini right now."
  );
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
      message: "Juvo AI is not configured. Add AI_API_KEY on the server.",
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

    const text = readGeminiText(response);

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
    console.error("Juvo Gemini error:", geminiErrorMessage(error));
    return {
      success: false,
      statusCode: 502,
      message: geminiErrorMessage(error),
    };
  }
}

async function buildTraderContext(userId) {
  const [user, journals] = await Promise.all([
    User.findById(userId)
      .select("fullName profile preferences stats subscription")
      .lean(),
    Journal.find({ user: userId })
      .select(
        "journalDate status psychology review discipline ai trades totalProfitLoss",
      )
      .populate(
        "trades",
        "symbol instrument direction status profitLoss plannedRR achievedRR session notes openedAt closedAt",
      )
      .sort({ journalDate: -1 })
      .limit(12)
      .lean(),
  ]);

  const recentJournals = journals.map((journal) => {
    const trades = journal.trades || [];
    return {
      date: journal.journalDate,
      status: journal.status,
      psychology: journal.psychology,
      review: journal.review,
      discipline: journal.discipline,
      ai: journal.ai,
      trades: trades.map((trade) => ({
        symbol: trade.symbol,
        instrument: trade.instrument,
        direction: trade.direction,
        status: trade.status,
        profitLoss: trade.profitLoss,
        plannedRR: trade.plannedRR,
        achievedRR: trade.achievedRR,
        session: trade.session,
        notes: trade.notes,
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
      stats: user?.stats,
    },
    recentJournals,
  };
}

async function analyzeJournalWithAi(journal) {
  const trades = journal.trades || [];
  const payload = {
    date: journal.journalDate,
    status: journal.status,
    psychology: journal.psychology,
    review: journal.review,
    discipline: journal.discipline,
    trades: trades.map((trade) => ({
      symbol: trade.symbol,
      instrument: trade.instrument,
      direction: trade.direction,
      status: trade.status,
      profitLoss: trade.profitLoss,
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
        conversation.messages?.[conversation.messages.length - 1]?.content || "",
      messageCount: conversation.messages?.length || 0,
    })),
  };
}

async function getConversationService(conversationId, userId) {
  const conversation = await Conversation.findOne({
    _id: conversationId,
    user: userId,
  }).lean();

  if (!conversation) {
    return { success: false, statusCode: 404, message: "Conversation not found." };
  }

  return { success: true, data: conversation };
}

async function chatWithJuvoService({ userId, conversationId, message }) {
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

  const context = await buildTraderContext(userId);
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

  const now = new Date();
  conversation.messages.push({ role: "user", content, createdAt: now });
  conversation.messages.push({
    role: "assistant",
    content: result.text,
    createdAt: now,
  });
  conversation.lastMessageAt = now;
  if (conversation.title === "New conversation") {
    conversation.title = titleFromMessage(content);
  }
  await conversation.save();

  return {
    success: true,
    data: {
      conversationId: conversation._id,
      title: conversation.title,
      reply: result.text,
      messages: conversation.messages,
    },
  };
}

export {
  analyzeJournalWithAi,
  chatWithJuvoService,
  getConversationService,
  listConversationsService,
};
