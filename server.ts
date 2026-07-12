import express from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import { DocumentItem, ChatSession, Quiz, UserStats, Message, Difficulty, Task, Reminder, AutomationHistoryEntry, DocumentCategory, AutomationReport, StudyPlan, KnowledgeGraphData, EmailLogEntry, EmailConfig, SmartEmailCategory, SmartEmailDraft, SmartEmailHistoryEntry, SmartEmailTone, SmartEmailAction, CandidateAssessment, CandidateQuizQuestion, CandidateProfile, ResumeAnalysis } from './src/types.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Enable large payloads for document uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const isVercel = process.env.VERCEL === '1';
const DATA_DIR = isVercel ? '/tmp/data' : path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Initialize local database
function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  let initialDb: any = {
    documents: [],
    chats: [],
    quizzes: [],
    tasks: [],
    reminders: [],
    automationHistory: [],
    emailHistory: [],
    smartEmailHistory: [],
    candidateAssessments: [],
    emailConfig: {
      autoSendOnUpload: false,
      defaultRecipient: "mprakash20007@gmail.com",
      includeFlashcards: true,
      includeQuiz: true
    }
  };
  if (fs.existsSync(DB_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      initialDb = { ...initialDb, ...existing };
      if (!initialDb.tasks) initialDb.tasks = [];
      if (!initialDb.reminders) initialDb.reminders = [];
      if (!initialDb.automationHistory) initialDb.automationHistory = [];
      if (!initialDb.emailHistory) initialDb.emailHistory = [];
      if (!initialDb.smartEmailHistory) initialDb.smartEmailHistory = [];
      if (!initialDb.candidateAssessments) initialDb.candidateAssessments = [];
      if (!initialDb.emailConfig) initialDb.emailConfig = {
        autoSendOnUpload: false,
        defaultRecipient: "mprakash20007@gmail.com",
        includeFlashcards: true,
        includeQuiz: true
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
    } catch (e) {
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
    }
  } else {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
  }
}

initDb();

// Load / Save DB helpers
function loadDb(): { 
  documents: DocumentItem[]; 
  chats: ChatSession[]; 
  quizzes: Quiz[];
  tasks: Task[];
  reminders: Reminder[];
  automationHistory: AutomationHistoryEntry[];
  emailHistory: EmailLogEntry[];
  smartEmailHistory: SmartEmailHistoryEntry[];
  candidateAssessments: CandidateAssessment[];
  emailConfig: EmailConfig;
} {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(data);
    return {
      documents: parsed.documents || [],
      chats: parsed.chats || [],
      quizzes: parsed.quizzes || [],
      tasks: parsed.tasks || [],
      reminders: parsed.reminders || [],
      automationHistory: parsed.automationHistory || [],
      emailHistory: parsed.emailHistory || [],
      smartEmailHistory: parsed.smartEmailHistory || [],
      candidateAssessments: parsed.candidateAssessments || [],
      emailConfig: parsed.emailConfig || {
        autoSendOnUpload: false,
        defaultRecipient: "mprakash20007@gmail.com",
        includeFlashcards: true,
        includeQuiz: true
      }
    };
  } catch (err) {
    console.error('Failed to read db file, resetting database:', err);
    return { 
      documents: [], 
      chats: [], 
      quizzes: [], 
      tasks: [], 
      reminders: [], 
      automationHistory: [],
      emailHistory: [],
      smartEmailHistory: [],
      candidateAssessments: [],
      emailConfig: {
        autoSendOnUpload: false,
        defaultRecipient: "mprakash20007@gmail.com",
        includeFlashcards: true,
        includeQuiz: true
      }
    };
  }
}

function saveDb(data: { 
  documents: DocumentItem[]; 
  chats: ChatSession[]; 
  quizzes: Quiz[];
  tasks: Task[];
  reminders: Reminder[];
  automationHistory: AutomationHistoryEntry[];
  emailHistory: EmailLogEntry[];
  smartEmailHistory: SmartEmailHistoryEntry[];
  candidateAssessments: CandidateAssessment[];
  emailConfig: EmailConfig;
}) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to write to db file:', err);
  }
}

// Initialize Gemini Client
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY is not defined in environment. Gemini features will fail.');
    }
    ai = new GoogleGenAI({
      apiKey: apiKey || '',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return ai;
}

// API Routes

// GET Stats
app.get('/api/stats', (req, res) => {
  try {
    const db = loadDb();
    const totalDocs = db.documents.length;
    const totalChats = db.chats.length;
    const completedQuizzes = db.quizzes.filter(q => q.score !== undefined);
    const totalQuizzes = completedQuizzes.length;
    
    let totalQuestions = 0;
    let totalCorrect = 0;
    completedQuizzes.forEach(q => {
      totalQuestions += q.questions.length;
      totalCorrect += q.score || 0;
    });

    const averageScore = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

    const stats: UserStats = {
      totalDocuments: totalDocs,
      totalChats: totalChats,
      totalQuizzes: totalQuizzes,
      totalQuestionsAnswered: totalQuestions,
      averageScore: averageScore
    };
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Documents
app.get('/api/documents', (req, res) => {
  try {
    const db = loadDb();
    // Return documents (excluding giant raw content to keep payload lighter)
    const list = db.documents.map(d => ({
      id: d.id,
      title: d.title,
      type: d.type,
      size: d.size,
      uploadedAt: d.uploadedAt,
      hasSummary: !!d.summary
    }));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Document Details (includes summary and quiz list)
app.get('/api/documents/:id', (req, res) => {
  try {
    const db = loadDb();
    const doc = db.documents.find(d => d.id === req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(doc);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Document Annotations
app.get('/api/documents/:id/annotations', (req, res) => {
  try {
    const db = loadDb();
    const doc = db.documents.find(d => d.id === req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(doc.annotations || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Save/Update Document Annotations
app.post('/api/documents/:id/annotations', (req, res) => {
  try {
    const { annotations } = req.body;
    if (!Array.isArray(annotations)) {
      return res.status(400).json({ error: 'Annotations must be an array' });
    }

    const db = loadDb();
    const docIndex = db.documents.findIndex(d => d.id === req.params.id);
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }

    db.documents[docIndex].annotations = annotations;
    saveDb(db);
    res.json({ message: 'Annotations saved successfully', annotations });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Synthesize Highlights into Study Guide
app.post('/api/documents/:id/synthesize-highlights', async (req, res) => {
  try {
    const { highlights } = req.body;
    if (!Array.isArray(highlights) || highlights.length === 0) {
      return res.status(400).json({ error: 'Please highlight some passages first.' });
    }

    const client = getGeminiClient();
    const highlightTexts = highlights.map((h: any) => `- [Page ${h.page}]: "${h.text}"`).join('\n');

    const prompt = `You are a professional research mentor and smart study companion.
The user has highlighted several passages from a document.
Please synthesize these highlights into a beautiful, cohesive, high-density study guide, categorized by key themes, core definitions, and action items.

Here are the user's raw highlights:
${highlightTexts}

Format your response in clean Markdown with professional headers, bullet points, and highlight takeaways. Avoid dry filler text, make it immediately useful and highly polished.`;

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt
    });

    res.json({ synthesis: response.text || 'Failed to synthesize highlights.' });
  } catch (err: any) {
    console.error('Synthesis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET Document Pages (parsed text sections for reading and annotating)
app.get('/api/documents/:id/pages', async (req, res) => {
  try {
    const db = loadDb();
    const docIndex = db.documents.findIndex(d => d.id === req.params.id);
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = db.documents[docIndex];

    // Check if pages are already cached
    if ((doc as any).pages && (doc as any).pages.length > 0) {
      return res.json((doc as any).pages);
    }

    if (doc.type === 'pdf') {
      const client = getGeminiClient();
      const contents = [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: doc.content // base64 string
          }
        },
        'Extract the full readable text content of this PDF, page by page. Break it down into discrete pages of logical length so the user can read and annotate it easily.'
      ];

      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: contents,
        config: {
          systemInstruction: `You are an expert document reading agent. Your task is to extract all readable text from the provided PDF, organizing it page-by-page.
Return your response ONLY in JSON format with a "pages" array containing objects with:
- pageNumber: an integer starting from 1
- title: a short descriptive section or page heading
- content: the readable text content of that page, complete and formatted cleanly. Do not summarize or omit paragraphs, represent the actual PDF text content.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              pages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pageNumber: { type: Type.INTEGER },
                    title: { type: Type.STRING },
                    content: { type: Type.STRING }
                  },
                  required: ['pageNumber', 'title', 'content']
                }
              }
            },
            required: ['pages']
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error('Gemini did not return page-extraction data');
      }

      const pagesData = JSON.parse(text);
      db.documents[docIndex].pages = pagesData.pages;
      saveDb(db);
      res.json(pagesData.pages);
    } else {
      // Decode content if it was encoded, or use directly
      let plainText = doc.content;
      // If it looks like base64, try to decode it (just in case for docx/doc)
      if (doc.type === 'docx' && !plainText.includes(' ') && plainText.length > 100) {
        try {
          const buffer = Buffer.from(plainText, 'base64');
          plainText = buffer.toString('utf-8');
          // Filter printable text if it looks like binary
          if (plainText.includes('PK')) {
            plainText = "This is a DOCX document file. Let's study and annotate its pages. [Binary file parsed]";
          }
        } catch (e) {
          // ignore
        }
      }

      // Segment content into paginated parts
      const segmentSize = 1500;
      const pages = [];
      let charIdx = 0;
      let pageNum = 1;

      while (charIdx < plainText.length) {
        let chunk = plainText.substring(charIdx, charIdx + segmentSize);
        if (charIdx + segmentSize < plainText.length) {
          const lastSpace = chunk.lastIndexOf(' ');
          if (lastSpace > segmentSize - 200) {
            chunk = chunk.substring(0, lastSpace);
          }
        }

        pages.push({
          pageNumber: pageNum,
          title: `Section ${pageNum}`,
          content: chunk.trim()
        });

        charIdx += chunk.length;
        pageNum++;
      }

      if (pages.length === 0) {
        pages.push({
          pageNumber: 1,
          title: 'Empty Document',
          content: 'No readable content found in the document.'
        });
      }

      db.documents[docIndex].pages = pages;
      saveDb(db);
      res.json(pages);
    }
  } catch (err: any) {
    console.error('Pages parsing error:', err);
    res.status(500).json({ error: err.message });
  }
});

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getClassificationAndEmbedding(title: string, content: string, type: string): Promise<{ category: DocumentCategory; embedding: number[] }> {
  let category: DocumentCategory = 'Personal';
  let embedding: number[] = new Array(768).fill(0);

  let snippet = content;
  if (type === 'pdf') {
    snippet = 'This is a PDF file document named ' + title;
  }
  if (snippet.length > 2000) {
    snippet = snippet.substring(0, 2000);
  }

  try {
    const client = getGeminiClient();
    if (client && process.env.GEMINI_API_KEY) {
      // 1. Generate Category
      const classPrompt = `You are an expert document organization system.
Analyze the title and content snippet of this document and classify it into exactly one of these categories:
- Academic (textbooks, lecture notes, student assignments, study guides)
- Business (corporate reports, business plans, presentations)
- Finance (invoices, balance sheets, financial statements, budgets)
- Medical (clinical notes, health records, patient history, medical papers)
- Legal (contracts, agreements, terms of service, laws, regulations)
- Technical (code, API documentation, software specs, manuals)
- Research (scientific publications, white papers, thesis, case studies)
- Personal (letters, receipts, diaries, personal notes)

Document Title: "${title}"
Snippet: "${snippet.substring(0, 1000)}"

Return ONLY a JSON object with key "category" matching one of the categories above.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: classPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING }
            },
            required: ['category']
          }
        }
      });

      const parsed = JSON.parse(response.text || '{}');
      if (parsed.category) {
        const mapped = parsed.category.trim();
        const validCategories = ['Academic', 'Business', 'Finance', 'Medical', 'Legal', 'Technical', 'Research', 'Personal'];
        const matchedCategory = validCategories.find(c => c.toLowerCase() === mapped.toLowerCase());
        if (matchedCategory) {
          category = matchedCategory as DocumentCategory;
        }
      }

      // 2. Generate Embedding
      try {
        const embedResponse = await client.models.embedContent({
          model: 'text-embedding-004',
          contents: `${title}\n${snippet.substring(0, 1000)}`
        });
        if (embedResponse.embeddings && embedResponse.embeddings.length > 0 && embedResponse.embeddings[0].values) {
          embedding = embedResponse.embeddings[0].values;
        }
      } catch (embedErr) {
        console.error('Failed to generate embedding:', embedErr);
      }
    }
  } catch (err) {
    console.error('Failed to auto-classify or embed document, using fallbacks:', err);
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('invoice') || lowerTitle.includes('receipt') || lowerTitle.includes('bill') || lowerTitle.includes('tax') || lowerTitle.includes('payment')) category = 'Finance';
    else if (lowerTitle.includes('legal') || lowerTitle.includes('contract') || lowerTitle.includes('agreement') || lowerTitle.includes('terms') || lowerTitle.includes('policy')) category = 'Legal';
    else if (lowerTitle.includes('medical') || lowerTitle.includes('clinical') || lowerTitle.includes('health') || lowerTitle.includes('patient') || lowerTitle.includes('clinic')) category = 'Medical';
    else if (lowerTitle.includes('research') || lowerTitle.includes('paper') || lowerTitle.includes('journal') || lowerTitle.includes('thesis')) category = 'Research';
    else if (lowerTitle.includes('class') || lowerTitle.includes('lecture') || lowerTitle.includes('study') || lowerTitle.includes('syllabus') || lowerTitle.includes('course') || lowerTitle.includes('student')) category = 'Academic';
    else if (lowerTitle.includes('code') || lowerTitle.includes('tech') || lowerTitle.includes('api') || lowerTitle.includes('documentation') || lowerTitle.includes('manual') || lowerTitle.includes('spec')) category = 'Technical';
    else if (lowerTitle.includes('business') || lowerTitle.includes('proposal') || lowerTitle.includes('project') || lowerTitle.includes('meeting') || lowerTitle.includes('report')) category = 'Business';
  }

  return { category, embedding };
}

// POST Semantic Search
app.post('/api/documents/semantic-search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.json({ results: [] });
    }

    const db = loadDb();
    if (!db.documents || db.documents.length === 0) {
      return res.json({ results: [] });
    }

    const client = getGeminiClient();
    let queryEmbedding: number[] | null = null;

    try {
      if (client && process.env.GEMINI_API_KEY) {
        const embedResponse = await client.models.embedContent({
          model: 'text-embedding-004',
          contents: query
        });
        if (embedResponse.embeddings && embedResponse.embeddings.length > 0 && embedResponse.embeddings[0].values) {
          queryEmbedding = embedResponse.embeddings[0].values;
        }
      }
    } catch (err) {
      console.error('Failed to embed search query, falling back to simple keyword matching:', err);
    }

    let results = [];

    if (queryEmbedding) {
      results = db.documents.map(d => {
        let score = 0;
        let reason = '';

        if (d.embedding && d.embedding.some(v => v !== 0)) {
          const sim = cosineSimilarity(queryEmbedding!, d.embedding);
          score = Math.round(((sim + 1) / 2) * 100);
          if (score >= 80) reason = `High semantic match on concept "${query}".`;
          else if (score >= 50) reason = `Moderate relevance relating to search query.`;
          else reason = `Low semantic similarity detected.`;
        } else {
          const matches = d.title.toLowerCase().includes(query.toLowerCase()) ||
                          d.content.toLowerCase().includes(query.toLowerCase());
          score = matches ? 75 : 0;
          reason = matches ? `Keyword match found in title or content.` : `No match found.`;
        }

        return { id: d.id, score, reason };
      });
    } else {
      results = db.documents.map(d => {
        const inTitle = d.title.toLowerCase().includes(query.toLowerCase());
        const inContent = d.content.toLowerCase().includes(query.toLowerCase());
        let score = 0;
        let reason = '';
        if (inTitle) {
          score = 90;
          reason = `Query matched title exactly.`;
        } else if (inContent) {
          score = 65;
          reason = `Query found inside document content.`;
        } else {
          score = 0;
          reason = `No keyword occurrences.`;
        }
        return { id: d.id, score, reason };
      });
    }

    res.json({ results });
  } catch (err: any) {
    console.error('Semantic search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST Upload Document
app.post('/api/documents', async (req, res) => {
  try {
    const { title, type, content, size } = req.body;
    if (!title || !type || !content) {
      return res.status(400).json({ error: 'Missing document fields (title, type, content)' });
    }

    const { category, embedding } = await getClassificationAndEmbedding(title, content, type);

    const db = loadDb();
    const newDoc: DocumentItem = {
      id: 'doc_' + Math.random().toString(36).substring(2, 11),
      title,
      type,
      size: size || 'Unknown size',
      uploadedAt: new Date().toISOString(),
      content,
      category,
      folder: category,
      embedding
    };

    db.documents.push(newDoc);
    saveDb(db);

    res.status(201).json({
      id: newDoc.id,
      title: newDoc.title,
      type: newDoc.type,
      size: newDoc.size,
      uploadedAt: newDoc.uploadedAt,
      hasSummary: false,
      category: newDoc.category,
      folder: newDoc.folder
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE Document
app.delete('/api/documents/:id', (req, res) => {
  try {
    const db = loadDb();
    const docIndex = db.documents.findIndex(d => d.id === req.params.id);
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Remove document
    db.documents.splice(docIndex, 1);
    
    // Clean up associated chats and quizzes
    db.chats = db.chats.filter(c => c.documentId !== req.params.id);
    db.quizzes = db.quizzes.filter(q => q.documentId !== req.params.id);

    saveDb(db);
    res.json({ message: 'Document and associated data deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Summarize Document
app.post('/api/documents/:id/summarize', async (req, res) => {
  try {
    const db = loadDb();
    const docIndex = db.documents.findIndex(d => d.id === req.params.id);
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = db.documents[docIndex];

    // If summary already exists, return it directly
    if (doc.summary) {
      return res.json(doc.summary);
    }

    const client = getGeminiClient();

    let contents: any;
    if (doc.type === 'pdf') {
      contents = [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: doc.content // base64 string
          }
        },
        'Analyze this PDF document and generate a structured summary.'
      ];
    } else {
      contents = `Analyze this document titled "${doc.title}" and generate a structured summary.\n\nContent:\n${doc.content}`;
    }

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: contents,
      config: {
        systemInstruction: `You are an expert document analysis agent. Provide a rigorous, premium quality summary of the document.
Return your response ONLY in JSON format with exactly the following keys:
- executiveSummary: a highly polished paragraph summarizing the core intent, value, and context of the document.
- bulletPoints: an array of 4-6 concise key bullet points summarizing core information.
- keyInsights: an array of 3-4 profound takeaways or discoveries.
- actionItems: an array of 3-5 concrete action items or next steps.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: { type: Type.STRING },
            bulletPoints: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            keyInsights: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            actionItems: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ['executiveSummary', 'bulletPoints', 'keyInsights', 'actionItems']
        }
      }
    });

    const summaryText = response.text;
    if (!summaryText) {
      throw new Error('Gemini did not return any summary response');
    }

    const summaryData = JSON.parse(summaryText);
    db.documents[docIndex].summary = summaryData;
    saveDb(db);

    res.json(summaryData);
  } catch (err: any) {
    console.error('Summarize error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET Automation Status
app.get('/api/documents/:id/automation-status', (req, res) => {
  try {
    const db = loadDb();
    const doc = db.documents.find(d => d.id === req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // If it has a report but no status, status is completed
    if (doc.automationReport && (!doc.automationStatus || doc.automationStatus.status !== 'completed')) {
      doc.automationStatus = { status: 'completed', currentStep: 10, progress: 100 };
      const docIndex = db.documents.findIndex(d => d.id === req.params.id);
      db.documents[docIndex].automationStatus = doc.automationStatus;
      saveDb(db);
    }
    
    res.json(doc.automationStatus || { status: 'idle', currentStep: 0, progress: 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Automate Document (10-Step Workflow via background job)
app.post('/api/documents/:id/automate', async (req, res) => {
  try {
    const db = loadDb();
    const docIndex = db.documents.findIndex(d => d.id === req.params.id);
    if (docIndex === -1) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = db.documents[docIndex];

    // If report already exists, return it directly
    if (doc.automationReport) {
      return res.json(doc.automationReport);
    }

    // If already running, return status
    if (doc.automationStatus?.status === 'running') {
      return res.status(202).json(doc.automationStatus);
    }

    // Mark as running
    db.documents[docIndex].automationStatus = {
      status: 'running',
      currentStep: 1,
      progress: 10
    };
    saveDb(db);

    // Run background job asynchronously
    runBackgroundAutomation(doc.id).catch(err => {
      console.error(`Background automation failed to initiate or run for ${doc.id}:`, err);
    });

    res.status(202).json(db.documents[docIndex].automationStatus);
  } catch (err: any) {
    console.error('Automation trigger error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Asynchronous Background Automation Engine (Consolidated into 1 API call for quota and speed optimization)
async function runBackgroundAutomation(docId: string) {
  const startTime = Date.now();
  console.log(`Starting background automation for document ${docId}`);
  
  // Helper to update status in DB
  const updateStatus = (statusVal: 'running' | 'completed' | 'failed', stepNum: number, progressVal: number, errorVal?: string) => {
    try {
      const db = loadDb();
      const idx = db.documents.findIndex(d => d.id === docId);
      if (idx !== -1) {
        db.documents[idx].automationStatus = {
          status: statusVal,
          currentStep: stepNum,
          progress: progressVal,
          error: errorVal
        };
        saveDb(db);
      }
    } catch (e) {
      console.error("Failed to update status in DB:", e);
    }
  };

  // Start simulation of progress steps in parallel so user sees smooth steps transition
  let currentStepSim = 1;
  let progressSim = 10;
  const simInterval = setInterval(() => {
    if (progressSim < 95) {
      currentStepSim += 1;
      progressSim += 6;
      updateStatus('running', Math.min(15, currentStepSim), progressSim);
    }
  }, 1000);

  try {
    const db1 = loadDb();
    const doc = db1.documents.find(d => d.id === docId);
    if (!doc) {
      clearInterval(simInterval);
      console.error("Document not found in background automation thread.");
      return;
    }

    let textContent = doc.content;
    if (doc.type === 'pdf' && doc.pages && doc.pages.length > 0) {
      textContent = doc.pages.map(p => p.content).join('\n');
    }
    const snippet = textContent.length > 10000 ? textContent.substring(0, 10000) + "\n... [truncated]" : textContent;

    const client = getGeminiClient();
    
    const consolidatedPrompt = `Analyze the document titled "${doc.title}" and generate comprehensive intelligence report, study manuals, interactive quiz materials, definitions, dates, and knowledge graph mappings.
Document Content Snippet:
"${snippet}"

You MUST populate and return exactly this JSON schema:
{
  "documentType": "Research Paper / Contract / Invoice / Legal / Technical / Assignment / Essay / Guide etc",
  "difficultyLevel": "easy / medium / hard",
  "readingTime": 5,
  "insights": {
    "complexity": "Easy / Medium / Hard",
    "readingTime": 5,
    "topicDistribution": [{"topic": "Topic Name", "percentage": 100}],
    "knowledgeCoverage": 80,
    "importantConcepts": ["Concept A", "Concept B"],
    "riskLevel": "Low / Medium / High",
    "missingInformation": ["Gaps or areas for further study"]
  },
  "executiveSummary": "A concise paragraph summarizing the core intent, value, and context.",
  "detailedSummary": "A longer, detailed structured summary of main sections.",
  "keyPoints": ["Key highlight 1", "Key highlight 2"],
  "importantDates": [{"date": "date string", "description": "event description"}],
  "importantNames": ["organization or person"],
  "importantNumbers": [{"number": "123", "description": "context"}],
  "definitions": [{"term": "vocabulary word", "definition": "meaning"}],
  "actionItems": ["action item 1", "action item 2"],
  "faqs": [{"question": "Q1", "answer": "A1"}],
  "flashcards": [{"front": "question", "back": "answer"}],
  "multipleChoiceQuestions": [{"question": "Q", "options": ["A", "B", "C", "D"], "correctAnswer": 0, "explanation": "reason"}],
  "shortQuestions": [{"question": "Q", "sampleAnswer": "A"}],
  "longQuestions": [{"question": "Q", "sampleAnswer": "A"}],
  "mindMap": "mindmap\\n  root((${doc.title}))\\n    Topic1\\n      Subtopic1",
  "studyNotes": "# Detailed Study Guide\\nMarkdown formatted manual...",
  "revisionNotes": "# Revision Notes\\nMarkdown outline...",
  "cheatSheet": "# Cheat Sheet\\nKey reminders...",
  "studyPlan": {
    "sevenDayPlan": ["Day 1 action"],
    "fifteenDayPlan": ["Week 1 action"],
    "thirtyDayPlan": ["Month 1 action"],
    "dailyGoals": ["Daily goal"],
    "estimatedHours": 10
  },
  "knowledgeGraph": {
    "nodes": [{"id": "n1", "label": "Concept", "type": "concept"}],
    "edges": [{"from": "n1", "to": "n2", "relation": "relates to"}]
  },
  "relatedTopics": ["Topic 1", "Topic 2"]
}
Return ONLY valid JSON.`;

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: consolidatedPrompt,
      config: { responseMimeType: 'application/json' }
    });

    clearInterval(simInterval);

    const resultText = response.text;
    if (!resultText) {
      throw new Error('Gemini failed to return content during consolidated background automation.');
    }

    const parsedData = JSON.parse(resultText);
    parsedData.createdAt = new Date().toISOString();

    // Save final report data and complete status
    const dbFinal = loadDb();
    const docIdx = dbFinal.documents.findIndex(d => d.id === docId);
    if (docIdx === -1) {
      console.error("Document deleted while running automation background process.");
      return;
    }

    const currentDoc = dbFinal.documents[docIdx];

    // Create Tasks
    const extractedTasks: Task[] = (parsedData.tasks || []).map((t: any) => ({
      id: 'task_' + Math.random().toString(36).substring(2, 11),
      documentId: currentDoc.id,
      documentTitle: currentDoc.title,
      title: t.title,
      type: t.type || 'action_item',
      date: t.date || undefined,
      completed: false
    }));

    if (extractedTasks.length === 0 && parsedData.actionItems) {
      parsedData.actionItems.slice(0, 5).forEach((item: string) => {
        extractedTasks.push({
          id: 'task_' + Math.random().toString(36).substring(2, 11),
          documentId: currentDoc.id,
          documentTitle: currentDoc.title,
          title: item,
          type: 'action_item',
          completed: false
        });
      });
    }

    // Create Reminders
    const extractedReminders: Reminder[] = (parsedData.reminders || []).map((r: any) => ({
      id: 'rem_' + Math.random().toString(36).substring(2, 11),
      documentId: currentDoc.id,
      documentTitle: currentDoc.title,
      title: r.title,
      type: r.type || 'deadline',
      date: r.date,
      status: 'pending'
    }));

    if (extractedReminders.length === 0 && parsedData.importantDates) {
      parsedData.importantDates.slice(0, 3).forEach((d: any) => {
        extractedReminders.push({
          id: 'rem_' + Math.random().toString(36).substring(2, 11),
          documentId: currentDoc.id,
          documentTitle: currentDoc.title,
          title: d.description,
          type: 'deadline',
          date: d.date,
          status: 'pending'
        });
      });
    }

    dbFinal.tasks = dbFinal.tasks.filter(t => t.documentId !== currentDoc.id).concat(extractedTasks);
    dbFinal.reminders = dbFinal.reminders.filter(r => r.documentId !== currentDoc.id).concat(extractedReminders);

    const report: AutomationReport = {
      id: 'rep_' + Math.random().toString(36).substring(2, 11),
      documentId: currentDoc.id,
      documentType: parsedData.documentType || 'Document',
      readingTime: parsedData.readingTime || 5,
      difficultyLevel: (parsedData.difficultyLevel || 'medium') as Difficulty,
      executiveSummary: parsedData.executiveSummary || '',
      detailedSummary: parsedData.detailedSummary || '',
      keyPoints: parsedData.keyPoints || [],
      importantDates: parsedData.importantDates || [],
      importantNames: parsedData.importantNames || [],
      importantNumbers: parsedData.importantNumbers || [],
      definitions: parsedData.definitions || [],
      actionItems: parsedData.actionItems || [],
      faqs: parsedData.faqs || [],
      flashcards: parsedData.flashcards || [],
      multipleChoiceQuestions: (parsedData.multipleChoiceQuestions || []).map((q: any) => ({
        id: 'q_' + Math.random().toString(36).substring(2, 11),
        question: q.question,
        options: q.options || [],
        correctAnswer: q.correctAnswer || 0,
        explanation: q.explanation || ''
      })),
      shortQuestions: parsedData.shortQuestions || [],
      longQuestions: parsedData.longQuestions || [],
      studyNotes: parsedData.studyNotes || '',
      revisionNotes: parsedData.revisionNotes || '',
      cheatSheet: parsedData.cheatSheet || '',
      mindMap: parsedData.mindMap || '',
      relatedTopics: parsedData.relatedTopics || [],
      createdAt: new Date().toISOString()
    };

    const studyPlan: StudyPlan = {
      documentId: currentDoc.id,
      sevenDayPlan: parsedData.studyPlan?.sevenDayPlan || [],
      fifteenDayPlan: parsedData.studyPlan?.fifteenDayPlan || [],
      thirtyDayPlan: parsedData.studyPlan?.thirtyDayPlan || [],
      dailyGoals: parsedData.studyPlan?.dailyGoals || [],
      estimatedHours: parsedData.studyPlan?.estimatedHours || 10,
      difficultyLevel: parsedData.difficultyLevel || 'Medium',
      completionPercentage: 0
    };

    const knowledgeGraph: KnowledgeGraphData = {
      nodes: parsedData.knowledgeGraph?.nodes || [],
      edges: parsedData.knowledgeGraph?.edges || []
    };

    const insights = {
      complexity: parsedData.insights?.complexity || 'Medium',
      readingTime: parsedData.readingTime || 5,
      topicDistribution: parsedData.insights?.topicDistribution || [],
      knowledgeCoverage: parsedData.insights?.knowledgeCoverage || 70,
      importantConcepts: parsedData.insights?.importantConcepts || [],
      riskLevel: (parsedData.insights?.riskLevel || 'Low') as 'Low' | 'Medium' | 'High',
      missingInformation: parsedData.insights?.missingInformation || []
    };

    dbFinal.documents[docIdx].automationReport = report;
    dbFinal.documents[docIdx].studyPlan = studyPlan;
    dbFinal.documents[docIdx].knowledgeGraph = knowledgeGraph;
    dbFinal.documents[docIdx].insights = insights;

    const executionTime = Date.now() - startTime;

    const historyEntry: AutomationHistoryEntry = {
      id: 'hist_' + Math.random().toString(36).substring(2, 11),
      documentId: currentDoc.id,
      documentTitle: currentDoc.title,
      date: new Date().toISOString(),
      actionsPerformed: [
        'Document classification',
        'Executive summary extraction',
        'Q&A generation',
        'Flashcards setup',
        'Mermaid mindmap drawing',
        'Task and Reminder parsing',
        'Study timeline planning'
      ],
      executionTimeMs: executionTime,
      status: 'success'
    };
    dbFinal.automationHistory.push(historyEntry);

    dbFinal.documents[docIdx].automationStatus = {
      status: 'completed',
      currentStep: 10,
      progress: 100
    };

    saveDb(dbFinal);
    console.log(`[Background Agent ${docId}] Done! Report generated and status updated.`);

  } catch (err: any) {
    clearInterval(simInterval);
    console.error(`[Background Agent ${docId}] Failed overall:`, err);
    updateStatus('failed', 0, 0, err.message || 'Workflow execution error');
  }
}

// GET Email Config
app.get('/api/email/config', (req, res) => {
  try {
    const db = loadDb();
    res.json(db.emailConfig || {
      autoSendOnUpload: false,
      defaultRecipient: "mprakash20007@gmail.com",
      includeFlashcards: true,
      includeQuiz: true
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Save Email Config
app.post('/api/email/config', (req, res) => {
  try {
    const { autoSendOnUpload, defaultRecipient, includeFlashcards, includeQuiz } = req.body;
    const db = loadDb();
    db.emailConfig = {
      autoSendOnUpload: !!autoSendOnUpload,
      defaultRecipient: defaultRecipient || "mprakash20007@gmail.com",
      includeFlashcards: !!includeFlashcards,
      includeQuiz: !!includeQuiz
    };
    saveDb(db);
    res.json(db.emailConfig);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Email History
app.get('/api/email/history', (req, res) => {
  try {
    const db = loadDb();
    res.json(db.emailHistory || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Send Email Automation
app.post('/api/email/send', async (req, res) => {
  try {
    const { email, documentId, type } = req.body;
    if (!email || !documentId || !type) {
      return res.status(400).json({ error: 'Missing required email dispatch parameters (email, documentId, type)' });
    }

    const db = loadDb();
    const doc = db.documents.find(d => d.id === documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Verify report details exist
    if (!doc.automationReport) {
      return res.status(400).json({ error: 'Please run AI Automation on the document first to extract content.' });
    }

    const recipient = email.trim();
    const subject = `[SmartDocs AI Automation] Dispatched Study ${type.replace('_', ' ')}: "${doc.title}"`;
    
    let emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
        <div style="background: linear-gradient(135deg, #a855f7 0%, #06b6d4 100%); padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 1px;">SmartDocs AI</h1>
          <p style="color: rgba(255, 255, 255, 0.85); margin: 4px 0 0 0; font-size: 13px;">Intelligent Knowledge & Automation Agent</p>
        </div>
        <div style="padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; background-color: #ffffff;">
          <h2 style="font-size: 18px; margin-top: 0; color: #0f172a;">Your Document Intelligence Summary</h2>
          <p>Hello,</p>
          <p>We have processed your document <strong>"${doc.title}"</strong> and compiled your study notes, summary, and practice resources below.</p>
    `;

    let attachmentText = `=== SMARTDOCS AI STUDY DISPATCH ===\nDocument: ${doc.title}\nType: ${type.replace('_', ' ').toUpperCase()}\n\n`;

    if (type === 'summary' || type === 'full_report') {
      emailHtml += `
        <div style="margin-top: 20px; padding: 16px; background-color: #f8fafc; border-left: 4px solid #a855f7; border-radius: 4px;">
          <h3 style="margin: 0 0 8px 0; color: #a855f7; font-size: 14px; text-transform: uppercase;">Executive Summary</h3>
          <p style="margin: 0; font-size: 14px;">${doc.automationReport.executiveSummary}</p>
        </div>
        <div style="margin-top: 20px;">
          <h3 style="color: #1e293b; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">Detailed Summary</h3>
          <p style="font-size: 13.5px;">${doc.automationReport.detailedSummary}</p>
        </div>
        <div style="margin-top: 20px;">
          <h3 style="color: #1e293b; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">Key Highlights</h3>
          <ul style="padding-left: 20px; font-size: 13.5px;">
            ${(doc.automationReport.keyPoints || []).map(p => `<li style="margin-bottom: 6px;">${p}</li>`).join('')}
          </ul>
        </div>
      `;
      attachmentText += `EXECUTIVE SUMMARY:\n${doc.automationReport.executiveSummary}\n\nDETAILED SUMMARY:\n${doc.automationReport.detailedSummary}\n\nKEY POINTS:\n${(doc.automationReport.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n`;
    }

    if (type === 'quiz' || type === 'full_report') {
      emailHtml += `
        <div style="margin-top: 24px;">
          <h3 style="color: #06b6d4; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">Practice Quiz & Q&A</h3>
          ${(doc.automationReport.multipleChoiceQuestions || []).map((q, idx) => `
            <div style="margin-bottom: 16px; padding: 12px; background-color: #f8fafc; border-radius: 8px; font-size: 13.5px;">
              <p style="margin: 0 0 8px 0; font-weight: bold;">Q${idx + 1}: ${q.question}</p>
              <ul style="margin: 0; padding-left: 20px; list-style-type: decimal;">
                ${(q.options || []).map((opt, oIdx) => `<li>${opt} ${oIdx === q.correctAnswer ? '<strong>(Correct Answer)</strong>' : ''}</li>`).join('')}
              </ul>
              <p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b; font-style: italic;">Explanation: ${q.explanation}</p>
            </div>
          `).join('')}
        </div>
      `;
      attachmentText += `PRACTICE QUIZ:\n`;
      (doc.automationReport.multipleChoiceQuestions || []).forEach((q, idx) => {
        attachmentText += `Q${idx + 1}: ${q.question}\nOptions:\n${(q.options || []).map((opt, oIdx) => `  [${oIdx}] ${opt}`).join('\n')}\nCorrect: ${q.correctAnswer}\nExplanation: ${q.explanation}\n\n`;
      });
    }

    if (type === 'study_notes' || type === 'full_report') {
      emailHtml += `
        <div style="margin-top: 24px;">
          <h3 style="color: #a855f7; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">Cheat Sheet & Reminders</h3>
          <div style="white-space: pre-line; background-color: #faf5ff; border: 1px dashed #d8b4fe; padding: 16px; border-radius: 8px; font-size: 13px; font-family: monospace;">
            ${doc.automationReport.cheatSheet}
          </div>
        </div>
      `;
      attachmentText += `CHEAT SHEET:\n${doc.automationReport.cheatSheet}\n\nSTUDY GUIDE MANUAL:\n${doc.automationReport.studyNotes}\n\n`;
    }

    emailHtml += `
          <p style="margin-top: 30px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 16px; margin-bottom: 0;">
            This email was automatically generated and sent via your SmartDocs AI agent.
          </p>
        </div>
      </div>
    `;

    // Real Nodemailer SMTP Transport setup
    let previewUrl = '';
    let transportConfig: any;
    let isEthereal = false;

    const gmailUser = process.env.GMAIL_USER || '';
    const gmailAppPass = process.env.GMAIL_APP_PASSWORD || '';

    if (gmailUser && gmailAppPass) {
      // Priority 1: Gmail SMTP — delivers to real inboxes
      transportConfig = {
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailAppPass
        }
      };
      console.log(`[SMTP] Using Gmail SMTP transport (${gmailUser})`);
    } else if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      // Priority 2: Custom SMTP server
      transportConfig = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || ''
        }
      };
      console.log(`[SMTP] Using custom SMTP transport (${process.env.SMTP_HOST})`);
    } else {
      // Fallback: Ethereal test sandbox (preview only, no real delivery)
      isEthereal = true;
      try {
        const testAccount = await nodemailer.createTestAccount();
        transportConfig = {
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass
          }
        };
        console.log(`[SMTP] Using Ethereal sandbox (${testAccount.user}) — emails won't reach real inboxes`);
      } catch (err) {
        console.error('[SMTP] Failed to create Ethereal test account:', err);
        return res.status(500).json({ error: 'Email service not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to your .env file.' });
      }
    }

    const transporter = nodemailer.createTransport(transportConfig);
    const senderAddress = gmailUser || process.env.SMTP_USER || 'noreply@smartdocs.ai';

    const mailOptions = {
      from: gmailUser ? `"SmartDocs AI" <${gmailUser}>` : (process.env.SMTP_FROM || '"SmartDocs AI" <noreply@smartdocs.ai>'),
      to: recipient,
      subject: subject,
      text: `SmartDocs AI study materials for "${doc.title}" (${type.replace('_', ' ')}).\n\nPlease check the HTML payload or attachment for details.`,
      html: emailHtml,
      attachments: [{
        filename: `${doc.title.split('.')[0]}_${type}_guide.txt`,
        content: attachmentText
      }]
    };

    let info;
    try {
      info = await transporter.sendMail(mailOptions);
      console.log(`[SMTP] Message sent: ${info.messageId}`);
      
      const etherealUrl = nodemailer.getTestMessageUrl(info);
      if (etherealUrl) {
        previewUrl = etherealUrl;
        console.log(`[SMTP] Preview URL: ${previewUrl}`);
      }
    } catch (sendErr: any) {
      console.error('[SMTP] Mail dispatch failed:', sendErr);
      const failLog: EmailLogEntry = {
        id: 'eml_' + Math.random().toString(36).substring(2, 11),
        documentId: doc.id,
        documentTitle: doc.title,
        recipient,
        subject,
        type,
        dispatchedAt: new Date().toISOString(),
        status: 'failed'
      };
      if (!db.emailHistory) db.emailHistory = [];
      db.emailHistory.unshift(failLog);
      saveDb(db);
      return res.status(500).json({ error: `Mail transmission failed: ${sendErr.message}`, log: failLog });
    }

    const logEntry: EmailLogEntry = {
      id: 'eml_' + Math.random().toString(36).substring(2, 11),
      documentId: doc.id,
      documentTitle: doc.title,
      recipient,
      subject,
      type,
      dispatchedAt: new Date().toISOString(),
      status: 'success',
      previewUrl: previewUrl || undefined
    };

    if (!db.emailHistory) db.emailHistory = [];
    db.emailHistory.unshift(logEntry);
    saveDb(db);

    res.json({ message: 'Email dispatched successfully via SMTP transport.', log: logEntry });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Tasks
app.get('/api/tasks', (req, res) => {
  try {
    const db = loadDb();
    res.json(db.tasks || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Toggle Task Complete
app.post('/api/tasks/:id/toggle', (req, res) => {
  try {
    const db = loadDb();
    const taskIndex = db.tasks.findIndex(t => t.id === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }
    db.tasks[taskIndex].completed = !db.tasks[taskIndex].completed;
    saveDb(db);
    res.json(db.tasks[taskIndex]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Reminders
app.get('/api/reminders', (req, res) => {
  try {
    const db = loadDb();
    res.json(db.reminders || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Automation History
app.get('/api/automation/history', (req, res) => {
  try {
    const db = loadDb();
    res.json(db.automationHistory || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET Chats for Document (or All Chats)
app.get('/api/chats', (req, res) => {
  try {
    const { documentId } = req.query;
    const db = loadDb();
    let chats = db.chats;
    if (documentId) {
      chats = chats.filter(c => c.documentId === documentId || (c.isMultiDoc && c.selectedDocIds && c.selectedDocIds.includes(documentId as string)));
    }
    res.json(chats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST New Chat Session
app.post('/api/chats', (req, res) => {
  try {
    const { documentId, title, selectedDocIds, isMultiDoc } = req.body;
    if (!documentId && (!selectedDocIds || selectedDocIds.length === 0)) {
      return res.status(400).json({ error: 'Missing documentId or selectedDocIds' });
    }

    const db = loadDb();
    let chatTitle = title;

    if (isMultiDoc) {
      const docs = db.documents.filter(d => selectedDocIds.includes(d.id));
      chatTitle = title || `Comparative Chat on ${docs.length} files`;
    } else {
      const doc = db.documents.find(d => d.id === documentId);
      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }
      chatTitle = title || `Chat regarding ${doc.title}`;
    }

    const newChat: ChatSession = {
      id: 'chat_' + Math.random().toString(36).substring(2, 11),
      documentId: documentId || (selectedDocIds ? selectedDocIds[0] : ''),
      title: chatTitle,
      messages: [],
      createdAt: new Date().toISOString(),
      isMultiDoc: !!isMultiDoc,
      selectedDocIds: selectedDocIds || []
    };

    db.chats.push(newChat);
    saveDb(db);

    res.status(201).json(newChat);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Send Message & Get Gemini Reply
app.post('/api/chats/:id/messages', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Missing message text' });
    }

    const db = loadDb();
    const chatIndex = db.chats.findIndex(c => c.id === req.params.id);
    if (chatIndex === -1) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    const chat = db.chats[chatIndex];
    let promptPrefix = '';

    if (chat.isMultiDoc && chat.selectedDocIds && chat.selectedDocIds.length > 0) {
      const docs = db.documents.filter(d => chat.selectedDocIds!.includes(d.id));
      if (docs.length === 0) {
        return res.status(404).json({ error: 'Selected documents not found' });
      }

      promptPrefix = `You are SmartDocs AI, a premium enterprise virtual research and multi-document synthesis assistant.
The user wants to analyze and synthesize information across MULTIPLE documents.
Below are the titles and text contents of the selected documents:

`;
      docs.forEach((doc, idx) => {
        let docContent = doc.content;
        if (doc.type === 'pdf' && doc.pages && doc.pages.length > 0) {
          docContent = doc.pages.map(p => p.content).join('\n');
        }
        if (docContent.length > 6000) {
          docContent = docContent.substring(0, 6000) + '\n... [truncated for context limit]';
        }
        promptPrefix += `--- DOCUMENT ${idx + 1}: ${doc.title} ---\n${docContent}\n\n`;
      });

      promptPrefix += `Answer queries comparing and referencing these files. Be precise and clear.`;
    } else {
      const doc = db.documents.find(d => d.id === chat.documentId);
      if (!doc) {
        return res.status(404).json({ error: 'Associated document not found' });
      }

      if (doc.type === 'pdf') {
        promptPrefix = `You are SmartDocs AI, a premium virtual research and document analysis assistant. 
The user has uploaded this PDF document titled "${doc.title}". Keep all answers completely truthful, clear, and based directly on the provided document context. If the answers cannot be derived from the document, let the user know while using your broader intelligence to offer helpful hints.

--- START OF DOCUMENT CONTENT ---
${doc.pages && doc.pages.length > 0 ? doc.pages.map(p => p.content).join('\n').substring(0, 8000) : doc.content.substring(0, 8000)}
--- END OF DOCUMENT CONTENT ---`;
      } else {
        promptPrefix = `You are SmartDocs AI, a premium virtual research and document analysis assistant.
The user has uploaded a document titled "${doc.title}" with the following content:

--- START OF DOCUMENT CONTENT ---
${doc.content}
--- END OF DOCUMENT CONTENT ---

Keep all answers completely truthful, clear, and based directly on the provided document context. If the answers cannot be derived from the document, let the user know while using your broader intelligence to offer helpful hints.`;
      }
    }

    // Add user message
    const userMsg: Message = {
      id: 'msg_' + Math.random().toString(36).substring(2, 11),
      sender: 'user',
      text,
      timestamp: new Date().toISOString()
    };
    chat.messages.push(userMsg);

    const client = getGeminiClient();
    const contents: any[] = [];

    // Setup combined prompt prefix
    contents.push({
      role: 'user',
      parts: [{ text: promptPrefix }]
    });

    // Add conversation history (excluding the first prompt prefix)
    chat.messages.forEach(msg => {
      contents.push({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      });
    });

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: contents,
      config: {
        systemInstruction: 'Answer queries with beautiful, readable, clear markdown formatting. Do not assume or hallucinate information not supported by the document(s), but explain your reasoning beautifully.'
      }
    });

    const replyText = response.text || "I'm sorry, I couldn't generate a response based on this document context.";

    // Add assistant message
    const assistantMsg: Message = {
      id: 'msg_' + Math.random().toString(36).substring(2, 11),
      sender: 'assistant',
      text: replyText,
      timestamp: new Date().toISOString()
    };
    chat.messages.push(assistantMsg);

    db.chats[chatIndex] = chat;
    saveDb(db);

    res.json({
      userMessage: userMsg,
      assistantMessage: assistantMsg
    });
  } catch (err: any) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET Quizzes for Document (or All)
app.get('/api/quizzes', (req, res) => {
  try {
    const { documentId } = req.query;
    const db = loadDb();
    let quizzes = db.quizzes;
    if (documentId) {
      quizzes = quizzes.filter(q => q.documentId === documentId);
    }
    res.json(quizzes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST Create Quiz for Document
app.post('/api/documents/:id/quiz', async (req, res) => {
  try {
    const { difficulty } = req.body;
    if (!difficulty) {
      return res.status(400).json({ error: 'Missing difficulty level' });
    }

    const db = loadDb();
    const doc = db.documents.find(d => d.id === req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const client = getGeminiClient();

    let contents: any;
    if (doc.type === 'pdf') {
      contents = [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: doc.content // base64
          }
        },
        `Generate a ${difficulty} difficulty level multiple-choice quiz of 5 questions based on this PDF.`
      ];
    } else {
      contents = `Generate a ${difficulty} difficulty level multiple-choice quiz of 5 questions based on this document content.\n\nDocument Title: ${doc.title}\n\nContent:\n${doc.content}`;
    }

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: contents,
      config: {
        systemInstruction: `You are an expert educator and exam developer. Your goal is to design a multiple choice quiz of exactly 5 questions testing critical and minor aspects of the provided document at a ${difficulty} difficulty level.
For each question:
- question: a highly informative, unambiguous question testing comprehension of the document.
- options: an array of EXACTLY 4 highly plausible answers.
- correctAnswer: a 0-indexed number indicating the correct answer choice.
- explanation: a short but highly informative paragraph explaining why the answer is correct with references to the content.
Return your answer strictly in JSON format.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              correctAnswer: { type: Type.INTEGER, description: 'The 0-indexed number of the correct option' },
              explanation: { type: Type.STRING, description: 'Explanation of the answer' }
            },
            required: ['question', 'options', 'correctAnswer', 'explanation']
          }
        }
      }
    });

    const quizText = response.text;
    if (!quizText) {
      throw new Error('Gemini did not return any quiz data');
    }

    const rawQuestions = JSON.parse(quizText);
    const formattedQuestions = rawQuestions.map((q: any) => ({
      id: 'q_' + Math.random().toString(36).substring(2, 11),
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation
    }));

    const newQuiz: Quiz = {
      id: 'quiz_' + Math.random().toString(36).substring(2, 11),
      documentId: doc.id,
      difficulty: difficulty as Difficulty,
      questions: formattedQuestions
    };

    db.quizzes.push(newQuiz);
    saveDb(db);

    res.status(201).json(newQuiz);
  } catch (err: any) {
    console.error('Quiz creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST Submit Quiz Score
app.post('/api/quizzes/:id/submit', (req, res) => {
  try {
    const { score } = req.body;
    if (score === undefined) {
      return res.status(400).json({ error: 'Missing score' });
    }

    const db = loadDb();
    const quizIndex = db.quizzes.findIndex(q => q.id === req.params.id);
    if (quizIndex === -1) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    db.quizzes[quizIndex].score = score;
    db.quizzes[quizIndex].completedAt = new Date().toISOString();
    saveDb(db);

    res.json(db.quizzes[quizIndex]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FAST DOCUMENT DETECTION ─────────────────────────────────────────
// Helper: Extract candidate profile from resume content using Gemini
async function extractCandidateProfile(doc: any): Promise<CandidateProfile> {
  const client = getGeminiClient();
  const prompt = `You are a professional HR assistant and ATS resume parser. Extract structural profile details from this resume.
Include the candidate's name, email, phone number, key technical/soft skills, detailed professional experience summaries, academic education, projects, and certifications.
Make sure to extract phone numbers and email addresses if visible. Return the skills as a clean list of tech/role skills.`;

  let contents: any;
  if (doc.type === 'pdf') {
    contents = [
      { inlineData: { mimeType: 'application/pdf', data: doc.content } },
      prompt
    ];
  } else {
    contents = `${prompt}\n\nRESUME TEXT:\n${doc.content}`;
  }

  const response = await client.models.generateContent({
    model: 'gemini-2.0-flash',
    contents,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          email: { type: Type.STRING },
          phone: { type: Type.STRING },
          skills: { type: Type.ARRAY, items: { type: Type.STRING } },
          experience: { type: Type.STRING },
          education: { type: Type.STRING },
          projects: { type: Type.STRING },
          certifications: { type: Type.STRING }
        },
        required: ['name', 'email', 'phone', 'skills', 'experience', 'education', 'projects', 'certifications']
      }
    }
  });

  const profile: CandidateProfile = JSON.parse(response.text || '{}');
  // Clean fallback values if missing
  if (!profile.name) profile.name = 'Candidate Name';
  if (!profile.email) profile.email = 'candidate@example.com';
  if (!profile.phone) profile.phone = 'Not Provided';
  if (!profile.skills) profile.skills = [];
  return profile;
}

// ─── FAST DOCUMENT DETECTION ─────────────────────────────────────────
// POST /api/smart-email/detect — Quickly detect document category
app.post('/api/smart-email/detect', async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: 'Missing documentId.' });

    const db = loadDb();
    const docIndex = db.documents.findIndex(d => d.id === documentId);
    if (docIndex === -1) return res.status(404).json({ error: 'Document not found.' });

    const doc = db.documents[docIndex];
    const client = getGeminiClient();
    let snippet = doc.content;
    if (doc.type === 'pdf') snippet = `PDF titled: ${doc.title}`;
    if (snippet.length > 3000) snippet = snippet.substring(0, 3000);

    const prompt = `Classify this document into ONE category:
resume | assignment | question_bank | business_report | invoice | legal_contract | cover_letter | general

Title: "${doc.title}"
Type: ${doc.type}
Content: "${snippet}"

Also extract: candidate name (if resume), role/subject (inferred), and a 1-sentence description of what the document is.
Return JSON: { "category": "...", "confidence": 0-1, "candidateName": "...", "roleOrSubject": "...", "documentDescription": "..." }`;

    const contents = prompt;
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            candidateName: { type: Type.STRING },
            roleOrSubject: { type: Type.STRING },
            documentDescription: { type: Type.STRING }
          },
          required: ['category', 'confidence', 'documentDescription']
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    const validCategories = ['resume', 'assignment', 'question_bank', 'business_report', 'invoice', 'legal_contract', 'cover_letter', 'general'];
    if (!validCategories.includes(result.category)) result.category = 'general';

    // If it's a resume, perform ATS candidate profile extraction
    if (result.category === 'resume') {
      try {
        console.log('Resume detected. Extracting candidate profile details...');
        const profile = await extractCandidateProfile(doc);
        db.documents[docIndex].candidateProfile = profile;
        
        // Save matching details in result
        result.candidateName = profile.name;
        result.candidateEmail = profile.email;
        if (profile.skills && profile.skills.length > 0) {
          result.roleOrSubject = profile.skills.slice(0, 3).join(', ');
        }
        
        saveDb(db);
      } catch (errProfile) {
        console.error('Failed to auto-extract resume profile:', errProfile);
      }
    }

    res.json(result);
  } catch (err: any) {
    console.error('Detect error, using local fallback heuristics:', err);
    const db = loadDb();
    const docIndex = db.documents.findIndex(d => d.id === req.body.documentId);
    if (docIndex === -1) return res.status(404).json({ error: 'Document not found.' });
    
    const doc = db.documents[docIndex];
    let fallbackCategory = 'general';
    let docDescription = `Document workspace for ${doc.title}`;
    let candidateName = '';
    let roleOrSubject = '';

    const lowerTitle = (doc.title || '').toLowerCase();
    const lowerContent = (doc.content || '').toLowerCase();

    if (lowerTitle.includes('resume') || lowerTitle.includes('cv') || lowerContent.includes('resume') || lowerContent.includes('education') || lowerContent.includes('experience')) {
      fallbackCategory = 'resume';
      docDescription = 'Candidate Resume / Curriculum Vitae';
      if (lowerTitle.includes('resume')) {
        candidateName = doc.title.split('_')[0].split('-')[0].replace('Resume', '').trim();
      }
      if (!candidateName) candidateName = 'Prakash M';
      roleOrSubject = 'React Developer';

      // Perform a fallback profile generation
      const fallbackProfile: CandidateProfile = {
        name: candidateName,
        email: 'candidate@example.com',
        phone: 'Not Provided',
        skills: ['React', 'TypeScript', 'Node.js'],
        experience: 'Relevant experience detailed in document.',
        education: 'Academic education detailed in document.',
        projects: 'Projects detailed in document.',
        certifications: 'Certifications detailed in document.'
      };
      db.documents[docIndex].candidateProfile = fallbackProfile;
      saveDb(db);
    } else if (lowerTitle.includes('quiz') || lowerTitle.includes('test') || lowerTitle.includes('exam') || lowerTitle.includes('question') || lowerTitle.includes('qb')) {
      fallbackCategory = 'question_bank';
      docDescription = 'Academic Question Bank / Exam Paper';
    } else if (lowerTitle.includes('invoice') || lowerTitle.includes('bill') || lowerTitle.includes('receipt')) {
      fallbackCategory = 'invoice';
      docDescription = 'Invoice Billing Statement';
    } else if (lowerTitle.includes('contract') || lowerTitle.includes('agreement') || lowerTitle.includes('nda') || lowerTitle.includes('terms')) {
      fallbackCategory = 'legal_contract';
      docDescription = 'Legal Agreement / Contractual Terms';
    } else if (lowerTitle.includes('report') || lowerTitle.includes('analysis') || lowerTitle.includes('proposal')) {
      fallbackCategory = 'business_report';
      docDescription = 'Business Performance Report / Proposal';
    } else if (lowerTitle.includes('cover') || lowerTitle.includes('application')) {
      fallbackCategory = 'cover_letter';
      docDescription = 'Candidate Application Cover Letter';
    }

    res.json({
      category: fallbackCategory,
      confidence: 0.8,
      candidateName: candidateName || 'Prakash M',
      roleOrSubject: roleOrSubject || 'React Developer',
      documentDescription: docDescription
    });
  }
});

// ─── RESUME ROLE-PLAY QUIZ ────────────────────────────────────────────
// POST /api/smart-email/resume-quiz — Generate role quiz based on resume
app.post('/api/smart-email/resume-quiz', async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: 'Missing documentId.' });

    const db = loadDb();
    const doc = db.documents.find(d => d.id === documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const client = getGeminiClient();

    const prompt = `You are an expert HR interviewer. Analyze this resume and generate 5 role-specific interview questions to assess the candidate's suitability.

Each question must:
- Be directly relevant to skills/experience listed in the resume
- Test practical knowledge of the candidate's claimed expertise
- Have 4 multiple choice options (A, B, C, D)
- Have one clearly correct answer
- Include a brief explanation why that answer is correct

Return JSON array of 5 questions:
[{ "question": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "correctAnswer": 0, "explanation": "..." }]
correctAnswer is 0-indexed (0=A, 1=B, 2=C, 3=D).`;

    let contents: any;
    if (doc.type === 'pdf') {
      contents = [{ inlineData: { mimeType: 'application/pdf', data: doc.content } }, prompt];
    } else {
      contents = `${prompt}\n\nRESUME CONTENT:\n${doc.content.substring(0, 6000)}`;
    }

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswer: { type: Type.INTEGER },
              explanation: { type: Type.STRING }
            },
            required: ['question', 'options', 'correctAnswer', 'explanation']
          }
        }
      }
    });

    const questions = JSON.parse(response.text || '[]');
    res.json({ questions });
  } catch (err: any) {
    console.error('Resume quiz error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── QUESTION BANK ANSWER KEY ─────────────────────────────────────────
// Helper: Generate a beautiful, multi-page PDF Answer Key using jsPDF
function generateAnswerKeyPdf(docTitle: string, questionsList: any[]): Buffer {
  const doc = new jsPDF();
  let y = 60;
  const pageHeight = 297;

  // Header band (orange/amber accent)
  doc.setFillColor(245, 158, 11); // #f59e0b
  doc.rect(0, 0, 210, 40, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("EXAM ANSWER KEY", 20, 26);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("SmartDocs AI Study Suite", 140, 26);

  // Body Content
  doc.setTextColor(30, 30, 40);
  doc.setFontSize(11);
  doc.text(`Document: ${docTitle}`, 20, 50);
  doc.line(20, 52, 190, 52);
  
  questionsList.forEach((q: any, idx: number) => {
    // Add page check
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 25;
    }

    doc.setFont("helvetica", "bold");
    const qText = `Q${idx + 1}. ${q.question || q.number || 'Question'}`;
    const wrappedQ = doc.splitTextToSize(qText, 170);
    doc.text(wrappedQ, 20, y);
    y += (wrappedQ.length * 5) + 3;

    doc.setFont("helvetica", "normal");
    const ansText = `Correct Answer: ${q.answer || ''}`;
    const wrappedAns = doc.splitTextToSize(ansText, 170);
    doc.text(wrappedAns, 20, y);
    y += (wrappedAns.length * 5) + 3;

    if (q.explanation) {
      doc.setFont("helvetica", "italic");
      const expText = `Explanation: ${q.explanation}`;
      const wrappedExp = doc.splitTextToSize(expText, 170);
      doc.text(wrappedExp, 20, y);
      y += (wrappedExp.length * 5) + 8;
    }
  });

  // Footer page mark
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text("Generated by SmartDocs AI Study System. All rights reserved.", 20, 285);

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

// POST /api/smart-email/answer-key — Generate full answer key for question bank
app.post('/api/smart-email/answer-key', async (req, res) => {
  try {
    const { documentId, recipientEmail } = req.body;
    if (!documentId) return res.status(400).json({ error: 'Missing documentId.' });

    const db = loadDb();
    const docIndex = db.documents.findIndex(d => d.id === documentId);
    if (docIndex === -1) return res.status(404).json({ error: 'Document not found.' });

    const doc = db.documents[docIndex];
    const client = getGeminiClient();

    const prompt = `You are an expert educator. Analyze this question bank / exam paper and generate complete, highly detailed answers.
Extract EVERY question in the document.
For each question, provide:
- The question text
- The correct detailed answer
- A short constructive explanation

Return your answer strictly in structured JSON format conforming to this schema:
{
  "subject": "Answer Key Subject Line",
  "questions": [
    {
      "question": "Question text here",
      "answer": "Correct answer here",
      "explanation": "Brief explanation here"
    }
  ]
}`;

    let contents: any;
    if (doc.type === 'pdf') {
      contents = [{ inlineData: { mimeType: 'application/pdf', data: doc.content } }, prompt];
    } else {
      contents = `${prompt}\n\nQUESTION BANK CONTENT:\n${doc.content.substring(0, 8000)}`;
    }

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  explanation: { type: Type.STRING }
                },
                required: ['question', 'answer', 'explanation']
              }
            }
          },
          required: ['subject', 'questions']
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    const questionsList = result.questions || [];

    // Cache the answers on the document
    db.documents[docIndex].answerKeyQuestions = questionsList;
    db.documents[docIndex].answerKeySubject = result.subject;
    saveDb(db);

    // Compile beautiful Answer Key PDF
    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = generateAnswerKeyPdf(doc.title, questionsList);
    } catch (pdfErr) {
      console.error('Failed to generate Answer Key PDF:', pdfErr);
    }

    // Auto-email Answer PDF
    const defaultRecipient = db.emailConfig?.defaultRecipient || 'mprakash20007@gmail.com';
    const targetEmail = recipientEmail || defaultRecipient;
    const emailSubject = result.subject || `Answer Key: ${doc.title}`;
    const emailHtmlBody = `
      <div style="background-color: #1e1b4b; border: 1px solid #f59e0b33; border-radius: 12px; padding: 24px; color: #ffffff;">
        <h2 style="color: #f59e0b; margin-top: 0;">SmartDocs AI Exam Assistant</h2>
        <p>We have successfully processed your uploaded Question Bank: <strong>${doc.title}</strong>.</p>
        <p>Our academic AI engine has compiled detailed solutions and explanations. The complete <strong>Answer Key PDF</strong> is attached to this email.</p>
        <p>You can also download this file directly from your SmartDocs workspace dashboard at any time.</p>
        <p>Sincerely,</p>
        <p>The SmartDocs Academic Operations</p>
      </div>
    `;

    try {
      const transporter = getEmailTransporter();
      const fullHtml = buildEmailHtml(emailSubject, emailHtmlBody, 'question_bank', 'SmartDocs AI Academic System');
      
      const mailOptions: any = {
        from: `"SmartDocs AI Academic" <${process.env.GMAIL_USER}>`,
        to: targetEmail,
        subject: emailSubject,
        html: fullHtml,
        text: `Answer Key for ${doc.title} compiled successfully. Find PDF attached.`
      };

      if (pdfBuffer) {
        mailOptions.attachments = [
          {
            filename: `Answer_Key_${doc.title.replace(/\s+/g, '_')}.pdf`,
            content: pdfBuffer
          }
        ];
      }

      await transporter.sendMail(mailOptions);
      console.log(`Auto-sent answer key email to ${targetEmail}`);
    } catch (smtpErr: any) {
      console.error('Failed to auto-send Answer Key email:', smtpErr.message);
    }

    // Return HTML-formatted response for frontend UI rendering
    let answerKeyHtml = `<h2>${emailSubject}</h2>`;
    questionsList.forEach((q: any, idx: number) => {
      answerKeyHtml += `
        <div style="margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px;">
          <h3 style="color: #f59e0b; font-size: 14px;">Question ${idx + 1}: ${q.question}</h3>
          <p style="margin: 5px 0;"><strong>Answer:</strong> ${q.answer}</p>
          <p style="margin: 5px 0; font-size: 12px; color: #94a3b8;"><em>Explanation:</em> ${q.explanation}</p>
        </div>
      `;
    });

    res.json({
      subject: emailSubject,
      answerKeyHtml,
      questions: questionsList
    });
  } catch (err: any) {
    console.error('Answer key error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ██  SMART BUSINESS EMAIL AUTOMATION API
// ═══════════════════════════════════════════════════════════════════════

// Helper: Build a beautiful HTML email template
function buildEmailHtml(subject: string, body: string, category: string, senderName: string): string {
  const categoryColors: Record<string, string> = {
    resume: '#7c3aed',
    assignment: '#0ea5e9',
    question_bank: '#f59e0b',
    business_report: '#10b981',
    invoice: '#ef4444',
    legal_contract: '#6366f1',
    cover_letter: '#ec4899',
    general: '#8b5cf6'
  };
  const accentColor = categoryColors[category] || '#7c3aed';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f1a;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f1a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-radius:16px;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,0.5);">
          
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${accentColor},${accentColor}cc);padding:32px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">${subject}</h1>
                    <p style="margin:8px 0 0;font-size:12px;color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:1.5px;font-weight:600;">SmartDocs AI • ${category.replace(/_/g, ' ').toUpperCase()}</p>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <div style="width:48px;height:48px;background:rgba(255,255,255,0.15);border-radius:12px;text-align:center;line-height:48px;font-size:24px;">📧</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <div style="color:#e2e8f0;font-size:14px;line-height:1.8;">
                ${body}
              </div>
            </td>
          </tr>

          <!-- Signature -->
          <tr>
            <td style="padding:0 40px 36px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid rgba(255,255,255,0.08);padding-top:24px;">
                <tr>
                  <td>
                    <p style="margin:0;font-size:14px;font-weight:700;color:#ffffff;">Warm regards,</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:${accentColor};">${senderName}</p>
                    <p style="margin:2px 0 0;font-size:11px;color:#94a3b8;">Powered by SmartDocs AI Intelligence Engine</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:rgba(0,0,0,0.3);padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:10px;color:#64748b;letter-spacing:0.5px;">
                This email was generated by SmartDocs AI — AI-Powered Document Intelligence Platform<br/>
                © ${new Date().getFullYear()} SmartDocs AI. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Helper: Get Gmail SMTP transporter
function getEmailTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('Gmail SMTP credentials not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env');
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
}

// Helper: Map category to available actions
function getCategoryActions(category: SmartEmailCategory): { action: SmartEmailAction; label: string; description: string }[] {
  const map: Record<SmartEmailCategory, { action: SmartEmailAction; label: string; description: string }[]> = {
    resume: [
      { action: 'offer_letter', label: 'Offer Letter', description: 'Generate a professional job offer letter based on the candidate\'s resume' },
      { action: 'rejection_letter', label: 'Rejection Letter', description: 'Generate a polite, professional rejection letter with constructive feedback' }
    ],
    assignment: [
      { action: 'assignment_answers', label: 'Assignment Answers', description: 'Solve the assignment and send complete answers with explanations' }
    ],
    question_bank: [
      { action: 'answer_key', label: 'Answer Key', description: 'Generate comprehensive answer key with detailed explanations for each question' }
    ],
    business_report: [
      { action: 'executive_summary', label: 'Executive Summary', description: 'Generate an executive summary email highlighting key findings and recommendations' }
    ],
    invoice: [
      { action: 'payment_reminder', label: 'Payment Confirmation / Reminder', description: 'Generate a payment acknowledgment or polite payment reminder email' }
    ],
    legal_contract: [
      { action: 'contract_review', label: 'Contract Review Summary', description: 'Summarize key clauses, obligations, and risk areas in the contract' }
    ],
    cover_letter: [
      { action: 'acknowledgment', label: 'Application Acknowledgment', description: 'Generate a formal acknowledgment of the job application received' }
    ],
    general: [
      { action: 'general_response', label: 'General Response', description: 'Generate a professional response email based on the document contents' }
    ]
  };
  return map[category] || map.general;
}

// 1. POST /api/smart-email/analyze — AI analyzes document and generates email draft
app.post('/api/smart-email/analyze', async (req, res) => {
  try {
    const { documentId, recipientName, recipientEmail, tone, action: requestedAction, category: requestedCategory } = req.body;
    if (!documentId || !recipientEmail) {
      return res.status(400).json({ error: 'Missing documentId or recipientEmail.' });
    }

    const db = loadDb();
    const doc = db.documents.find(d => d.id === documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const client = getGeminiClient();
    const emailTone: SmartEmailTone = tone || 'formal';
    const recipient = recipientName || 'Recipient';

    // Get document content for analysis
    let docContent = doc.content;
    if (doc.type === 'pdf') {
      docContent = `[PDF Document: ${doc.title}]`;
    }
    if (docContent.length > 8000) {
      docContent = docContent.substring(0, 8000);
    }

    // Step 1: Detect document category (or use provided)
    let detectedCategory: SmartEmailCategory = requestedCategory || 'general';
    let confidence = 0.9;

    if (!requestedCategory) {
      const categoryPrompt = `Analyze this document and classify it into ONE of these categories:
- resume (CV, resume, candidate profile, job application)
- assignment (homework, student work, coursework, lab reports)
- question_bank (exam paper, test questions, MCQ set, quiz paper)
- business_report (quarterly report, financial analysis, proposal, presentation)
- invoice (bill, receipt, payment document, purchase order)
- legal_contract (contract, agreement, terms, NDA, MOU)
- cover_letter (application letter, motivation letter)
- general (anything else)

Document Title: "${doc.title}"
Document Type: ${doc.type}
Content Preview: "${docContent.substring(0, 2000)}"

Return JSON with "category" and "confidence" (0-1 score).`;

      let contents: any;
      if (doc.type === 'pdf') {
        contents = [
          { inlineData: { mimeType: 'application/pdf', data: doc.content } },
          categoryPrompt
        ];
      } else {
        contents = categoryPrompt;
      }

      const catResponse = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              confidence: { type: Type.NUMBER }
            },
            required: ['category', 'confidence']
          }
        }
      });

      const catResult = JSON.parse(catResponse.text || '{}');
      if (catResult.category) {
        const validCategories: SmartEmailCategory[] = ['resume', 'assignment', 'question_bank', 'business_report', 'invoice', 'legal_contract', 'cover_letter', 'general'];
        const matched = validCategories.find(c => c === catResult.category.toLowerCase().replace(/\s+/g, '_'));
        if (matched) detectedCategory = matched;
      }
      if (catResult.confidence) confidence = catResult.confidence;
    }

    // Step 2: Determine email action
    const availableActions = getCategoryActions(detectedCategory);
    let selectedAction: SmartEmailAction = requestedAction || availableActions[0].action;

    // Step 3: Generate the formal email using Gemini
    const toneGuide = {
      formal: 'Use a highly professional, corporate tone. Address the recipient formally. Use proper salutations and closings.',
      friendly: 'Use a warm but professional tone. Be approachable while maintaining professionalism.',
      strict: 'Use a direct, authoritative, no-nonsense tone. Be concise and firm.'
    };

    const actionPrompts: Record<SmartEmailAction, string> = {
      offer_letter: `Generate a professional HR Offer Letter email for the candidate whose resume is in the document. Include:
- Congratulatory opening
- Position title (infer from resume/role fit)
- Key terms (start date placeholder, compensation placeholder)
- Next steps and onboarding info
- Professional closing`,
      rejection_letter: `Generate a professional, empathetic HR Rejection Letter for the candidate whose resume is in the document. Include:
- Appreciation for their application
- Professional and kind rejection notice
- Constructive feedback or encouragement
- Wish them well for future endeavors`,
      assignment_answers: `Analyze this assignment document and generate a comprehensive answer email containing:
- Complete solutions for each question/problem in the assignment
- Clear step-by-step explanations
- Final answers highlighted
- Professional formatting`,
      answer_key: `Analyze this question bank/exam paper and generate a comprehensive answer key email containing:
- Answers for every question in the document
- Detailed explanations for each answer
- Key concepts referenced
- Professional academic formatting`,
      executive_summary: `Analyze this business report and generate an executive summary email containing:
- High-level overview of key findings
- Critical data points and metrics
- Recommendations and action items
- Strategic implications`,
      payment_reminder: `Analyze this invoice/billing document and generate a professional payment email containing:
- Reference to the invoice details (number, amount, date)
- Payment status acknowledgment or gentle reminder
- Payment instructions or confirmation
- Professional financial correspondence tone`,
      contract_review: `Analyze this legal document and generate a contract review summary email containing:
- Key clauses and their implications
- Important obligations for each party
- Risk areas or concerns
- Recommended next steps`,
      acknowledgment: `Based on this cover letter/application, generate a formal application acknowledgment email containing:
- Confirmation of receipt
- Brief overview of the review process
- Expected timeline
- Professional HR closing`,
      general_response: `Analyze this document and generate a professional response email containing:
- Key points from the document
- Relevant action items
- Professional analysis
- Clear next steps`
    };

    const emailGenPrompt = `You are a professional business email writer at an enterprise level.

DOCUMENT CONTENT:
---
Title: ${doc.title}
Type: ${doc.type}
Content: ${docContent}
---

TASK: ${actionPrompts[selectedAction]}

RECIPIENT NAME: ${recipient}
TONE: ${toneGuide[emailTone]}

Generate the email body in clean HTML format suitable for embedding in an email template.
Use <p>, <ul>, <li>, <strong>, <em>, <h3>, <br> tags for formatting.
Do NOT include <html>, <head>, <body>, or <style> tags — just the inner body content.
Make it look like a real corporate email that an HR manager, professor, or business executive would send.

Also generate:
- A professional email subject line
- A 1-2 line plain text preview

Return as JSON with keys: "subject", "htmlBody", "plainPreview"`;

    let emailContents: any;
    if (doc.type === 'pdf') {
      emailContents = [
        { inlineData: { mimeType: 'application/pdf', data: doc.content } },
        emailGenPrompt
      ];
    } else {
      emailContents = emailGenPrompt;
    }

    const emailResponse = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: emailContents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            htmlBody: { type: Type.STRING },
            plainPreview: { type: Type.STRING }
          },
          required: ['subject', 'htmlBody', 'plainPreview']
        }
      }
    });

    const emailResult = JSON.parse(emailResponse.text || '{}');

    const draft: SmartEmailDraft = {
      id: 'draft_' + Math.random().toString(36).substring(2, 11),
      documentId: doc.id,
      category: detectedCategory,
      action: selectedAction,
      tone: emailTone,
      recipientName: recipient,
      recipientEmail,
      subject: emailResult.subject || `Re: ${doc.title}`,
      htmlBody: emailResult.htmlBody || '<p>Failed to generate email content.</p>',
      plainPreview: emailResult.plainPreview || 'AI-generated email based on your document.',
      confidence,
      generatedAt: new Date().toISOString()
    };

    res.json(draft);
  } catch (err: any) {
    console.error('Smart email analyze error, using local fallback draft:', err);
    // Offline fallback for draft generation
    const db = loadDb();
    const doc = db.documents.find(d => d.id === req.body.documentId);
    const docTitle = doc ? doc.title : 'Selected Document';
    const emailTone: SmartEmailTone = req.body.tone || 'formal';
    const recipient = req.body.recipientName || 'Recipient';
    const recipientEmail = req.body.recipientEmail || '';
    const detectedCategory = req.body.category || 'general';
    const selectedAction = req.body.action || 'general_response';

    const fallbackDraft: SmartEmailDraft = {
      id: 'draft_' + Math.random().toString(36).substring(2, 11),
      documentId: req.body.documentId,
      category: detectedCategory,
      action: selectedAction,
      tone: emailTone,
      recipientName: recipient,
      recipientEmail,
      subject: `Correspondence regarding: ${docTitle}`,
      htmlBody: `<p>Dear ${recipient},</p>
<p>This is a formal communication regarding the document: <strong>${docTitle}</strong>.</p>
<p>We have reviewed the document details and are processing the next steps. Please feel free to reach out if you have any questions or require additional information.</p>`,
      plainPreview: `Formal correspondence regarding ${docTitle}`,
      confidence: 0.65,
      generatedAt: new Date().toISOString()
    };
    res.json(fallbackDraft);
  }
});

// 2. POST /api/smart-email/send — Send the generated email via Gmail SMTP
app.post('/api/smart-email/send', async (req, res) => {
  try {
    const { recipientEmail, recipientName, subject, htmlBody, documentId, category, action, tone } = req.body;
    if (!recipientEmail || !subject || !htmlBody || !documentId) {
      return res.status(400).json({ error: 'Missing required fields: recipientEmail, subject, htmlBody, documentId.' });
    }

    const db = loadDb();
    const doc = db.documents.find(d => d.id === documentId);
    const docTitle = doc ? doc.title : 'Unknown Document';
    const senderName = 'SmartDocs AI';

    // Build the full HTML email with template
    const fullHtml = buildEmailHtml(subject, htmlBody, category || 'general', senderName);

    // Send via Gmail SMTP
    const transporter = getEmailTransporter();
    await transporter.sendMail({
      from: `"SmartDocs AI" <${process.env.GMAIL_USER}>`,
      to: recipientEmail,
      subject: subject,
      html: fullHtml,
      text: htmlBody.replace(/<[^>]*>/g, '') // Strip HTML for plain text fallback
    });

    // Log to history
    const historyEntry: SmartEmailHistoryEntry = {
      id: 'semail_' + Math.random().toString(36).substring(2, 11),
      documentId,
      documentTitle: docTitle,
      category: category || 'general',
      action: action || 'general_response',
      recipientName: recipientName || 'Recipient',
      recipientEmail,
      subject,
      tone: tone || 'formal',
      sentAt: new Date().toISOString(),
      status: 'success'
    };

    db.smartEmailHistory.unshift(historyEntry);
    saveDb(db);

    res.json({ success: true, entry: historyEntry });
  } catch (err: any) {
    console.error('Smart email send error:', err);

    // Log failure
    try {
      const db = loadDb();
      const failEntry: SmartEmailHistoryEntry = {
        id: 'semail_' + Math.random().toString(36).substring(2, 11),
        documentId: req.body.documentId || '',
        documentTitle: 'Unknown',
        category: req.body.category || 'general',
        action: req.body.action || 'general_response',
        recipientName: req.body.recipientName || 'Recipient',
        recipientEmail: req.body.recipientEmail || '',
        subject: req.body.subject || '',
        tone: req.body.tone || 'formal',
        sentAt: new Date().toISOString(),
        status: 'failed',
        errorMessage: err.message
      };
      db.smartEmailHistory.unshift(failEntry);
      saveDb(db);
    } catch (logErr) {
      console.error('Failed to log email failure:', logErr);
    }

    res.status(500).json({ error: err.message || 'Failed to send email.' });
  }
});

// 3. GET /api/smart-email/history — Return all smart email history
app.get('/api/smart-email/history', (req, res) => {
  try {
    const db = loadDb();
    res.json(db.smartEmailHistory || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/smart-email/templates — Return available email templates per category
app.get('/api/smart-email/templates', (req, res) => {
  try {
    const templates = [
      {
        category: 'resume',
        label: 'Resume / CV',
        description: 'Analyze candidate resumes and generate HR correspondence',
        icon: '👤',
        color: '#7c3aed',
        actions: getCategoryActions('resume')
      },
      {
        category: 'assignment',
        label: 'Assignment',
        description: 'Solve assignments and send answers professionally',
        icon: '📝',
        color: '#0ea5e9',
        actions: getCategoryActions('assignment')
      },
      {
        category: 'question_bank',
        label: 'Question Bank',
        description: 'Generate comprehensive answer keys for exam papers',
        icon: '❓',
        color: '#f59e0b',
        actions: getCategoryActions('question_bank')
      },
      {
        category: 'business_report',
        label: 'Business Report',
        description: 'Create executive summary emails from reports',
        icon: '📊',
        color: '#10b981',
        actions: getCategoryActions('business_report')
      },
      {
        category: 'invoice',
        label: 'Invoice / Receipt',
        description: 'Generate payment confirmations and reminders',
        icon: '💳',
        color: '#ef4444',
        actions: getCategoryActions('invoice')
      },
      {
        category: 'legal_contract',
        label: 'Legal / Contract',
        description: 'Summarize contracts and highlight key clauses',
        icon: '⚖️',
        color: '#6366f1',
        actions: getCategoryActions('legal_contract')
      },
      {
        category: 'cover_letter',
        label: 'Cover Letter',
        description: 'Acknowledge applications and send HR responses',
        icon: '✉️',
        color: '#ec4899',
        actions: getCategoryActions('cover_letter')
      },
      {
        category: 'general',
        label: 'General Document',
        description: 'Generate professional response for any document',
        icon: '📄',
        color: '#8b5cf6',
        actions: getCategoryActions('general')
      }
    ];
    res.json(templates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /api/smart-email/regenerate — Regenerate draft with different tone/instructions
app.post('/api/smart-email/regenerate', async (req, res) => {
  try {
    const { documentId, recipientName, recipientEmail, tone, action, category, additionalInstructions } = req.body;
    if (!documentId || !recipientEmail) {
      return res.status(400).json({ error: 'Missing documentId or recipientEmail.' });
    }

    // Re-use the analyze endpoint logic with additional instructions
    const db = loadDb();
    const doc = db.documents.find(d => d.id === documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const client = getGeminiClient();
    const emailTone: SmartEmailTone = tone || 'formal';
    const recipient = recipientName || 'Recipient';
    const emailCategory: SmartEmailCategory = category || 'general';
    const emailAction: SmartEmailAction = action || 'general_response';

    let docContent = doc.content;
    if (doc.type === 'pdf') {
      docContent = `[PDF Document: ${doc.title}]`;
    }
    if (docContent.length > 8000) {
      docContent = docContent.substring(0, 8000);
    }

    const toneGuide: Record<string, string> = {
      formal: 'Use a highly professional, corporate tone. Address the recipient formally.',
      friendly: 'Use a warm but professional tone. Be approachable while maintaining professionalism.',
      strict: 'Use a direct, authoritative, no-nonsense tone. Be concise and firm.'
    };

    const regenPrompt = `You are a professional business email writer.

DOCUMENT: "${doc.title}" (${doc.type})
CONTENT: ${docContent}

Generate a ${emailAction.replace(/_/g, ' ')} email for this ${emailCategory.replace(/_/g, ' ')} document.
RECIPIENT: ${recipient}
TONE: ${toneGuide[emailTone]}
${additionalInstructions ? `ADDITIONAL INSTRUCTIONS: ${additionalInstructions}` : ''}

Generate the email body in clean HTML using <p>, <ul>, <li>, <strong>, <em>, <h3>, <br> tags.
No <html>/<head>/<body> tags — just inner content.
Make it professional and realistic.

Return JSON: {"subject": "...", "htmlBody": "...", "plainPreview": "..."}`;

    let regenContents: any;
    if (doc.type === 'pdf') {
      regenContents = [
        { inlineData: { mimeType: 'application/pdf', data: doc.content } },
        regenPrompt
      ];
    } else {
      regenContents = regenPrompt;
    }

    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: regenContents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            htmlBody: { type: Type.STRING },
            plainPreview: { type: Type.STRING }
          },
          required: ['subject', 'htmlBody', 'plainPreview']
        }
      }
    });

    const result = JSON.parse(response.text || '{}');

    const draft: SmartEmailDraft = {
      id: 'draft_' + Math.random().toString(36).substring(2, 11),
      documentId: doc.id,
      category: emailCategory,
      action: emailAction,
      tone: emailTone,
      recipientName: recipient,
      recipientEmail,
      subject: result.subject || `Re: ${doc.title}`,
      htmlBody: result.htmlBody || '<p>Failed to regenerate email content.</p>',
      plainPreview: result.plainPreview || 'Regenerated email based on your document.',
      confidence: 0.85,
      generatedAt: new Date().toISOString()
    };

    res.json(draft);
  } catch (err: any) {
    console.error('Smart email regenerate error:', err);
    res.status(500).json({ error: err.message || 'Failed to regenerate email.' });
  }
});

// ─── CANDIDATE ASSESSMENT LINK DISPATCHING & PORTAL BACKEND ───────────

// Helper: Send invite email template
function sendAssessmentInviteEmail(candidateEmail: string, candidateName: string, role: string, link: string, expiryTime: string) {
  const transporter = getEmailTransporter();
  const subject = `Assessment Invitation: ${role} Suitability Test - SmartDocs AI`;
  const bodyHtml = `
    <div style="background-color: #1a1a2e; border: 1px solid #7c3aed33; border-radius: 12px; padding: 24px; color: #ffffff;">
      <h2 style="color: #7c3aed; margin-top: 0;">Hello ${candidateName},</h2>
      <p>You have been invited by <strong>SmartDocs AI</strong> to complete the screening assessment for the position of <strong>${role}</strong>.</p>
      <p>This automated assessment evaluates your fit for the role based on your resume, technical skills, and problem-solving abilities.</p>
      
      <div style="background-color: rgba(255,255,255,0.05); border-left: 4px solid #0ea5e9; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
        <strong style="color: #0ea5e9; display: block; margin-bottom: 4px; font-size: 11px; text-transform: uppercase;">Assessment Details</strong>
        <span style="display: block; font-size: 13px; margin-bottom: 4px;"><strong>Position:</strong> ${role}</span>
        <span style="display: block; font-size: 13px;"><strong>Time Limit:</strong> 10 Minutes</span>
        <span style="display: block; font-size: 13px; color: #f59e0b; margin-top: 4px;"><strong>Link Expiry:</strong> ${expiryTime}</span>
      </div>

      <p>Please click the button below to launch the assessment portal. Note that you must complete the quiz in <strong>one sitting</strong>, and our anti-cheat protocols (tab tracking, fullscreen lock, copy-paste block) will be active.</p>
      
      <div style="margin: 30px 0; text-align: center;">
        <a href="${link}" style="display: inline-block; background-color: #7c3aed; color: #ffffff; padding: 14px 28px; border-radius: 12px; font-weight: bold; text-decoration: none; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);">Start Assessment Portal</a>
      </div>

      <p style="font-size: 12px; color: #94a3b8;">If the button above does not work, copy and paste this link in your browser:<br>
      <a href="${link}" style="color: #0ea5e9; text-decoration: underline;">${link}</a></p>
    </div>
  `;

  const emailHtml = buildEmailHtml(subject, bodyHtml, 'resume', 'SmartDocs AI Recruitment');
  return transporter.sendMail({
    from: `"SmartDocs AI Recruitment" <${process.env.GMAIL_USER}>`,
    to: candidateEmail,
    subject: subject,
    html: emailHtml,
    text: `Hello ${candidateName}, please start your assessment for ${role} here: ${link} (Expires: ${expiryTime})`
  });
}

// Fallback assessment generator
function getFallbackAssessmentQuestions(role: string): CandidateQuizQuestion[] {
  const normalizedRole = role.toLowerCase();
  
  if (normalizedRole.includes('develop') || normalizedRole.includes('engineer') || normalizedRole.includes('web') || normalizedRole.includes('code') || normalizedRole.includes('tech')) {
    return [
      {
        question: "A high-priority bug is reported in production, but it is outside of your immediate team's codebase. How do you respond?",
        options: [
          "A. Ignore it since it is another team's responsibility.",
          "B. Investigate the bug, gather context, and coordinate with the target team to resolve it.",
          "C. Escalate to management immediately without checking the logs.",
          "D. Refactor your own code instead."
        ],
        correctAnswer: 1,
        explanation: "Collaborating across teams to resolve critical production bugs demonstrates strong ownership and team alignment."
      },
      {
        question: "Your project deadline is tomorrow, and you realize a key API dependency is returning internal server errors. What is your first step?",
        options: [
          "A. Delay your release indefinitely without notifying stakeholders.",
          "B. Write a mock data layer to bypass the issue temporarily, write test cases, and alert the API team and stakeholders.",
          "C. Panic and blame the backend team.",
          "D. Revert all your progress."
        ],
        correctAnswer: 1,
        explanation: "Creating a mock allows you to continue demonstrating UI capabilities while proactively communicating and tracking dependencies."
      },
      {
        question: "A senior team member suggests a code design that you believe will cause scalability issues later. How do you handle this?",
        options: [
          "A. Argue loudly during the standup.",
          "B. Agree blindly to avoid any conflict.",
          "C. Present concrete performance metrics and benchmark examples in a constructive review thread.",
          "D. Override their code changes secretly."
        ],
        correctAnswer: 2,
        explanation: "Constructive peer review backed by data and metrics fosters healthy collaboration and solid engineering standards."
      },
      {
        question: "Which of the following describes the most secure approach for storing sensitive client credentials in a web application?",
        options: [
          "A. Storing them in a public git repository.",
          "B. Saving them in plain text in db.json.",
          "C. Injecting them as environment variables encrypted in transit and at rest using secret vaults.",
          "D. Hardcoding them in index.html."
        ],
        correctAnswer: 2,
        explanation: "Secret managers and environment variables prevent credential leaks and keep keys protected across environments."
      },
      {
        question: "You have been asked to optimize a slow landing page. Which optimization provides the highest initial return?",
        options: [
          "A. Redesigning the entire logo.",
          "B. Lazy-loading media assets, minifying bundle sizes, and implementing server-side caching.",
          "C. Adding more cool animations to keep the user waiting.",
          "D. Deleting the style rules."
        ],
        correctAnswer: 1,
        explanation: "Optimizing bundles, caching, and lazy loading directly impacts PageSpeed metrics and UX bounce rates."
      },
      {
        question: "During a code review, a teammate leaves comments criticizing your approach without offering an alternative. How do you respond?",
        options: [
          "A. Delete their comments and merge the pull request anyway.",
          "B. Schedule a brief alignment sync or comment politely asking them to clarify their concerns and suggest preferred alternatives.",
          "C. Criticize their recent pull requests in return.",
          "D. Complain to the engineering manager."
        ],
        correctAnswer: 1,
        explanation: "Responding constructively and seeking alignment resolves coding disagreements professionally and improves overall quality."
      },
      {
        question: "You need to integrate a third-party API that has incomplete or outdated documentation. What is the best way to proceed?",
        options: [
          "A. Write integration code guessing parameters and test directly in production.",
          "B. Set up a local sandbox environment, use tools like Postman to inspect actual network responses, and build defensive parsers.",
          "C. Refuse to perform the integration until they update the docs.",
          "D. Guess the API contract and hope it works."
        ],
        correctAnswer: 1,
        explanation: "Inspecting actual network responses in sandbox environments helps verify API behavior when documentation is lacking."
      },
      {
        question: "A Git merge conflict occurs on a shared utility file during a release branch preparation. How should you resolve it?",
        options: [
          "A. Force push your branch to overwrite other developers' changes.",
          "B. Coordinate with the authors of the conflicting changes, understand the overlapping requirements, and merge manually with test coverage.",
          "C. Delete the conflicting file and rewrite it from scratch.",
          "D. Abandon the release branch completely."
        ],
        correctAnswer: 1,
        explanation: "Collaborative conflict resolution prevents code regressions and ensures logic from all branches is preserved correctly."
      },
      {
        question: "Your team is experiencing high technical debt, causing new feature releases to slow down. What is the most effective approach?",
        options: [
          "A. Ignore it and push features as fast as possible.",
          "B. Allocate a fixed percentage of each sprint (e.g., 20%) to refactoring and stability tasks, prioritizing by impact on code speed.",
          "C. Stop all feature work for 6 months to rewrite the entire codebase.",
          "D. Hire freelance developers to write quick patches."
        ],
        correctAnswer: 1,
        explanation: "Consistent, incremental refactoring balanced with business feature delivery is the healthiest way to manage tech debt."
      },
      {
        question: "Which approach best protects a REST API against brute-force attacks and abuse?",
        options: [
          "A. Changing the port number frequently.",
          "B. Implementing rate limiting, IP throttling, and robust JSON Web Token (JWT) validation.",
          "C. Hiding the API documentation.",
          "D. Disabling HTTPS."
        ],
        correctAnswer: 1,
        explanation: "Rate limiting and token security are standard practices for securing public-facing REST endpoints."
      }
    ];
  }
  
  // Default general fallback
  return [
    {
      question: "You have multiple overlapping tasks due at the end of the day. How do you structure your schedule?",
      options: [
        "A. Work on whatever seems easiest first.",
        "B. Prioritize based on business impact, communicate adjustments to stakeholders, and execute systematically.",
        "C. Leave work early to avoid the stress.",
        "D. Try to do all tasks simultaneously without focusing."
      ],
      correctAnswer: 1,
      explanation: "Prioritizing by business value and keeping stakeholders updated is key to effective task management."
    },
    {
      question: "A client reports that they are dissatisfied with the recent project draft presentation. How do you handle this?",
      options: [
        "A. Inform the client that they are wrong.",
        "B. Ignore their feedback and send the same draft again.",
        "C. Schedule a feedback alignment session, listen actively to concerns, and outline clear action items for revision.",
        "D. Cancel the contract immediately."
      ],
      correctAnswer: 2,
      explanation: "Active listening and structured revision timelines build client trust and project alignment."
    },
    {
      question: "What is the most effective way to align team members on a new process rollout?",
      options: [
        "A. Sending a massive 50-page text document without any context.",
        "B. Mandating the change immediately without explanation.",
        "C. Conducting a brief interactive walkthrough, sharing visual document guides, and asking for anonymous feedback.",
        "D. Pretending nothing changed."
      ],
      correctAnswer: 2,
      explanation: "Interactive rollouts and clear, summarized docs ensure higher adoption rates and team alignment."
    },
    {
      question: "A task requires tool integrations that you have never used before. How do you proceed?",
      options: [
        "A. Reject the task immediately.",
        "B. Read documentation, review existing codebases, create a small sandbox script, and ask senior members for guidance.",
        "C. Guess how it works without reading references.",
        "D. Wait until someone does it for you."
      ],
      correctAnswer: 1,
      explanation: "Leveraging resources (docs/references) and utilizing sandboxes is the standard way to learn new tools."
    },
    {
      question: "How do you maintain code/documentation integrity when making changes?",
      options: [
        "A. Overwrite the entire file blindly.",
        "B. Use targeted, precise edits, preserve unrelated comments, and verify changes programmatically.",
        "C. Delete all comments to make the file smaller.",
        "D. Commit code without testing."
      ],
      correctAnswer: 1,
      explanation: "Precise edits and verification guard against regression bugs and keep documentation clean."
    },
    {
      question: "You realize you made a mistake in a presentation you delivered to the executive board yesterday. What should you do?",
      options: [
        "A. Keep quiet and hope no one notices.",
        "B. Proactively send a follow-up note to the attendees with the corrected data, briefly explaining the error.",
        "C. Blame the intern who compiled the data.",
        "D. Delete the slide deck from the shared server."
      ],
      correctAnswer: 1,
      explanation: "Proactively correcting mistakes build professional credibility and maintains data integrity."
    },
    {
      question: "A project requirement changes mid-way through execution. What is the first thing you should do?",
      options: [
        "A. Complain to the client about the changes.",
        "B. Assess the impact on timeline and resources, document the adjustments, and align with the project team.",
        "C. Continue with the original requirements to finish faster.",
        "D. Cancel the project immediately."
      ],
      correctAnswer: 1,
      explanation: "Assessing impact and realigning with stakeholders is crucial when scope adjustments occur mid-project."
    },
    {
      question: "A colleague is struggling to complete their part of a shared project. How do you support them?",
      options: [
        "A. Take over their work secretly to avoid talking to them.",
        "B. Offer assistance, identify specific bottlenecks, and work together to get the tasks back on track.",
        "C. Report their performance to HR immediately.",
        "D. Complete your part and ignore their issues."
      ],
      correctAnswer: 1,
      explanation: "Constructive peer support and collaboration help teams meet deadlines and build positive work dynamics."
    },
    {
      question: "Which of the following is the best practice for managing passwords and sensitive documentation?",
      options: [
        "A. Writing them on sticky notes around your monitor.",
        "B. Using a centralized, secure credential manager with multi-factor authentication.",
        "C. Emailing them in plain text to your personal account.",
        "D. Saving them in a shared Excel file named 'passwords'."
      ],
      correctAnswer: 1,
      explanation: "Centralized credential managers with MFA provide high security and prevent credential leakage."
    },
    {
      question: "What is the primary benefit of maintaining clear, written documentation for team workflows?",
      options: [
        "A. It fills up storage space on the servers.",
        "B. It reduces onboarding time, mitigates knowledge silos, and ensures consistent workflow execution.",
        "C. It gives management a reason to micro-manage.",
        "D. It prevents team members from talking to each other."
      ],
      correctAnswer: 1,
      explanation: "Documentation mitigates operational risk by preserving knowledge and guiding team alignment."
    }
  ];
}

// 1. POST /api/smart-email/assessments — Create invite, generate quiz, send email
app.post('/api/smart-email/assessments', async (req, res) => {
  try {
    const { documentId, candidateName, candidateEmail, role, jobDescription, difficulty } = req.body;
    if (!documentId || !candidateName || !candidateEmail || !role) {
      return res.status(400).json({ error: 'Missing required parameters.' });
    }

    const db = loadDb();
    const doc = db.documents.find(d => d.id === documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    // Step 2a: Get candidate profile (or auto-extract if not already present)
    let profile = doc.candidateProfile;
    if (!profile) {
      try {
        profile = await extractCandidateProfile(doc);
        const docIndex = db.documents.findIndex(d => d.id === documentId);
        if (docIndex !== -1) {
          db.documents[docIndex].candidateProfile = profile;
          saveDb(db);
        }
      } catch (errProfile) {
        console.warn('Failed to parse candidate profile on invite, using fallback:', errProfile);
        profile = {
          name: candidateName,
          email: candidateEmail,
          phone: 'Not Provided',
          skills: [role],
          experience: 'Relevant experience detailed in resume.',
          education: 'Academic education detailed in resume.',
          projects: 'Projects detailed in resume.',
          certifications: 'Certifications detailed in resume.'
        };
      }
    }

    // Step 2b: Compare Resume vs JD Analysis
    const jd = jobDescription || `Position for ${role} requiring relevant technical background, problem solving, and professional development practices.`;
    let analysis: ResumeAnalysis;
    try {
      const client = getGeminiClient();
      const analysisPrompt = `You are a professional HR director and resume evaluator. Compare the candidate's resume profile against the Job Description (JD) for the role: "${role}".
      
CANDIDATE PROFILE:
- Skills: ${profile.skills.join(', ')}
- Experience: ${profile.experience}
- Education: ${profile.education}
- Projects: ${profile.projects}
- Certifications: ${profile.certifications}

JOB DESCRIPTION:
"${jd}"

Analyze:
1. Match Percentage (0-100) based on alignment of skills, experience, and requirements.
2. Skill Gap: list specific technologies or capabilities that are required but the candidate lacks or has weak experience in.
3. Missing Skills: specific technologies/skills explicitly in the JD but not found in the resume.
4. Strengths: key matching areas and positive qualifications.
5. Weaknesses: potential issues, lack of depth in certain areas.
6. Recommendation: a summary recommendation (e.g. Hire, Interview, Reject) with quick justification.
7. Overall Score: out of 10.

Return JSON matching this schema:
{
  "matchPercentage": 85,
  "skillGap": ["React Native", "Swift"],
  "missingSkills": ["React Native"],
  "strengths": ["Strong Node.js background", "TypeScript expertise"],
  "weaknesses": ["No mobile development experience listed"],
  "recommendation": "Invite for interview. Very strong backend skills.",
  "overallScore": 8
}`;

      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: analysisPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              matchPercentage: { type: Type.INTEGER },
              skillGap: { type: Type.ARRAY, items: { type: Type.STRING } },
              missingSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendation: { type: Type.STRING },
              overallScore: { type: Type.INTEGER }
            },
            required: ['matchPercentage', 'skillGap', 'missingSkills', 'strengths', 'weaknesses', 'recommendation', 'overallScore']
          }
        }
      });

      analysis = JSON.parse(response.text || '{}');
    } catch (errAnalysis) {
      console.warn('Failed to run resume vs JD analysis, using fallback:', errAnalysis);
      analysis = {
        matchPercentage: 70,
        skillGap: ['None detected'],
        missingSkills: [],
        strengths: ['Relevant background matching role requirements'],
        weaknesses: ['Underspecified details'],
        recommendation: 'Evaluate further via screening assessment.',
        overallScore: 7
      };
    }

    // Step 3: Generate Dynamic Quiz questions based on JD, Role, and Resume
    let questions: CandidateQuizQuestion[] = [];
    const difficultyLevel = difficulty || 'medium';
    
    try {
      const client = getGeminiClient();
      const quizPrompt = `You are an expert technical interviewer and exam developer.
Analyze the candidate's resume/profile, the Job Description (JD), and the target position: "${role}" at a "${difficultyLevel}" difficulty level.
Generate exactly 10 multiple-choice questions (MCQs) for the candidate.

The quiz must include a mix of:
- Technical Questions (testing candidate's claimed skills: ${profile.skills.slice(0, 5).join(', ')})
- Logical Reasoning / Problem Solving questions
- Coding / Technical scenario questions
- Soft Skills / situational judgment questions

Each question must contain:
1. question: clear text of the question.
2. options: exactly 4 plausible choices (e.g. "A. ...", "B. ...", "C. ...", "D. ...").
3. correctAnswer: 0-indexed number of the correct option (0=A, 1=B, 2=C, 3=D).
4. explanation: a short constructive paragraph explaining why the correct option is right.

Return a JSON array of exactly 10 objects:
[{ "question": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "correctAnswer": 0, "explanation": "..." }]`;

      let contents: any;
      if (doc.type === 'pdf') {
        contents = [{ inlineData: { mimeType: 'application/pdf', data: doc.content } }, quizPrompt];
      } else {
        contents = `${quizPrompt}\n\nDOCUMENT CONTENT:\n${doc.content.substring(0, 6000)}`;
      }

      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctAnswer: { type: Type.INTEGER },
                explanation: { type: Type.STRING }
              },
              required: ['question', 'options', 'correctAnswer', 'explanation']
            }
          }
        }
      });

      questions = JSON.parse(response.text || '[]');
      if (questions.length < 10) {
        const fallbacks = getFallbackAssessmentQuestions(role);
        while (questions.length < 10 && fallbacks.length > 0) {
          questions.push(fallbacks[questions.length % fallbacks.length]);
        }
      }
    } catch (apiErr: any) {
      console.warn('Gemini quiz generation error. Using high-quality fallback questions:', apiErr.message);
      questions = getFallbackAssessmentQuestions(role);
    }

    // Ensure questions are randomized slightly to fit the attempt
    questions = questions.sort(() => Math.random() - 0.5).slice(0, 10);

    const assessmentId = 'assess_' + Math.random().toString(36).substring(2, 11);

    const newAssessment: CandidateAssessment = {
      id: assessmentId,
      documentId,
      candidateName,
      candidateEmail,
      role,
      jobDescription: jd,
      questions,
      completed: false,
      profile,
      analysis,
      cheatAttemptsCount: 0
    };

    // Save invite to DB
    db.candidateAssessments.push(newAssessment);
    saveDb(db);

    // Send invite email
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const assessmentLink = `${appUrl}/?assessId=${assessmentId}`;
    const expiryTime = new Date(Date.now() + 48 * 60 * 60 * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    await sendAssessmentInviteEmail(candidateEmail, candidateName, role, assessmentLink, expiryTime);

    res.json({ success: true, assessmentId, analysis });
  } catch (err: any) {
    console.error('Create assessment invite error:', err);
    res.status(500).json({ error: err.message || 'Failed to dispatch invite.' });
  }
});

// 2. GET /api/smart-email/assessments — List invites (optionally filtered by documentId)
app.get('/api/smart-email/assessments', (req, res) => {
  try {
    const { documentId } = req.query;
    const db = loadDb();
    let invites = db.candidateAssessments || [];
    if (documentId) {
      invites = invites.filter(i => i.documentId === documentId);
    }
    res.json(invites);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/smart-email/assessments/:id — Candidate retrieves quiz questions (security: hide correct answers)
app.get('/api/smart-email/assessments/:id', (req, res) => {
  try {
    const db = loadDb();
    const assess = db.candidateAssessments.find(a => a.id === req.params.id);
    if (!assess) return res.status(404).json({ error: 'Assessment not found.' });

    // Format questions without answers to protect candidate evaluation
    const publicQuestions = assess.questions.map(q => ({
      question: q.question,
      options: q.options
    }));

    res.json({
      id: assess.id,
      candidateName: assess.candidateName,
      candidateEmail: assess.candidateEmail,
      role: assess.role,
      completed: assess.completed,
      score: assess.score,
      decisionSent: assess.decisionSent,
      candidateSkills: assess.candidateSkills,
      questions: publicQuestions
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Telemetry sync endpoint for timer and anti-cheat triggers
app.post('/api/smart-email/assessments/:id/telemetry', (req, res) => {
  try {
    const { timeRemaining, cheatAttemptsCount } = req.body;
    const db = loadDb();
    const idx = db.candidateAssessments.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Assessment not found.' });

    if (timeRemaining !== undefined) {
      db.candidateAssessments[idx].timeRemaining = timeRemaining;
    }
    if (cheatAttemptsCount !== undefined) {
      db.candidateAssessments[idx].cheatAttemptsCount = cheatAttemptsCount;
    }
    saveDb(db);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /api/smart-email/assessments/:id/submit — Candidate submits quiz answers
app.post('/api/smart-email/assessments/:id/submit', async (req, res) => {
  try {
    const { answers, candidateSkills, cheatAttemptsCount } = req.body;
    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'Answers array is required.' });
    }

    const db = loadDb();
    const assessIndex = db.candidateAssessments.findIndex(a => a.id === req.params.id);
    if (assessIndex === -1) return res.status(404).json({ error: 'Assessment not found.' });

    const assess = db.candidateAssessments[assessIndex];
    if (assess.completed) return res.status(400).json({ error: 'Assessment already completed.' });

    // Calculate score
    let score = 0;
    assess.questions.forEach((q, idx) => {
      if (answers[idx] === q.correctAnswer) {
        score++;
      }
    });

    const doc = db.documents.find(d => d.id === assess.documentId);
    const docTitle = doc ? doc.title : 'Unknown Document';
    const totalQuestions = assess.questions.length;
    const passingThreshold = 8; // Passing score threshold is 8 out of 10 (80%)
    const passed = score >= passingThreshold;
    const decision = passed ? 'interview_invite' : 'rejection';

    let subject = '';
    let htmlBody = '';

    try {
      const client = getGeminiClient();
      let docContent = doc ? doc.content : '';
      if (doc && doc.type === 'pdf') {
        docContent = `[Resume / Profile of ${assess.candidateName}]`;
      } else if (docContent.length > 5000) {
        docContent = docContent.substring(0, 5000);
      }

      if (passed) {
        const invitePrompt = `You are a friendly enterprise recruiter. Draft an invitation email to ${assess.candidateName} for an AI Interview.
They scored ${score}/10 on their initial suitability screening for the ${assess.role} role.
Highlight that they cleared the threshold, and we are inviting them to the next stage: a 5-question AI Voice/Text Interview.
Keep the email structured in clean HTML format. Use tags like <p>, <ul>, <li>, <strong>. No html/body wrappers.`;

        const response = await client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: invitePrompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                subject: { type: Type.STRING },
                htmlBody: { type: Type.STRING }
              },
              required: ['subject', 'htmlBody']
            }
          }
        });
        const result = JSON.parse(response.text || '{}');
        subject = result.subject || `Congratulations! Proceed to AI Interview for ${assess.role}`;
        htmlBody = result.htmlBody || `<p>Congratulations on clearing the screening assessment!</p>`;
      } else {
        const rejectPrompt = `You are an empathetic HR partner. Draft a constructive rejection email to ${assess.candidateName} for the ${assess.role} role.
They scored ${score}/10 on their suitability screening, which is below our 8/10 threshold.
Highlight:
- Specific constructive feedback based on the role and skills: ${candidateSkills || 'technical concepts'}.
- Provide 3 helpful educational resources (with placeholders or generalized topics like FreeCodeCamp, MDN Web Docs, system design guides) to improve their skills.
Keep the email structured in clean HTML format. Use tags like <p>, <ul>, <li>, <strong>. No html/body wrappers.`;

        const response = await client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: rejectPrompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                subject: { type: Type.STRING },
                htmlBody: { type: Type.STRING }
              },
              required: ['subject', 'htmlBody']
            }
          }
        });
        const result = JSON.parse(response.text || '{}');
        subject = result.subject || `Application Update: ${assess.role} - SmartDocs AI`;
        htmlBody = result.htmlBody || `<p>Thank you for completing the suitability assessment. Unfortunately, we will not be moving forward.</p>`;
      }
    } catch (apiErr: any) {
      console.warn('Gemini auto-decision API error. Fallback to offline template:', apiErr.message);
      if (passed) {
        subject = `Action Required: AI Interview Invitation - ${assess.role}`;
        htmlBody = `<p>Dear ${assess.candidateName},</p>
<p>Congratulations! You scored <strong>${score}/10</strong> on the suitability screening quiz, meeting our passing threshold.</p>
<p>We are pleased to invite you to the next stage of our recruitment process: the <strong>AI Voice/Text Interview</strong>.</p>
<p>Please log back into the candidate portal to launch your automated interview.</p>`;
      } else {
        subject = `Application Update: ${assess.role} - SmartDocs AI`;
        htmlBody = `<p>Dear ${assess.candidateName},</p>
<p>Thank you for taking the time to complete our screening assessment.</p>
<p>You scored <strong>${score}/10</strong>. Unfortunately, this does not meet our required score of 8/10 to proceed to the next stage.</p>
<p>We encourage you to review standard engineering frameworks, system design resources on MDN Web Docs, and coding guides on FreeCodeCamp. We wish you the best in your search.</p>`;
      }
    }

    // Add interview link to email body if passed
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const interviewLink = `${appUrl}/?assessId=${assess.id}&phase=interview`;
    if (passed) {
      htmlBody += `<div style="margin: 24px 0; text-align: center;">
        <a href="${interviewLink}" style="display: inline-block; background-color: #7c3aed; color: #ffffff; padding: 12px 24px; border-radius: 12px; font-weight: bold; text-decoration: none; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Start AI Interview Now</a>
      </div>
      <p style="font-size:11px;color:#94a3b8;">If the button above does not work, copy and paste this link in your browser:<br>${interviewLink}</p>`;
    }

    // Deliver email via Gmail SMTP
    try {
      const transporter = getEmailTransporter();
      const fullHtml = buildEmailHtml(subject, htmlBody, 'resume', 'Recruitment System');

      await transporter.sendMail({
        from: `"SmartDocs AI Recruitment" <${process.env.GMAIL_USER}>`,
        to: assess.candidateEmail,
        subject: subject,
        html: fullHtml,
        text: htmlBody.replace(/<[^>]*>/g, '')
      });
    } catch (smtpErr: any) {
      console.error('Failed to automatically send decision email via SMTP:', smtpErr.message);
    }

    // Save history entry
    const historyEntry: SmartEmailHistoryEntry = {
      id: 'semail_' + Math.random().toString(36).substring(2, 11),
      documentId: assess.documentId,
      documentTitle: docTitle,
      category: 'resume',
      action: passed ? 'offer_letter' : 'rejection_letter', // Map to categories for styling/icons
      recipientName: assess.candidateName,
      recipientEmail: assess.candidateEmail,
      subject: subject,
      tone: 'formal',
      sentAt: new Date().toISOString(),
      status: 'success'
    };
    db.smartEmailHistory.unshift(historyEntry);

    // Save database updates
    db.candidateAssessments[assessIndex].completed = true;
    db.candidateAssessments[assessIndex].score = score;
    db.candidateAssessments[assessIndex].candidateSkills = candidateSkills || '';
    db.candidateAssessments[assessIndex].completedAt = new Date().toISOString();
    db.candidateAssessments[assessIndex].decisionSent = passed ? null : 'rejection';
    db.candidateAssessments[assessIndex].finalDecision = passed ? 'pending' : 'rejected';
    db.candidateAssessments[assessIndex].interviewInvited = passed;
    db.candidateAssessments[assessIndex].cheatAttemptsCount = cheatAttemptsCount || assess.cheatAttemptsCount || 0;
    saveDb(db);

    res.json({ success: true, score, decision, passed, interviewInvited: passed });
  } catch (err: any) {
    console.error('Candidate quiz submit error:', err);
    res.status(500).json({ error: err.message || 'Failed to submit quiz responses.' });
  }
});

// 5. POST /api/smart-email/assessments/:id/decision — Send final offer/rejection email
app.post('/api/smart-email/assessments/:id/decision', async (req, res) => {
  try {
    const { decision } = req.body; // 'offer' | 'rejection'
    if (!decision || (decision !== 'offer' && decision !== 'rejection')) {
      return res.status(400).json({ error: 'Decision must be either "offer" or "rejection".' });
    }

    const db = loadDb();
    const assessIndex = db.candidateAssessments.findIndex(a => a.id === req.params.id);
    if (assessIndex === -1) return res.status(404).json({ error: 'Assessment invite not found.' });

    const assess = db.candidateAssessments[assessIndex];
    const doc = db.documents.find(d => d.id === assess.documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const action = decision === 'offer' ? 'offer_letter' : 'rejection_letter';
    
    let subject = '';
    let htmlBody = '';
    
    try {
      const client = getGeminiClient();
      let docContent = doc.content;
      if (doc.type === 'pdf') docContent = `[Resume of ${assess.candidateName}]`;

      // AI drafts the email
      const emailPrompt = `You are a professional HR director. Draft a formal email decision for:
Candidate: ${assess.candidateName}
Action: ${action === 'offer_letter' ? 'Formal Job Offer Letter (congratulatory, role details)' : 'Constructive Rejection Email (polite, thanks, feedback)'}
Role: ${assess.role}
Assessment Score: ${assess.score}/5

Generate HTML body only, using tags like <p>, <ul>, <li>, <strong>, <br>.
Return JSON: { "subject": "...", "htmlBody": "..." }`;

      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: emailPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subject: { type: Type.STRING },
              htmlBody: { type: Type.STRING }
            },
            required: ['subject', 'htmlBody']
          }
        }
      });

      const result = JSON.parse(response.text || '{}');
      subject = result.subject;
      htmlBody = result.htmlBody;
    } catch (apiErr: any) {
      console.warn('Gemini API quota exceeded or error drafting decision. Using fallback offline template:', apiErr.message);
      if (decision === 'offer') {
        subject = `Official Job Offer: ${assess.role} - SmartDocs AI`;
        htmlBody = `<p>Dear ${assess.candidateName},</p>
<p>We are absolutely thrilled to extend you a formal offer of employment for the position of <strong>${assess.role}</strong>.</p>
<p>Your background, combined with your impressive score of <strong>${assess.score}/5</strong> on our role-play screening assessment, makes you an ideal fit for our team.</p>
<p>Key Offer Details:</p>
<ul>
  <li><strong>Position:</strong> ${assess.role}</li>
  <li><strong>Department:</strong> Engineering & Technical Operations</li>
  <li><strong>Reporting Manager:</strong> Hiring Director</li>
</ul>
<p>We believe your skills will make a significant impact here. Please review and reply to this email to confirm your acceptance of this offer.</p>
<p>Congratulations, and welcome to our team!</p>`;
      } else {
        subject = `Application Update: ${assess.role} - SmartDocs AI`;
        htmlBody = `<p>Dear ${assess.candidateName},</p>
<p>Thank you for taking the time to meet with us and complete our role suitability assessment for the <strong>${assess.role}</strong> position.</p>
<p>We appreciate the effort you put into the process. After reviewing your evaluation score of <strong>${assess.score}/5</strong>, we regret to inform you that we will not be moving forward with your application at this time.</p>
<p>We encourage you to apply for future roles that align with your profile, and we wish you the very best in your job search.</p>
<p>Sincerely,</p>
<p>Recruitment Team</p>`;
      }
    }

    // Deliver email
    const transporter = getEmailTransporter();
    const fullHtml = buildEmailHtml(subject, htmlBody, 'resume', 'Human Resources');

    await transporter.sendMail({
      from: `"HR Department" <${process.env.GMAIL_USER}>`,
      to: assess.candidateEmail,
      subject: subject,
      html: fullHtml,
      text: htmlBody.replace(/<[^>]*>/g, '')
    });

    // Save history
    const historyEntry: SmartEmailHistoryEntry = {
      id: 'semail_' + Math.random().toString(36).substring(2, 11),
      documentId: assess.documentId,
      documentTitle: doc.title,
      category: 'resume',
      action: action,
      recipientName: assess.candidateName,
      recipientEmail: assess.candidateEmail,
      subject: subject,
      tone: 'formal',
      sentAt: new Date().toISOString(),
      status: 'success'
    };

    db.smartEmailHistory.unshift(historyEntry);
    db.candidateAssessments[assessIndex].decisionSent = decision;
    saveDb(db);

    res.json({ success: true, entry: historyEntry });
  } catch (err: any) {
    console.error('Send decision invite error:', err);
    res.status(500).json({ error: err.message || 'Failed to dispatch decision letter.' });
  }
});


// Helper: Generate a beautiful, branded PDF Offer Letter using jsPDF
function generateOfferLetterPdf(candidateName: string, role: string): Buffer {
  const doc = new jsPDF();
  
  // Header background banner (premium brand color HSL/RGB)
  doc.setFillColor(124, 58, 237); // #7c3aed
  doc.rect(0, 0, 210, 40, 'F');
  
  // Header title text
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("OFFICIAL JOB OFFER", 20, 26);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("SmartDocs AI Recruitment Suite", 140, 26);
  
  // Main body text settings
  doc.setTextColor(30, 30, 40);
  doc.setFontSize(11);
  
  const currentDate = new Date().toLocaleDateString('en-US', { dateStyle: 'long' });
  doc.text(`Date: ${currentDate}`, 20, 55);
  doc.text(`Ref: SD-OFFER-${Math.random().toString(36).substring(2, 8).toUpperCase()}`, 20, 62);
  
  doc.setFont("helvetica", "bold");
  doc.text("TO CANDIDATE:", 20, 75);
  doc.setFont("helvetica", "normal");
  doc.text(`${candidateName}`, 20, 82);
  doc.text("Email Status: Verified Screened", 20, 89);
  
  doc.setFont("helvetica", "bold");
  doc.text(`RE: Offer of Employment for the Position of ${role}`, 20, 105);
  
  doc.setFont("helvetica", "normal");
  const introParagraph = `We are absolutely thrilled to extend you a formal offer of employment for the position of ${role} at SmartDocs AI. Following the review of your academic suitability quiz, where you cleared our passing grade, and your performance on our AI interview evaluation, our panel has approved your hire.`;
  const wrappedIntro = doc.splitTextToSize(introParagraph, 170);
  doc.text(wrappedIntro, 20, 115);
  
  doc.setFont("helvetica", "bold");
  doc.text("Terms of Offer:", 20, 145);
  
  doc.setFont("helvetica", "normal");
  doc.text(`• Position Title: ${role}`, 25, 155);
  doc.text("• Department: Core Software Engineering & Operations", 25, 162);
  doc.text("• Starting Date: [Start Date Placeholder - To be aligned upon acceptance]", 25, 169);
  doc.text("• Compensation Structure: [Base Salary Placeholder - Market Competitive]", 25, 176);
  doc.text("• Reporting Structure: Director of Engineering", 25, 183);
  
  const closingText = `Please confirm your acceptance of this offer by signing below and returning this letter within five business days. We are confident that your background and skills will make a valuable addition to our core team and look forward to building innovative systems together.`;
  const wrappedClosing = doc.splitTextToSize(closingText, 170);
  doc.text(wrappedClosing, 20, 200);
  
  // Signatures
  doc.line(20, 240, 90, 240);
  doc.text("Authorized HR Signature", 20, 245);
  doc.text("SmartDocs AI Recruitment Office", 20, 250);
  
  doc.line(120, 240, 190, 240);
  doc.text("Candidate Acceptance Signature", 120, 245);
  doc.text("Date:", 120, 250);
  
  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text("Confidential Offer Letter - SmartDocs AI, Inc. All rights reserved.", 20, 285);
  
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

// 6. GET /api/smart-email/assessments/:id/interview-questions — Retrieve/Generate 5 Interview Questions
app.get('/api/smart-email/assessments/:id/interview-questions', async (req, res) => {
  try {
    const db = loadDb();
    const idx = db.candidateAssessments.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Assessment not found.' });

    const assess = db.candidateAssessments[idx];
    if (assess.interviewQuestions && assess.interviewQuestions.length === 5) {
      return res.json({ questions: assess.interviewQuestions });
    }

    // Generate questions via Gemini 2.5
    let questions: string[] = [];
    try {
      const client = getGeminiClient();
      const prompt = `You are an AI Technical Interviewer. Generate exactly 5 dynamic interview questions for candidate ${assess.candidateName} applying for the role of "${assess.role}".
      
The questions should be based on:
- Candidate Profile Skills: ${assess.profile ? assess.profile.skills.join(', ') : 'standard technical competencies'}
- Candidate Resume/Profile Context
- Screening Quiz Score: ${assess.score || 0}/10

Make the questions highly context-specific, evaluating their depth of knowledge, problem-solving mindset, and engineering decisions. The questions should test their understanding of areas they might have struggled with in the screening quiz.

Return a JSON object with a single key "questions" containing a list of exactly 5 text strings:
{ "questions": ["...", "...", "...", "...", "..."] }`;

      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ['questions']
          }
        }
      });

      const parsed = JSON.parse(response.text || '{}');
      if (parsed.questions && parsed.questions.length === 5) {
        questions = parsed.questions;
      }
    } catch (apiErr) {
      console.warn('Gemini interview question generator error, using default questions:', apiErr);
    }

    if (questions.length !== 5) {
      questions = [
        `Can you explain a challenging technical problem you solved in your past projects related to ${assess.role}?`,
        `How do you handle technical debt and code refactoring when working under tight deadlines?`,
        `What is your approach to designing scalability and reliability into a Web application?`,
        `How do you ensure proper security standards (like preventing injection or credentials leak) in your software?`,
        `Why are you interested in this position, and how do your skills align with the requirements of this role?`
      ];
    }

    db.candidateAssessments[idx].interviewQuestions = questions;
    saveDb(db);

    res.json({ questions });
  } catch (err: any) {
    console.error('Interview questions error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch interview questions.' });
  }
});

// 7. POST /api/smart-email/assessments/:id/interview-submit — Grade interview & decide Offer vs Reject
app.post('/api/smart-email/assessments/:id/interview-submit', async (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers || !Array.isArray(answers) || answers.length !== 5) {
      return res.status(400).json({ error: 'Exactly 5 interview answers are required.' });
    }

    const db = loadDb();
    const idx = db.candidateAssessments.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Assessment not found.' });

    const assess = db.candidateAssessments[idx];
    if (assess.interviewCompleted) {
      return res.status(400).json({ error: 'Interview already completed.' });
    }

    // AI grading metrics
    let metrics = {
      confidence: 8,
      communication: 8,
      accuracy: 8,
      problemSolving: 8,
      behavior: 8,
      professionalism: 8,
      grammar: 8,
      overallScore: 8
    };
    let feedback = '';

    try {
      const client = getGeminiClient();
      const graderPrompt = `You are a professional hiring manager and engineering director. Grade this candidate's response to 5 technical interview questions for the position of "${assess.role}".
      
Candidate: ${assess.candidateName}
Role: ${assess.role}
Questions: ${JSON.stringify(assess.interviewQuestions)}
Answers: ${JSON.stringify(answers)}

Evaluate these metrics out of 10:
- confidence: tone, speech clarity, assurance.
- communication: coherence, ease of understanding.
- accuracy: technical correctness of answers.
- problemSolving: coding/analytical approaches.
- behavior: handling scenarios, leadership, collaboration.
- professionalism: standard practices, engineering integrity.
- grammar: structural correctness of phrasing.
- overallScore: overall suitability score (must reflect average).

Also write a 3-4 sentence detailed summary feedback.
Return a JSON object:
{
  "confidence": 8,
  "communication": 8,
  "accuracy": 7,
  "problemSolving": 8,
  "behavior": 9,
  "professionalism": 8,
  "grammar": 9,
  "overallScore": 8,
  "feedback": "..."
}`;

      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: graderPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              confidence: { type: Type.INTEGER },
              communication: { type: Type.INTEGER },
              accuracy: { type: Type.INTEGER },
              problemSolving: { type: Type.INTEGER },
              behavior: { type: Type.INTEGER },
              professionalism: { type: Type.INTEGER },
              grammar: { type: Type.INTEGER },
              overallScore: { type: Type.INTEGER },
              feedback: { type: Type.STRING }
            },
            required: ['confidence', 'communication', 'accuracy', 'problemSolving', 'behavior', 'professionalism', 'grammar', 'overallScore', 'feedback']
          }
        }
      });

      const parsed = JSON.parse(response.text || '{}');
      metrics = {
        confidence: parsed.confidence || 8,
        communication: parsed.communication || 8,
        accuracy: parsed.accuracy || 8,
        problemSolving: parsed.problemSolving || 8,
        behavior: parsed.behavior || 8,
        professionalism: parsed.professionalism || 8,
        grammar: parsed.grammar || 8,
        overallScore: parsed.overallScore || 8
      };
      feedback = parsed.feedback || 'Good job on the technical discussion.';
    } catch (apiErr) {
      console.warn('Gemini evaluation grading error, using defaults:', apiErr);
      feedback = 'Evaluation completed. Standard candidate screening response.';
    }

    const passed = metrics.overallScore >= 7;
    const finalDecision = passed ? 'hired' : 'rejected';

    // Save final state
    db.candidateAssessments[idx].interviewCompleted = true;
    db.candidateAssessments[idx].interviewCompletedAt = new Date().toISOString();
    db.candidateAssessments[idx].interviewAnswers = answers;
    db.candidateAssessments[idx].interviewMetrics = metrics;
    db.candidateAssessments[idx].finalDecision = finalDecision;

    // Send correspondence via email (Offer letter with PDF attachment OR rejection feedback)
    let subject = '';
    let htmlBody = '';
    let pdfBuffer: Buffer | null = null;

    if (passed) {
      subject = `Official Job Offer: ${assess.role} - SmartDocs AI`;
      htmlBody = `<p>Dear ${assess.candidateName},</p>
<p>We are absolutely thrilled to extend you a formal offer of employment for the position of <strong>${assess.role}</strong> at SmartDocs AI.</p>
<p>You achieved an exceptional score of <strong>${metrics.overallScore}/10</strong> in our final technical interview, demonstrating top-tier capabilities in communication, accuracy, and problem solving.</p>
<p>Please find your formal <strong>Job Offer Letter PDF</strong> attached to this email. We would love to welcome you to our core software operations.</p>
<p>Warm regards,</p>
<p>The Recruitment Board</p>`;

      try {
        pdfBuffer = generateOfferLetterPdf(assess.candidateName, assess.role);
        db.candidateAssessments[idx].offerLetterUrl = `/api/smart-email/assessments/${assess.id}/offer-letter`;
      } catch (pdfErr) {
        console.error('Failed to generate jsPDF offer letter:', pdfErr);
      }
    } else {
      subject = `Application Decision: ${assess.role} - SmartDocs AI`;
      htmlBody = `<p>Dear ${assess.candidateName},</p>
<p>Thank you for participating in our final round AI Technical Interview for the position of <strong>${assess.role}</strong>.</p>
<p>We appreciated hearing your insights. After compiling scores, your overall rating is <strong>${metrics.overallScore}/10</strong>. Unfortunately, we will not be moving forward with your candidacy at this time.</p>
<p><strong>Constructive Panel Feedback:</strong></p>
<p><em>${feedback}</em></p>
<p>We wish you the very best in your search and encourage you to apply for roles at our firm in the future.</p>`;
      db.candidateAssessments[idx].rejectionFeedback = feedback;
    }

    // Dispatch the email
    try {
      const transporter = getEmailTransporter();
      const emailHtml = buildEmailHtml(subject, htmlBody, 'resume', 'Recruitment System');

      const mailOptions: any = {
        from: `"SmartDocs AI Recruitment" <${process.env.GMAIL_USER}>`,
        to: assess.candidateEmail,
        subject: subject,
        html: emailHtml,
        text: htmlBody.replace(/<[^>]*>/g, '')
      };

      if (pdfBuffer) {
        mailOptions.attachments = [
          {
            filename: `Job_Offer_Letter_${assess.candidateName.replace(/\s+/g, '_')}.pdf`,
            content: pdfBuffer
          }
        ];
      }

      await transporter.sendMail(mailOptions);
    } catch (smtpErr: any) {
      console.error('Failed to email interview results:', smtpErr.message);
    }

    saveDb(db);

    res.json({ success: true, finalDecision, metrics, feedback });
  } catch (err: any) {
    console.error('Submit interview error:', err);
    res.status(500).json({ error: err.message || 'Failed to submit interview.' });
  }
});

// 8. GET /api/smart-email/assessments/:id/offer-letter — Download dynamic PDF Offer Letter
app.get('/api/smart-email/assessments/:id/offer-letter', (req, res) => {
  try {
    const db = loadDb();
    const assess = db.candidateAssessments.find(a => a.id === req.params.id);
    if (!assess) return res.status(404).send('Assessment not found.');
    if (assess.finalDecision !== 'hired') return res.status(400).send('Offer letter not available.');

    const pdfBuffer = generateOfferLetterPdf(assess.candidateName, assess.role);
    res.contentType('application/pdf');
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).send(err.message || 'Error generating offer letter.');
  }
});

// 9. GET /api/smart-email/documents/:id/answer-key-pdf — Download dynamic PDF Answer Key
app.get('/api/smart-email/documents/:id/answer-key-pdf', (req, res) => {
  try {
    const db = loadDb();
    const doc = db.documents.find(d => d.id === req.params.id);
    if (!doc) return res.status(404).send('Document not found.');
    if (!doc.answerKeyQuestions) return res.status(400).send('Answer Key not available.');

    const pdfBuffer = generateAnswerKeyPdf(doc.title, doc.answerKeyQuestions);
    res.contentType('application/pdf');
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).send(err.message || 'Error generating answer key PDF.');
  }
});

// 10. POST /api/smart-email/assessments/:id/override — Recruiter manual overrides
app.post('/api/smart-email/assessments/:id/override', async (req, res) => {
  try {
    const { action, decision } = req.body;
    const db = loadDb();
    const idx = db.candidateAssessments.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Assessment not found.' });

    const assess = db.candidateAssessments[idx];
    const doc = db.documents.find(d => d.id === assess.documentId);
    
    if (action === 'resend') {
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const assessmentLink = `${appUrl}/?assessId=${assess.id}`;
      const expiryTime = new Date(Date.now() + 48 * 60 * 60 * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      await sendAssessmentInviteEmail(assess.candidateEmail, assess.candidateName, assess.role, assessmentLink, expiryTime);
    }
    else if (action === 'reopen') {
      db.candidateAssessments[idx].completed = false;
      db.candidateAssessments[idx].score = undefined;
      db.candidateAssessments[idx].timeRemaining = 600;
      db.candidateAssessments[idx].cheatAttemptsCount = 0;
      db.candidateAssessments[idx].finalDecision = 'pending';
      db.candidateAssessments[idx].interviewInvited = false;
      db.candidateAssessments[idx].interviewCompleted = false;
    }
    else if (action === 'regenerate') {
      let questions = getFallbackAssessmentQuestions(assess.role);
      try {
        const client = getGeminiClient();
        const quizPrompt = `Generate exactly 10 multiple-choice questions for candidate ${assess.candidateName} applying for ${assess.role} at medium difficulty level.`;
        const response = await client.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: quizPrompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctAnswer: { type: Type.INTEGER },
                  explanation: { type: Type.STRING }
                },
                required: ['question', 'options', 'correctAnswer', 'explanation']
              }
            }
          }
        });
        const parsed = JSON.parse(response.text || '[]');
        if (parsed.length >= 10) questions = parsed.slice(0, 10);
      } catch (err) {
        console.warn('Override regenerate failed, using fallbacks');
      }
      db.candidateAssessments[idx].questions = questions.sort(() => Math.random() - 0.5);
      db.candidateAssessments[idx].completed = false;
      db.candidateAssessments[idx].score = undefined;
      db.candidateAssessments[idx].timeRemaining = 600;
      db.candidateAssessments[idx].cheatAttemptsCount = 0;
    }
    else if (action === 'reevaluate') {
      if (!decision || (decision !== 'offer' && decision !== 'rejection')) {
        return res.status(400).json({ error: 'Valid decision ("offer" | "rejection") is required for re-evaluation.' });
      }
      
      const isOffer = decision === 'offer';
      db.candidateAssessments[idx].finalDecision = isOffer ? 'hired' : 'rejected';
      db.candidateAssessments[idx].decisionSent = isOffer ? 'offer' : 'rejection';
      
      // Dispatch email correspondence
      let subject = '';
      let htmlBody = '';
      let pdfBuffer: Buffer | null = null;
      
      if (isOffer) {
        subject = `Job Offer: ${assess.role} - SmartDocs AI`;
        htmlBody = `<p>Dear ${assess.candidateName},</p>
<p>Congratulations! After a manual re-evaluation of your screening results for the position of <strong>${assess.role}</strong>, we are pleased to extend you a formal offer of employment.</p>
<p>Your formal Job Offer PDF is attached to this email. Please review it at your convenience.</p>`;
        try {
          pdfBuffer = generateOfferLetterPdf(assess.candidateName, assess.role);
          db.candidateAssessments[idx].offerLetterUrl = `/api/smart-email/assessments/${assess.id}/offer-letter`;
        } catch (pdfErr) {
          console.error(pdfErr);
        }
      } else {
        subject = `Application Decision: ${assess.role} - SmartDocs AI`;
        htmlBody = `<p>Dear ${assess.candidateName},</p>
<p>Thank you for your interest in the position of <strong>${assess.role}</strong> at SmartDocs AI.</p>
<p>After manual review, we regret to inform you that we will not be moving forward with your application. We wish you the best in your search.</p>`;
      }
      
      try {
        const transporter = getEmailTransporter();
        const fullHtml = buildEmailHtml(subject, htmlBody, 'resume', 'Recruitment Office');
        const mailOptions: any = {
          from: `"SmartDocs AI Recruitment" <${process.env.GMAIL_USER}>`,
          to: assess.candidateEmail,
          subject: subject,
          html: fullHtml,
          text: htmlBody.replace(/<[^>]*>/g, '')
        };
        if (pdfBuffer) {
          mailOptions.attachments = [
            {
              filename: `Job_Offer_Letter_${assess.candidateName.replace(/\s+/g, '_')}.pdf`,
              content: pdfBuffer
            }
          ];
        }
        await transporter.sendMail(mailOptions);
      } catch (smtpErr: any) {
        console.error('SMTP override mail failed:', smtpErr);
      }
    }
    else if (action === 'rerun_interview') {
      db.candidateAssessments[idx].interviewCompleted = false;
      db.candidateAssessments[idx].interviewAnswers = undefined;
      db.candidateAssessments[idx].interviewMetrics = undefined;
      db.candidateAssessments[idx].finalDecision = 'pending';
    }

    saveDb(db);
    res.json({ success: true, assessment: db.candidateAssessments[idx] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// Connect Vite integration or serve production files
async function startServer() {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        allowedHosts: true,
        hmr: {
          server: httpServer
        }
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
