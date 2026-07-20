import AIMessages from "../models/AIMessages.js";
import aiQuiz from "../models/AIQuiz.js";

export async function createAIMessages(messageData) {
  const message = await AIMessages.create(messageData);
  return message;
}

export async function findAIMessagesByUserId(userId, limit = 20) {
  return AIMessages.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

export async function createAiQuiz(quizData) {
  const quiz = await aiQuiz.create(quizData);
  return quiz;
}