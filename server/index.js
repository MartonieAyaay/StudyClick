const express = require('express')
const cors = require('cors')
require('dotenv').config()

const { GoogleGenAI } = require('@google/genai')
const app = express()

const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]

app.use(cors({
    origin(origin, callback) {
        if (!origin || origin === 'null' || allowedOrigins.includes(origin)) {
            callback(null, true)
        } else {
            callback(new Error('Not allowed by CORS'))
        }
    },
}))
app.use(express.json())

function getClient(req) {
    const key = req.header('x-gemini-api-key') || process.env.GEMINI_API_KEY
    if (!key || !key.trim()) {
        const err = new Error('No Gemini API key set. Add one in StudyClick under Settings, or set GEMINI_API_KEY in server/.env.')
        err.status = 400
        throw err
    }
    return new GoogleGenAI({ apiKey: key.trim() })
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function extractUsage(response) {
    const u = (response && response.usageMetadata) || {}
    return {
        promptTokens: u.promptTokenCount || 0,
        outputTokens: u.candidatesTokenCount || 0,
        totalTokens: u.totalTokenCount || 0,
    }
}

async function generateWithRetry(ai, params, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await ai.models.generateContent(params)
        } catch (err) {
            const message = String(err)
            const isResourceExhausted = message.includes('RESOURCE_EXHAUSTED') || message.includes('429')
            const isDailyQuotaExhausted = isResourceExhausted && /perday/i.test(message.replace(/[\s_-]/g, ''))

            if (isDailyQuotaExhausted) {
                const quotaErr = new Error("You've used up today's free Gemini request limit. It resets at midnight Pacific time — try again later, or add a different API key in Settings.")
                quotaErr.status = 429
                throw quotaErr
            }

            const isOverloaded = message.includes('503') || message.includes('UNAVAILABLE') || message.includes('fetch failed') || message.includes('Timeout') || isResourceExhausted
            if (isOverloaded && attempt < maxRetries) {
                console.log(`Gemini overloaded. Retrying (attempt ${attempt})...`)
                await delay(1000 * attempt)
            } else {
                throw err
            }
        }
    }
}

const CHUNK_CHAR_THRESHOLD = 18000

function splitTextIntoChunks(text, maxChars) {
    const paragraphs = text.split(/\n\s*\n/)
    const chunks = []
    let current = ''
    for (const para of paragraphs) {
        if (current && (current + '\n\n' + para).length > maxChars) {
            chunks.push(current.trim())
            current = para
        } else {
            current = current ? current + '\n\n' + para : para
        }
    }
    if (current.trim()) chunks.push(current.trim())

    const final = []
    for (const chunk of chunks) {
        if (chunk.length <= maxChars) {
            final.push(chunk)
        } else {
            for (let i = 0; i < chunk.length; i += maxChars) {
                final.push(chunk.slice(i, i + maxChars))
            }
        }
    }
    return final
}

function dedupeBy(items, keyFn) {
    const seen = new Set()
    const result = []
    for (const item of items) {
        const key = keyFn(item)
        if (!seen.has(key)) {
            seen.add(key)
            result.push(item)
        }
    }
    return result
}

function isStartHereConcept(concept) {
    return /start here|basic vocabulary/i.test(`${concept.classification} ${concept.title}`)
}

async function generateModuleContent(ai, text, descriptionStyle = 'verbatim', includeExamples = true) {
    if (text.length > CHUNK_CHAR_THRESHOLD) {
        return generateChunkedModuleContent(ai, text, descriptionStyle, includeExamples)
    }
    return generateModuleContentSingle(ai, text, descriptionStyle, includeExamples)
}

async function generateChunkedModuleContent(ai, text, descriptionStyle, includeExamples) {
    const chunks = splitTextIntoChunks(text, CHUNK_CHAR_THRESHOLD)
    let combined = null
    const totalUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 }

    for (const chunk of chunks) {
        const { data, usage } = await generateModuleContentSingle(ai, chunk, descriptionStyle, includeExamples)
        totalUsage.promptTokens += usage.promptTokens
        totalUsage.outputTokens += usage.outputTokens
        totalUsage.totalTokens += usage.totalTokens

        if (!combined) {
            combined = data
            continue
        }

        combined.keyConcepts.vital = dedupeBy(
            [...combined.keyConcepts.vital, ...data.keyConcepts.vital],
            (item) => item.idea.toLowerCase()
        ).slice(0, 6)

        combined.keyConcepts.glossary = dedupeBy(
            [...combined.keyConcepts.glossary, ...data.keyConcepts.glossary],
            (item) => item.term.toLowerCase()
        )

        combined.concepts = [
            ...combined.concepts,
            ...data.concepts.filter((c) => !isStartHereConcept(c)),
        ]
    }

    return { data: combined, usage: totalUsage }
}

async function generateModuleContentSingle(ai, text, descriptionStyle = 'verbatim', includeExamples = true) {
    if (descriptionStyle !== 'verbatim' && descriptionStyle !== 'paraphrase') {
        throw new Error('Select either verbatim or paraphrase')
    }

    const styleInstruction = descriptionStyle === 'paraphrase'
        ? 'Write descriptions in simple, paraphrased language, easy for a student to understand.'
        : 'Use wording as close as possible to the original source text (verbatim), not paraphrased.'

    const examplesInstruction = includeExamples
        ? `- "examples": worked examples for this concept, but ONLY when the concept genuinely benefits from a step-by-step worked problem (math, formulas, calculations, procedures, algorithms, or anything with a concrete right/wrong answer to work through). If the concept is purely definitional, conceptual, historical, or descriptive and there is no meaningful problem to solve, return an empty array — do not invent a trivial or filler example just to fill the field. When examples ARE warranted, include 1 to 3 of them ordered easiest to hardest (e.g. "Straightforward", "Moderately involved", "Edge case" — use however many genuinely add value, not always 3). Each is {tag, problem, steps, answer} where "steps" is an array of full-sentence solution steps (not just bare math) and "answer" states the final answer clearly.`
        : `- "examples": always return an empty array for this field. Do not generate worked examples for this reviewer.`

    const prompt = `You are an expert tutor building a comprehensive, detailed interactive study reviewer for a student preparing for an exam, in the same style as a professionally written textbook companion guide. Given the lesson content below, generate a complete, richly detailed reviewer with the following three parts:

1. SUMMARY: a short, high-level overview of the lesson in exactly 3 to 5 sentences, one tight paragraph. Just orient the student on what this lesson covers and why it matters — do not try to explain every concept in detail here, that's what the Key Concepts and Concepts sections below are for. Keep it concise even if the source material is long.

2. KEY CONCEPTS:
- "vital": the most important high-level ideas from this lesson, each as {idea, why} where "idea" is a punchy one-sentence statement and "why" explains in a sentence why it matters or how it connects to the rest of the material. Scale this to how much is actually here — typically 3 to 6, fewer for a narrow or short lesson, more only if the material genuinely supports it. Never leave this empty, but never pad it with filler ideas just to hit a count either.
- "glossary": a complete plain-English glossary covering every important term, name, date, formula, or concept mentioned in the lesson that a student could be tested on. Include exactly as many as are genuinely present in the material — that could be 2 for a very short lesson, or 30+ for a dense one. Each entry is {term, def} with a short, clear, plain-English definition. Never leave this empty, but never invent filler entries just to reach a count.

3. CONCEPTS: break the lesson down into individual teachable concepts, closely mirroring how the source material itself is organized into distinct definitions, rules, theorems, or methods. Scale the number of concepts to how much distinct material genuinely exists — a short, narrow lesson might only have 2 or 3 real concepts, while a dense chapter could have 15 or more. Never split one idea into multiple entries just to pad the count, and never omit a real distinct concept just to keep the count low. This array must NEVER be empty. For EACH concept generate:
- "classification": a short tag describing the kind of concept (e.g. "Definition", "Theorem", "Method", "Algorithm", "Notation"), optionally with a subtopic label like "Definition · Subtopic 1"
- "title": a short, descriptive title
- "definition": a thorough explanation, using an HTML unordered list (<ul class="def-list"><li>...</li></ul>) if it has multiple parts, rules, or steps. Stay faithful to the source material's own explanation.
- "formula": if this concept has a formula, equation, or symbolic notation, include it as a short string (use HTML entities for math symbols like &equiv; &radic; &sup2; where helpful). Omit this field entirely if there is no formula.
${examplesInstruction}

The first concept in the array must always be a "Start Here · Core Vocabulary" primer titled "The 5%: Basic Vocabulary for [Lesson Topic]" defining the 4-6 most foundational terms needed before anything else in the lesson makes sense, in the same {classification, title, definition, examples} shape as other concepts (its "examples" should also follow the same rule above — usually empty, since vocabulary primers rarely need worked problems).

${styleInstruction}

Lesson content:
${text}`

    const response = await generateWithRetry(ai, {
        model: 'gemini-flash-lite-latest',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseJsonSchema: {
                type: 'object',
                properties: {
                    summary: { type: 'string' },
                    keyConcepts: {
                        type: 'object',
                        properties: {
                            vital: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        idea: { type: 'string' },
                                        why: { type: 'string' }
                                    },
                                    required: ['idea', 'why']
                                }
                            },
                            glossary: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        term: { type: 'string' },
                                        def: { type: 'string' }
                                    },
                                    required: ['term', 'def']
                                }
                            }
                        },
                        required: ['vital', 'glossary']
                    },
                    concepts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                classification: { type: 'string' },
                                title: { type: 'string' },
                                definition: { type: 'string' },
                                formula: { type: 'string' },
                                examples: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            tag: { type: 'string' },
                                            problem: { type: 'string' },
                                            steps: { type: 'array', items: { type: 'string' } },
                                            answer: { type: 'string' }
                                        },
                                        required: ['tag', 'problem', 'steps', 'answer']
                                    }
                                }
                            },
                            required: ['classification', 'title', 'definition', 'examples']
                        }
                    }
                },
                required: ['summary', 'keyConcepts', 'concepts']
            },
            maxOutputTokens: 32768
        }
    })

    const finishReason = response.candidates?.[0]?.finishReason
    console.log('[generateModuleContent] finishReason:', finishReason, '| raw text length:', response.text ? response.text.length : 0)

    if (!response.text || !response.text.trim()) {
        console.error('[generateModuleContent] Empty response from Gemini. Full response:', JSON.stringify(response, null, 2).slice(0, 2000))
        throw new Error('Gemini returned an empty response for this content. This can happen if the source text triggered a safety filter, or if the model ran out of output space. Try again, or try a shorter source.')
    }

    let data
    try {
        data = JSON.parse(response.text)
    } catch (err) {
        console.error('[generateModuleContent] Failed to parse Gemini JSON. Raw text was:', response.text.slice(0, 2000))
        throw new Error('Gemini returned malformed content and it could not be parsed. Please try generating again.')
    }

    if (!data.concepts || data.concepts.length === 0) {
        console.error('[generateModuleContent] Parsed JSON has zero concepts. Full parsed data:', JSON.stringify(data).slice(0, 2000))
        throw new Error('Gemini returned no concepts for this module. Please try generating again.')
    }

    return { data, usage: extractUsage(response) }
}

async function determineModules(ai, sources) {
    if (sources.length > 1) {
        return {
            modules: sources.map((source) => ({
                title: source.name,
                text: source.text,
            })),
            usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
        }
    }

    const singleText = sources[0].text

    const response = await generateWithRetry(ai, {
        model: 'gemini-flash-lite-latest',
        contents: `The following is study material that may cover one single topic, or may contain multiple distinct lessons or modules. If it covers multiple distinct topics, split into separate modules, each with a short descriptive title with the exact portion of the original text belonging to that module (do not alter text, just split it). If it is a single cohesive topic, return it as one module that contains the entire text.\n\nMaterial:\n${singleText}`,
        config: {
            responseMimeType: 'application/json',
            responseJsonSchema: {
                type: 'object',
                properties: {
                    modules: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                title: { type: 'string' },
                                text: { type: 'string' },
                            },
                            required: ['title', 'text'],
                        },
                    },
                },
                required: ['modules'],
            },
        },
    })

    const data = JSON.parse(response.text)
    return { modules: data.modules, usage: extractUsage(response) }
}

function computeQuestionCount(modules) {
    const totalChars = modules.reduce((sum, m) => sum + m.text.length, 0)
    const scaled = modules.length * 8 + Math.floor(totalChars / 800)
    return Math.max(15, Math.min(60, scaled))
}

async function generateFinalTest(ai, modules, quizType = {}, difficulty = 'Easy') {
    const wantsMultipleChoice = Boolean(quizType.multipleChoice)
    const wantsTrueFalse = Boolean(quizType.trueFalse)

    if (!wantsMultipleChoice && !wantsTrueFalse) {
        throw new Error('Select at least one quiz type')
    }

    const totalQuestions = computeQuestionCount(modules)
    const quizTypesText = [
        wantsMultipleChoice ? 'multiple choice' : null,
        wantsTrueFalse ? 'true or false' : null,
    ].filter(Boolean).join(' and ')

    const combinedMaterial = modules
        .map((module, index) => `Module ${index + 1}: ${module.title}\n${module.text}`)
        .join('\n\n---\n\n')

    const prompt = `The following study material contains multiple modules/lessons. Generate a single final test with exactly ${totalQuestions} questions at ${difficulty} difficulty, drawing questions from across ALL modules as evenly as possible, using only these question types: ${quizTypesText}. For multiple choice questions, set "type" to "multiple-choice" and include an "options" array with 4 choices. For true/false questions, set "type" to "true-false" and omit "options". "correctAnswer" must exactly match the correct option text for multiple choice, or be "True"/"False" for true/false questions.\n\nStudy material:\n${combinedMaterial}`

    const response = await generateWithRetry(ai, {
        model: 'gemini-flash-lite-latest',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseJsonSchema: {
                type: 'object',
                properties: {
                    quiz: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                type: { type: 'string' },
                                question: { type: 'string' },
                                options: { type: 'array', items: { type: 'string' } },
                                correctAnswer: { type: 'string' }
                            },
                            required: ['type', 'question', 'correctAnswer']
                        }
                    }
                },
                required: ['quiz']
            },
            maxOutputTokens: 16384
        }
    })

    if (!response.text || !response.text.trim()) {
        console.error('[generateFinalTest] Empty response from Gemini.')
        throw new Error('Gemini returned an empty response while generating the Final Test. Please try again.')
    }

    let data
    try {
        data = JSON.parse(response.text)
    } catch (err) {
        console.error('[generateFinalTest] Failed to parse Gemini JSON. Raw text was:', response.text.slice(0, 2000))
        throw new Error('Gemini returned malformed content for the Final Test. Please try again.')
    }

    if (!data.quiz || data.quiz.length === 0) {
        console.error('[generateFinalTest] Parsed JSON has zero questions.')
        throw new Error('Gemini returned no questions for the Final Test. Please try again.')
    }

    return { quiz: data.quiz, usage: extractUsage(response) }
}

app.get('/', (req, res) => {
    res.send('Server is running')
})

app.get('/test-ai', async (req, res) => {
    try {
        const ai = getClient(req)
        const response = await ai.models.generateContent({
            model: 'gemini-flash-lite-latest',
            contents: 'say a simple one sentence greeting message to the user in a friendly tone',
        })
        res.send(response.text)
    } catch (err) {
        console.error(err)
        res.status(err.status || 500).send(err.message || 'Something went wrong calling gemini')
    }
})

app.get('/has-api-key', (req, res) => {
    try {
        getClient(req)
        res.json({ hasKey: true })
    } catch (err) {
        res.json({ hasKey: false })
    }
})

app.post('/echo', (req, res) => {
    console.log(req.body)
    res.json({ youSent: req.body })
})

app.post('/generate', async (req, res) => {
    try {
        const ai = getClient(req)
        const { text, descriptionStyle = 'verbatim', includeExamples = true } = req.body

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'No text provided' })
        }

        const { data, usage } = await generateModuleContent(ai, text, descriptionStyle, includeExamples)
        res.json({ ...data, usage })
    } catch (err) {
        console.error(err)
        res.status(err.status || 500).json({ error: err.message || 'Failed to generate reviewer content' })
    }
})

app.post('/test-modules', async (req, res) => {
    try {
        const ai = getClient(req)
        const { sources } = req.body
        if (!sources || sources.length === 0) {
            return res.status(400).json({ error: 'No sources provided' })
        }
        const { modules, usage } = await determineModules(ai, sources)
        res.json({ modules, usage })
    } catch (err) {
        console.error(err)
        res.status(err.status || 500).json({ error: err.message || 'Failed to determine modules' })
    }
})

app.post('/test-final-test', async (req, res) => {
    try {
        const ai = getClient(req)
        const { modules, quizType, difficulty } = req.body
        if (!modules || modules.length === 0) {
            return res.status(400).json({ error: 'No modules provided' })
        }
        const { quiz, usage } = await generateFinalTest(ai, modules, quizType, difficulty)
        res.json({ quiz, usage })
    } catch (err) {
        console.error(err)
        res.status(err.status || 500).json({ error: err.message || 'Failed to generate final test' })
    }
})

app.post('/generate-reviewer', async (req, res) => {
    try {
        const ai = getClient(req)
        const {
            sources,
            descriptionStyle = 'verbatim',
            includeExamples = true,
            quizType,
            difficulty
        } = req.body

        if (!sources || sources.length === 0) {
            return res.status(400).json({ error: 'No sources provided' })
        }

        const { modules, usage: modulesUsage } = await determineModules(ai, sources)
        let totalTokens = modulesUsage.totalTokens
        let totalRequests = 1

        const generatedModules = []
        for (const module of modules) {
            const { data, usage } = await generateModuleContent(ai, module.text, descriptionStyle, includeExamples)
            generatedModules.push({ title: module.title, ...data })
            totalTokens += usage.totalTokens
            totalRequests += 1
        }

        const { quiz: finalTest, usage: finalUsage } = await generateFinalTest(ai, modules, quizType, difficulty)
        totalTokens += finalUsage.totalTokens
        totalRequests += 1

        res.json({ modules: generatedModules, finalTest, usage: { totalTokens, totalRequests } })
    } catch (err) {
        console.error(err)
        res.status(err.status || 500).json({ error: err.message || 'Failed to generate reviewer' })
    }
})

const PORT = 3001
app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`)
})