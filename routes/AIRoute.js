import { Router } from 'express'
import { requireAuth } from "../middleware/authMiddleware.js";
import { chatWithAI, createFlashcardsWithAIController, createQuizWithAIController, getAIChatMessages } from "../controllers/AIController.js";

const aiRoutes = Router()

aiRoutes.post('/chat-with-ai',requireAuth, chatWithAI )
aiRoutes.get('/get-ai-chat-messages', requireAuth, getAIChatMessages)
// create quiz with AI
aiRoutes.post('/create-quiz-with-ai', requireAuth, createQuizWithAIController)
// create flashcards with AI
aiRoutes.post('/create-flashcards-with-ai', requireAuth, createFlashcardsWithAIController)


export default aiRoutes