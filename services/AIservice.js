import { AI_QUIZ_SYSTEM_INSTRUCTIONS, AI_CHAT_SYSTEM_INSTRUCTIONS, AI_FLASHCARD_SYSTEM_INSTRUCTIONS } from "../prompts/aiPrompts.js";
import { createAiFlashcards, createAiQuiz, findAIMessagesByUserId } from "../repositories/aiRepository.js";

async function chatWithAIService(ai,prompt) {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-lite",
            config: {
             systemInstruction: AI_CHAT_SYSTEM_INSTRUCTIONS
            },
            contents: prompt,
      });
      
    return response;
    } catch (error) {
    console.error(error);

    if (error.status === 429) {
        throw new Error(
            "The AI service is currently busy. Please try again in a moment."
        );
    }

    throw new Error("Unable to generate AI response.");
}
}



async function createQuizzes(ai, prompt,userId) {
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-lite",
            config: {
                systemInstruction: AI_QUIZ_SYSTEM_INSTRUCTIONS
            },
            contents: prompt,
        });
        const AIquiz = JSON.parse(response.text);
        const newQuiz = await createAiQuiz(AIquiz);
        return {
            response: response,
            quizid: newQuiz._id,
        };
    } catch (error) {
        console.error(error);
        if (error.status === 429) {
            throw new Error(
                "The AI service is currently busy. Please try again in a moment."
            );
        }
        throw new Error("Unable to generate AI response.");
    }
}

async function createFlashcardsService(ai, prompt, userId) {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-lite",
            config: {
                systemInstruction: AI_FLASHCARD_SYSTEM_INSTRUCTIONS
            },
            contents: prompt,
        });
        const flashCards = JSON.parse(response.text);
        const newFlashcards = await createAiFlashcards(flashCards);
        return {
            response: response,
            flashcards: newFlashcards,
        };
    } catch (error) {
        console.error(error);
        if (error.status === 429) {
            throw new Error(
                "The AI service is currently busy. Please try again in a moment."
            );
        }
        throw new Error("Unable to generate AI response.");
    }
}



export async function getAIChatHistory(userId, limit = 50) {
  const records = await findAIMessagesByUserId(userId, limit);

  const messages = [];

  records.forEach((record) => {
    const time = record.createdAt || new Date();
    messages.push({
      id: `${record._id}-user`,
      text: record.message,
      isUser: true,
      timestamp: time,
    });
    messages.push({
      id: `${record._id}-ai`,
      text: record.response,
      isUser: false,
      timestamp: time,
    });
  });

  return messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export {
    chatWithAIService,
    createQuizzes,
    createFlashcardsService
}