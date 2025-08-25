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
const MONGO_URI =
    process.env.MONGO_URI || "mongodb://localhost:27017/ai_crud_agent";
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

async function askGemini(prompt: string) {
    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const result = await model.generateContent(prompt);
    return result.response.text();
}

// Helper: always find docs case-insensitively on "name"
async function findDocs(filter: any) {
    if (filter?.name) {
        return Item.find({ name: { $regex: filter.name, $options: "i" } });
    }
    return Item.find(filter || {});
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

        // Step 1: Ask Gemini to decide CRUD actions
        const prompt = `
You are an AI that decides CRUD actions for a MongoDB collection named "items" with the fields:
- name (string)
- description (string)

User Query: "${query}"

You must respond in strict JSON only. 
- Do NOT use markdown, code blocks, or extra text.
- Always return an object with two keys: "totalOperations" and "operations".
- "totalOperations" is the number of operations in the "operations" array.
- Each element in "operations" must have an "action" (create, read, update, delete).
- "create" and "update" must include "data".
- "read" and "delete" must include "filter".

JSON Example:

{
  "totalOperations": 2,
  "operations": [
    {
      "action": "read",
      "filter": { "name": "apple" }
    },
    {
      "action": "update",
      "filter": { "name": "apple" },
      "data": { "description": "Freshly picked apple" }
    }
  ]
}

Respond only in this JSON format.
`;

        const aiResponse = await askGemini(prompt);
        console.log("AI Response:", aiResponse);

        let parsed: any;
        try {
            parsed = JSON.parse(aiResponse);
        } catch (e) {
            return res
                .status(400)
                .json({ error: "AI returned invalid JSON", raw: aiResponse });
        }

        const results: any[] = [];
        let lastResult: any = null;

        for (const op of parsed.operations) {
            let opResult: any = null;

            switch (op.action) {
                case "create":
                    opResult = await Item.create(op.data);
                    break;

                case "read":
                    opResult = await findDocs(op.filter);
                    break;

                case "update": {
                    const docs = await findDocs(op.filter);
                    const updated: any[] = [];
                    for (const doc of docs) {
                        const updatedDoc = await Item.findByIdAndUpdate(doc._id, op.data, {
                            new: true,
                        });
                        updated.push(updatedDoc);
                    }
                    opResult = updated;
                    break;
                }

                case "delete": {
                    const docs = await findDocs(op.filter);
                    const deleted: any[] = [];
                    for (const doc of docs) {
                        const deletedDoc = await Item.findByIdAndDelete(doc._id);
                        deleted.push(deletedDoc);
                    }
                    opResult = deleted;
                    break;
                }

                default:
                    opResult = { error: `Unknown action: ${op.action}` };
            }

            lastResult = opResult; // always overwrite
        }

        // Respond only with the **final operation result**
        res.json({
            totalOperations: parsed.totalOperations,
            result: lastResult,
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
    }
});

// =======================
// CONNECT DB & START SERVER
// =======================
mongoose
    .connect(MONGO_URI)
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
