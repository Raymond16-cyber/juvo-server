import { GoogleGenAI } from "@google/genai";
import { chatWithAIService, createQuizzes, getAIChatHistory ,createFlashcardsService} from "../services/AIservice.js";
import { createAIMessages } from "../repositories/aiRepository.js";
import { createStudySetService } from "../services/studySetService.js";

const AI_API_KEY = process.env.AI_API_KEY || "";

const ai = new GoogleGenAI({
    apiKey: AI_API_KEY,
  });



// On startup/load
async function getAIChatMessages(req, res) {
    const myId = req.user._id;
    try {
        const messages = await getAIChatHistory(myId);
        return res.status(200).json({
            success: true,
            messages: messages,
            messageLength: messages.length
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

async function chatWithAI(req, res) {
    try {
        const { message } = req.body;

        const response = await chatWithAIService(ai, message);

        const newMessage = await createAIMessages({
            userId: req.user._id,
            message: message,
            response: response.candidates[0].content.parts[0].text || "No response from AI",
        });

        return res.status(200).json({
            success: true,
            message: newMessage,
            response: response.candidates[0].content.parts[0].text || "No response from AI",   
        });

    } catch (error) {
        console.error(error);

        return res.status(503).json({
            success: false,
            message: error.message,
        });
    }
};

// Create quiz with AI alongside creating studyset
async function createQuizWithAIController(req, res) {
    const userId = req.user._id;
    try {
        const { prompt, title, description, category, isPublic } = req.body;
        const { response, quizid } = await createQuizzes(ai, prompt,userId);
        const quiz = JSON.parse(response.text);
        const studySetResult = await createStudySetService(req.user._id, {
            title: quiz.title,
            description: description,
            category: category,
            isPublic: isPublic,
            quizzes: [quizid],
        },req.user.fullName);
        console.log("Study set created with AI quiz:", studySetResult.title);

        return res.status(200).json({
            success: true,
            quiz: quiz || "No quiz generated",
            isPublic: isPublic
        });

    } catch (error) {
        console.error(error);
        return res.status(503).json({
            success: false,
            message: error.message,
        });
    }
}

async function createFlashcardsWithAIController(req, res) {
    const userId = req.user._id;
    try {
        const { prompt, title, description, category } = req.body;
        const { response } = await createFlashcardsService(ai, prompt, userId);
        const flashcards = JSON.parse(response.text);

        return res.status(200).json({
            success: true,
            flashcards: flashcards || "No flashcards generated"
        });

    } catch (error) {
        console.error(error);
        return res.status(503).json({
            success: false,
            message: error.message,
        });
    }
}

export {
    getAIChatMessages,
    chatWithAI,
    createQuizWithAIController,
    createFlashcardsWithAIController
}