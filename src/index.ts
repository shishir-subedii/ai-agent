// index.ts
import express, { Request, Response } from "express";
import mongoose, { Schema, Document } from "mongoose";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

// =======================
// ENV VARIABLES
// =======================
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/ai_crud_agent";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// =======================
// MONGOOSE MODEL
// =======================
interface IItem extends Document {
    name: string;
    description: string;
}

const ItemSchema = new Schema<IItem>({
    name: { type: String, required: true },
    description: { type: String, required: true },
});

const Item = mongoose.model<IItem>("Item", ItemSchema);

// =======================
// GEMINI SERVICE
// =======================
const ai = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = ai.getGenerativeModel({ model: "gemini-pro" });

async function askGemini(prompt: string) {
    const model = ai.getGenerativeModel(
        { model: "gemini-2.5-flash-lite" }
    );
    const result = await model.generateContent(prompt);
    return result.response.text();
}

function cleanAIResponse(text: string) {
    return text.replace(/```json|```/g, "").trim();
}


// =======================
// EXPRESS APP
// =======================
const app = express();
app.use(express.json());

app.post("/api/ai/query", async (req: Request, res: Response) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: "Query is required" });
        }

        // Step 1: Ask Gemini to decide CRUD action
        const prompt = `
You are an AI that decides CRUD actions for a MongoDB collection named "items" with the fields: 
- name (string)
- description (string)

User Query: "${query}"

You must respond with **strict JSON only**. 
- Do NOT use markdown, code blocks, or any extra text.
- Output JSON only.
- JSON format example (follow this exactly):

{
  "action": "create",
  "data": {
    "name": "Example Name",
    "description": "Example Description"
  }
}

Respond now in the above format with the correct action and data.
`;

        const aiResponse = await askGemini(prompt);
        console.log(aiResponse)

        let actionData: any;
        try {
            actionData = JSON.parse(aiResponse);
        } catch (e) {
            return res.status(400).json({
                error: "AI returned invalid JSON",
                raw: aiResponse
            });
        }

        let result;
        switch (actionData.action) {
            case "create":
                result = await Item.create(actionData.data);
                break;
            case "read":
                result = await Item.find(actionData.data || {});
                break;
            case "update":
                result = await Item.updateMany(actionData.data.filter, actionData.data.update);
                break;
            case "delete":
                result = await Item.deleteMany(actionData.data || {});
                break;
            default:
                return res.status(400).json({ error: "Unknown action" });
        }

        res.json({ action: actionData.action, result });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
    }
});

// =======================
// CONNECT DB & START SERVER
// =======================
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("✅ MongoDB Connected");
        app.listen(PORT, () => {
            console.log(`🚀 Server running at http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error("❌ MongoDB Connection Error:", err);
        process.exit(1);
    });
