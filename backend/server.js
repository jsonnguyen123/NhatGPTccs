const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cron = require('node-cron');
const winston = require('winston');
const fs = require('fs');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════
// 🛡️ Blackbaud Token Encryption (server-side storage)
// ═══════════════════════════════════════════════════════════════

const BB_ENCRYPTION_KEY = process.env.BB_ENCRYPTION_KEY;
const bbTokenStore = new Map();
const canvasRefreshStore = new Map();

function encryptToken(token) {
    if (!BB_ENCRYPTION_KEY) throw new Error('BB_ENCRYPTION_KEY not configured');
    const key = Buffer.from(BB_ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptToken(encryptedStr) {
    if (!BB_ENCRYPTION_KEY) throw new Error('BB_ENCRYPTION_KEY not configured');
    const key = Buffer.from(BB_ENCRYPTION_KEY, 'hex');
    const [ivHex, authTagHex, encrypted] = encryptedStr.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs', { recursive: true });
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

const app = express();
const PORT = process.env.PORT || 3000;

const rateLimiter = new RateLimiterMemory({
    keyPrefix: 'canvas_ai_api',
    points: 100,
    duration: 60 * 60,
});

const oauthRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many auth requests, try again later' }
});

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['chrome-extension://*'],
    credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, { ip: req.ip, userAgent: req.get('User-Agent') });
    next();
});

const rateLimitMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7, 23) : '';
        const rateLimitKey = token ? `tok_${token}` : `ip_${req.ip}`;
        await rateLimiter.consume(rateLimitKey);
        next();
    } catch (rateLimiterRes) {
        logger.warn('Rate limit exceeded', { ip: req.ip });
        res.status(429).json({ success: false, error: 'Too many requests', retryAfter: Math.round(rateLimiterRes.msBeforeNext) || 1 });
    }
};

app.use('/api', rateLimitMiddleware);

// ============================================================
// ISSUE REPORT ENDPOINT
// ============================================================
app.post('/api/report-issue', async (req, res) => {
    try {
        const {
            user_name, user_email, issue_type, issue_title,
            description, steps_to_reproduce, browser, os,
            tried_refresh, tried_restart, tried_reinstall,
            tried_docs, additional_info, extension_version, timestamp
        } = req.body;

        if (!user_name || !user_email || !issue_type || !issue_title || !description) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(user_email)) {
            return res.status(400).json({ success: false, error: 'Invalid email format' });
        }

        const rateLimitKey = `report_${user_email}`;
        const now = Date.now();
        if (reportRateLimit.has(rateLimitKey)) {
            const lastSubmission = reportRateLimit.get(rateLimitKey);
            const cooldownMs = 5 * 60 * 1000;
            if (now - lastSubmission < cooldownMs) {
                const remaining = Math.ceil((cooldownMs - (now - lastSubmission)) / 1000);
                return res.status(429).json({ success: false, error: `Please wait ${remaining} seconds before submitting another report.` });
            }
        }

        const emailjsResponse = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: process.env.EMAILJS_SERVICE_ID,
                template_id: process.env.EMAILJS_TEMPLATE_ID,
                user_id: process.env.EMAILJS_PUBLIC_KEY,
                template_params: {
                    user_name, user_email, issue_type, issue_title, description,
                    steps_to_reproduce: steps_to_reproduce || 'Not provided',
                    browser: browser || 'Not specified', os: os || 'Not specified',
                    tried_refresh: tried_refresh || 'No', tried_restart: tried_restart || 'No',
                    tried_reinstall: tried_reinstall || 'No', tried_docs: tried_docs || 'No',
                    additional_info: additional_info || 'None provided',
                    extension_version: extension_version || 'Unknown',
                    timestamp: timestamp || new Date().toLocaleString()
                }
            })
        });

        if (emailjsResponse.ok || emailjsResponse.status === 200) {
            reportRateLimit.set(rateLimitKey, now);
            console.log(`📧 Issue report sent from ${user_email}: ${issue_title}`);
            return res.json({ success: true });
        } else {
            const errorText = await emailjsResponse.text();
            console.error('📧 EmailJS API error:', emailjsResponse.status, errorText);
            return res.status(502).json({ success: false, error: 'Email service failed.' });
        }
    } catch (error) {
        console.error('📧 Report issue error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

const reportRateLimit = new Map();
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, timestamp] of reportRateLimit) {
        if (timestamp < cutoff) reportRateLimit.delete(key);
    }
}, 10 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════
// 🛡️ Canvas Token Validation Middleware
// ═══════════════════════════════════════════════════════════════

const tokenCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000;

async function validateCanvasTokenCached(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
    }
    const canvasToken = authHeader.split(' ')[1];
    if (!canvasToken || canvasToken.length < 10) {
        return res.status(401).json({ success: false, error: 'Invalid token format' });
    }

    const cached = tokenCache.get(canvasToken);
    if (cached && Date.now() < cached.expiresAt) {
        req.canvasUser = cached.user;
        req.canvasToken = canvasToken;
        return next();
    }

    try {
        const response = await fetch('https://christchurchschool.instructure.com/api/v1/users/self/profile', {
            headers: { 'Authorization': `Bearer ${canvasToken}` },
            signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) {
            tokenCache.delete(canvasToken);
            return res.status(401).json({ success: false, error: 'Canvas token is invalid or expired' });
        }
        const profile = await response.json();
        const user = { id: profile.id, name: profile.name, email: profile.primary_email };
        tokenCache.set(canvasToken, { user, expiresAt: Date.now() + TOKEN_CACHE_TTL });
        if (tokenCache.size > 1000) {
            const now = Date.now();
            for (const [key, val] of tokenCache) { if (now > val.expiresAt) tokenCache.delete(key); }
        }
        req.canvasUser = user;
        req.canvasToken = canvasToken;
        next();
    } catch (error) {
        logger.error('Canvas token validation failed:', error.message);
        return res.status(401).json({ success: false, error: 'Token validation failed' });
    }
}

// ═══════════════════════════════════════════════════════════════
// 🛡️ Redirect URI Validation
// ═══════════════════════════════════════════════════════════════

const ALLOWED_REDIRECT_URIS = (process.env.ALLOWED_REDIRECT_URIS || '').split(',').map(u => u.trim()).filter(Boolean);

function validateRedirectUri(redirect_uri) {
    if (!redirect_uri) return false;
    if (/^https:\/\/[a-z]{32}\.chromiumapp\.org\/?$/.test(redirect_uri)) return true;
    if (ALLOWED_REDIRECT_URIS.length > 0 && ALLOWED_REDIRECT_URIS.includes(redirect_uri)) return true;
    return false;
}

// ═══════════════════════════════════════════════════════════════
// 🛡️ Content Moderation
// ═══════════════════════════════════════════════════════════════

function normalizeForSafety(text) {
    if (!text || typeof text !== 'string') return '';
    return text.normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, '')
        .toLowerCase()
        .replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e')
        .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
        .replace(/8/g, 'b').replace(/\$/g, 's').replace(/@/g, 'a')
        .replace(/\|/g, 'l').replace(/!/g, 'i')
        .replace(/[^a-z\s]/g, ' ')
        .replace(/(.)\1{2,}/g, '$1$1')
        .replace(/\s+/g, ' ').trim();
}

function isQuerySafe(query) {
    if (!query || typeof query !== 'string') return { safe: false, reason: 'Invalid query' };
    const cleaned = normalizeForSafety(query);

    const blockedExact = [
        'porn', 'pornography', 'hentai', 'xxx', 'xnxx', 'xvideos', 'pornhub',
        'onlyfans', 'rule34', 'nsfw', 'nude', 'nudes', 'naked',
        'sex tape', 'sextape', 'camgirl', 'escort', 'hooker', 'brothel',
        'suicide method', 'how to kill myself', 'how to kill someone',
        'how to make a bomb', 'how to make drugs', 'how to make meth',
        'buy drugs online', 'buy guns illegally', 'hire hitman',
        'child abuse', 'child porn', 'pedophile', 'paedophile',
        'school shooting', 'mass shooting', 'how to shoot up'
    ];
    const blockedPartial = [
        'porn', 'hentai', 'xxx', 'nsfw', 'nude ', 'nudes',
        'kill myself', 'kill someone', 'commit suicide',
        'make a bomb', 'make meth', 'child porn',
        'gore ', 'snuff ', 'torture video',
        'erectile', 'viagra', 'penis enlarg',
        'white supremac', 'ethnic cleansing', 'race war'
    ];

    if (blockedExact.includes(cleaned)) return { safe: false, reason: 'Inappropriate content' };
    for (const term of blockedPartial) {
        if (cleaned.includes(term)) return { safe: false, reason: 'Inappropriate content' };
    }

    const dangerousPatterns = [
        /how\s+to\s+(kill|murder|poison|harm|hurt)\s+(myself|someone|people|a\s+person)/i,
        /how\s+to\s+(make|build|create)\s+(a\s+)?(bomb|explosive|weapon|gun|meth|cocaine|heroin)/i,
        /where\s+to\s+(buy|get|find)\s+(drugs|guns|weapons|illegal)/i,
        /ways\s+to\s+(die|commit\s+suicide|end\s+(my|it|life))/i,
        /\b(sex|fuck|dick|pussy|cock|tits|boob)\b/i
    ];
    for (const pattern of dangerousPatterns) {
        if (pattern.test(query) || pattern.test(cleaned)) return { safe: false, reason: 'Inappropriate content' };
    }

    if (cleaned.length < 2) return { safe: false, reason: 'Query too short' };
    if (cleaned.length > 500) return { safe: false, reason: 'Query too long' };
    return { safe: true };
}

function sanitizeSearchResults(results) {
    if (!Array.isArray(results)) return [];
    const badSnippetTerms = ['porn', 'xxx', 'nsfw', 'nude', 'naked', 'sex video', 'kill yourself', 'suicide method', 'gore'];
    return results.filter(r => {
        const text = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();
        return !badSnippetTerms.some(term => text.includes(term));
    }).map(r => ({
        title: r.title || '', link: r.link || '', snippet: (r.snippet || '').substring(0, 500)
    }));
}

// ═══════════════════════════════════════════════════════════════
// 🔍 WEB SEARCH HELPER (reused by /api/search and function calling)
// ═══════════════════════════════════════════════════════════════

async function executeWebSearch(query, location = null) {
    const SERPER_API_KEY = process.env.SERPER_API_KEY;
    if (!SERPER_API_KEY) throw new Error('Search API key not configured');

    const safety = isQuerySafe(query);
    if (!safety.safe) {
        logger.warn('Blocked AI-requested search query', { query: query.substring(0, 50), reason: safety.reason });
        return { blocked: true, reason: safety.reason, results: [] };
    }

    const body = { q: query, num: 5 };
    if (location) body.location = location.cityName || `${location.lat},${location.lng}`;

    const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Serper API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    let results = [];

    if (data.answerBox) {
        results.push({ title: data.answerBox.title || 'Answer', link: data.answerBox.link || '', snippet: data.answerBox.answer || data.answerBox.snippet || '' });
    }
    if (data.knowledgeGraph) {
        results.push({ title: data.knowledgeGraph.title || query, link: data.knowledgeGraph.website || '', snippet: data.knowledgeGraph.description || '' });
    }
    if (data.organic) {
        data.organic.slice(0, 5).forEach(item => {
            results.push({ title: item.title || '', link: item.link || '', snippet: item.snippet || '' });
        });
    }
    if (data.peopleAlsoAsk) {
        data.peopleAlsoAsk.slice(0, 2).forEach(paa => {
            results.push({ title: paa.question || '', link: paa.link || '', snippet: paa.snippet || '' });
        });
    }

    results = sanitizeSearchResults(results);
    return { blocked: false, results };
}

// ═══════════════════════════════════════════════════════════════
// 🧠 GEMINI TOOL DECLARATIONS — The "Instruction Manual"
// Gemini reads these descriptions to decide which tool to call.
// The extension executes 8 of these locally; web_search runs
// server-side.
// ═══════════════════════════════════════════════════════════════

const GEMINI_TOOL_DECLARATIONS = [
    {
        function_declarations: [
            {
                name: "get_assignments",
                description: "Get a list of the student's upcoming, overdue, or past assignments from Canvas LMS. Use this when the user asks about homework, what's due, deadlines, submissions, or tasks for a specific course or across all courses. Also use this for questions like 'do I have any hw', 'what's due tomorrow', 'upcoming deadlines'.",
                parameters: {
                    type: "object",
                    properties: {
                        course_name: {
                            type: "string",
                            description: "The name or subject of a specific course to filter assignments for (e.g. 'Physics', 'AP English'). Leave empty for all courses."
                        },
                        time_range: {
                            type: "string",
                            enum: ["today", "tomorrow", "this_week", "next_week", "overdue", "all"],
                            description: "Time range filter for assignments. Use 'overdue' for late/missing work."
                        }
                    }
                }
            },
            {
                name: "get_grades",
                description: "Get the student's grades, scores, percentages, GPA, or performance data from Canvas. Use this when the user asks about grades, scores, how they're doing in a class, what they got on an assignment, their average, failing/passing status, missing grades, or grade trends.",
                parameters: {
                    type: "object",
                    properties: {
                        course_name: {
                            type: "string",
                            description: "Specific course to get grades for (e.g. 'Chemistry', 'Math'). Leave empty for all courses."
                        },
                        filter: {
                            type: "string",
                            enum: ["recent", "missing", "low", "high", "average", "all"],
                            description: "Filter type: 'recent' for latest grades, 'missing' for ungraded, 'low' for worst scores, 'high' for best, 'average' for overall average."
                        }
                    }
                }
            },
            {
                name: "get_dining_menu",
                description: "Get the school dining hall or cafeteria menu. Use this when the user asks about food, meals, what's for lunch/dinner/breakfast, the menu, or anything about the cafeteria or dining hall. When presenting results, always highlight and bold the Entrees section prominently.",
                parameters: {
                    type: "object",
                    properties: {
                        meal_type: {
                            type: "string",
                            enum: ["breakfast", "lunch", "dinner"],
                            description: "Which meal to get the menu for. If not specified, returns all meals for the day."
                        },
                        date: {
                            type: "string",
                            description: "Date in YYYY-MM-DD format. Defaults to today if not specified. Supports 'today', 'tomorrow'."
                        }
                    }
                }
            },
            {
                name: "get_announcements",
                description: "Get Canvas course announcements, news, updates, or bulletins. Use this when the user asks about announcements, what's been posted, course updates, news from a class, or notifications from teachers.",
                parameters: {
                    type: "object",
                    properties: {
                        course_name: {
                            type: "string",
                            description: "Specific course to get announcements for. Leave empty for announcements from all courses."
                        },
                        time_range: {
                            type: "string",
                            enum: ["today", "this_week", "recent", "all"],
                            description: "How far back to look for announcements."
                        }
                    }
                }
            },
            {
                name: "get_course_list",
                description: "List all courses the student is currently enrolled in, with course names, codes, and current grades. Use this when the user asks 'what courses am I taking', 'my classes', 'how many courses', 'what am I enrolled in', or wants an overview of all their classes.",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "get_syllabus",
                description: "Get syllabus information for a specific course, including course description, policies, grading breakdown, textbooks/materials, learning objectives, office hours, and contact info. Use this when the user asks 'what is [course] about', 'syllabus', 'grading policy', 'late policy', 'textbook', 'office hours', or 'tell me about [course]'.",
                parameters: {
                    type: "object",
                    properties: {
                        course_name: {
                            type: "string",
                            description: "The course to get the syllabus for (required). E.g. 'AP Physics', 'English 11'."
                        },
                        section: {
                            type: "string",
                            enum: ["overview", "policies", "grading", "materials", "contact", "all"],
                            description: "Specific section of the syllabus to retrieve. Use 'all' for the full syllabus."
                        }
                    },
                    required: ["course_name"]
                }
            },
            {
                name: "get_assignment_detail",
                description: "Get detailed information about a specific assignment, including its rubric, instructions, submission type, due date, and requirements. Use this when the user asks about a specific assignment's details, rubric, how to submit, instructions, or pastes an assignment URL (courses/X/assignments/Y).",
                parameters: {
                    type: "object",
                    properties: {
                        assignment_name: {
                            type: "string",
                            description: "The name or title of the assignment to look up."
                        },
                        course_id: {
                            type: "string",
                            description: "Canvas course ID (from URL pattern courses/XXXX)."
                        },
                        assignment_id: {
                            type: "string",
                            description: "Canvas assignment ID (from URL pattern assignments/XXXX)."
                        }
                    }
                }
            },
            {
                name: "get_emails",
                description: "Check the student's school Gmail inbox for emails. Use this when the user asks about email, emails, inbox, mail, 'check my email', 'any new emails', 'school email', or 'email from [person]'.",
                parameters: {
                    type: "object",
                    properties: {
                        sender_filter: {
                            type: "string",
                            description: "Filter emails by sender name or address."
                        },
                        subject_filter: {
                            type: "string",
                            description: "Filter emails by subject keyword."
                        }
                    }
                }
            },
            {
                name: "web_search",
                description: "Search the internet for general knowledge, current events, weather, sports scores, factual questions, or anything NOT related to the student's Canvas courses, assignments, grades, or school-specific data. Do NOT use this for school data questions — use the other tools instead. Use this for questions like 'what's the weather', 'who won the game', 'explain quantum physics', 'what is the capital of France'.",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The search query. Should be concise, specific, and appropriate for a school setting."
                        }
                    },
                    required: ["query"]
                }
            }
        ]
    }
];

// ═══════════════════════════════════════════════════════════════
// 🧠 GEMINI HELPER: Build system instruction with Canvas context
// ═══════════════════════════════════════════════════════════════

function buildSystemInstruction(canvasData) {
    const now = new Date();
    const dateString = now.toLocaleDateString('en-US', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    let instruction = `You are a helpful, friendly AI assistant for a student using Canvas LMS at Christchurch School. `;
    instruction += `Today is ${dateString}, current time: ${timeString}.\n`;
    instruction += `You have access to tools that can fetch the student's real school data. `;
    instruction += `\n\nIMPORTANT RULES:\n`;
    instruction += `1. For ANY question about the student's courses, assignments, grades, announcements, syllabus, or emails — ALWAYS use the appropriate tool. Never guess or make up school data.\n`;
    instruction += `2. For general knowledge, current events, weather, math help, or anything NOT about their specific school data — use web_search OR answer from your own knowledge.\n`;
    instruction += `3. If the user just says hi or makes small talk, respond naturally without calling any tool.\n`;
    instruction += `4. Be concise but friendly. Use emojis occasionally. Format responses with markdown when helpful.\n`;
    instruction += `5. When you receive tool results, synthesize them into a natural, helpful response — don't just dump raw data.\n`;
    instruction += `6. NEVER search for inappropriate, violent, sexual, or harmful content.\n`;
    instruction += `7. When the student asks about their grades, assignments, or courses, ALWAYS call the appropriate tool — do NOT say you don't have access. The tools will fetch the data.\n`;
    instruction += `8. When you receive dining menu data, format it by meal. For each meal, **bold the "Entrees" or "Entrées" section** and list those items prominently at the top. Use 🍖 emoji next to entree items so they stand out.\n`;

    if (canvasData) {
        instruction += `\n\n═══ STUDENT'S CANVAS DATA (from their active session) ═══\n`;
        instruction += `Use this data to answer questions directly when possible. For more detailed or fresh data, call the appropriate tool.\n\n`;

        // ── Courses with grades ──
        if (canvasData.courses && canvasData.courses.length > 0) {
            instruction += `📚 ENROLLED COURSES (${canvasData.courses.length}):\n`;
            canvasData.courses.forEach(c => {
                const name = c.name || c.code || 'Unknown';
                const grade = c.grade != null ? `${c.grade}%` : 'N/A';
                const letter = c.letterGrade || c.enrollmentGrade || '';
                const letterStr = letter ? ` (${letter})` : '';
                instruction += `  • ${name} — Current Grade: ${grade}${letterStr}\n`;
            });
            instruction += `\n`;
        }

        // ── Assignments with details ──
        if (canvasData.assignments && canvasData.assignments.length > 0) {
            // Filter out assignments with no due date
            const withDueDate = canvasData.assignments.filter(a => a.dueDate);
            
            const upcoming = withDueDate.filter(a => new Date(a.dueDate) >= now);
            const overdue = withDueDate.filter(a => 
                new Date(a.dueDate) < now && 
                a.status !== 'submitted' && a.status !== 'graded'
            );

            if (overdue.length > 0) {
                instruction += `⚠️ OVERDUE/MISSING ASSIGNMENTS (${overdue.length}):\n`;
                overdue.slice(0, 10).forEach(a => {
                    const due = new Date(a.dueDate).toLocaleDateString('en-US', { 
                        weekday: 'short', month: 'short', day: 'numeric' 
                    });
                    instruction += `  • "${a.title}" for ${a.courseName || 'Unknown'} — was due ${due} [${a.points || '?'} pts]\n`;
                });
                instruction += `\n`;
            }

            if (upcoming.length > 0) {
                instruction += `📅 UPCOMING ASSIGNMENTS (${upcoming.length}):\n`;
                upcoming.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
                upcoming.slice(0, 15).forEach(a => {
                    const due = new Date(a.dueDate).toLocaleDateString('en-US', { 
                        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' 
                    });
                    instruction += `  • "${a.title}" for ${a.courseName || 'Unknown'} — due ${due} [${a.points || '?'} pts] (${a.status || 'pending'})\n`;
                });
                instruction += `\n`;
            }

            instruction += `Total assignments tracked: ${withDueDate.length} (${canvasData.assignments.length - withDueDate.length} with no due date excluded)\n\n`;
        }

        // ── Assignment grades (recent) ──
        if (canvasData.assignmentGrades && canvasData.assignmentGrades.length > 0) {
            const graded = canvasData.assignmentGrades
                .filter(g => g.score != null && g.pointsPossible)
                .sort((a, b) => new Date(b.gradedAt || 0) - new Date(a.gradedAt || 0));

            instruction += `📊 RECENT GRADED ASSIGNMENTS (${graded.length} total, showing latest 15):\n`;
            graded.slice(0, 15).forEach(g => {
                const pct = g.percentage != null ? `${g.percentage}%` : 'N/A';
                const flags = [];
                if (g.late) flags.push('LATE');
                if (g.missing) flags.push('MISSING');
                if (g.excused) flags.push('EXCUSED');
                const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
                instruction += `  • "${g.assignmentName}" in ${g.courseName || 'Unknown'}: ${g.score}/${g.pointsPossible} (${pct})${flagStr}\n`;
            });

            // Missing work
            const missing = canvasData.assignmentGrades.filter(g => g.missing);
            if (missing.length > 0) {
                instruction += `\n  ⚠️ Missing assignments: ${missing.length}\n`;
                missing.slice(0, 5).forEach(g => {
                    instruction += `    • "${g.assignmentName}" in ${g.courseName}\n`;
                });
            }
            instruction += `\n`;
        }

        // ── Announcements ──
        if (canvasData.announcements && canvasData.announcements.length > 0) {
            // Only include announcements from the last 14 days
            const twoWeeksAgo = new Date();
            twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
            const recentAnnouncements = canvasData.announcements.filter(a => {
                if (!a.date) return false;
                return new Date(a.date) >= twoWeeksAgo;
            });

            if (recentAnnouncements.length > 0) {
                instruction += `📢 RECENT ANNOUNCEMENTS (${recentAnnouncements.length}, last 14 days):\n`;
                recentAnnouncements.slice(0, 8).forEach(a => {
                    const date = a.date ? new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                    instruction += `  • "${a.title}" in ${a.course || 'Unknown'} (${date})${a.author ? ` by ${a.author}` : ''}\n`;
                });
                instruction += `\n`;
            }
        }

        // ── Calendar events ──
        if (canvasData.calendarEvents && canvasData.calendarEvents.length > 0) {
            const futureEvents = canvasData.calendarEvents
                .filter(e => e.start && new Date(e.start) >= now)
                .sort((a, b) => new Date(a.start) - new Date(b.start));

            if (futureEvents.length > 0) {
                instruction += `📆 UPCOMING CALENDAR EVENTS (${futureEvents.length}):\n`;
                futureEvents.slice(0, 8).forEach(e => {
                    const date = new Date(e.start).toLocaleDateString('en-US', { 
                        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' 
                    });
                    instruction += `  • ${e.title} — ${date} (${e.course || e.type || 'General'})\n`;
                });
                instruction += `\n`;
            }
        }

        // ── User info ──
        if (canvasData.user) {
            instruction += `👤 Student: ${canvasData.user.name || 'Unknown'}`;
            if (canvasData.user.email) instruction += ` (${canvasData.user.email})`;
            instruction += `\n`;
        }

        instruction += `═══ END OF STUDENT DATA ═══\n`;
        instruction += `\nYou have the student's real data above. Use it to answer their questions. For more detailed or up-to-date info, call the appropriate tool.\n`;
    } else {
        instruction += `\n\n⚠️ No student Canvas data was provided with this request. You MUST use tools (get_assignments, get_grades, get_course_list, etc.) to fetch the student's data. Do NOT say you can't access their data — the tools will work.\n`;
    }

    return instruction;
}

// ═══════════════════════════════════════════════════════════════
// 🧠 GEMINI HELPER: Validate conversation contents
// ═══════════════════════════════════════════════════════════════

function buildValidatedContents(conversationHistory, currentMessage) {
    const contents = [];

    if (conversationHistory && Array.isArray(conversationHistory)) {
        for (const turn of conversationHistory) {
            if (turn.role && turn.content) {
                contents.push({
                    role: turn.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: turn.content }]
                });
            }
        }
    }

    contents.push({ role: 'user', parts: [{ text: currentMessage }] });

    // Ensure alternating roles for Gemini
    const validated = [];
    let prevRole = null;
    for (const item of contents) {
        if (item.role === prevRole) {
            if (validated.length > 0) {
                validated[validated.length - 1].parts[0].text += '\n' + item.parts[0].text;
            }
        } else {
            validated.push(item);
            prevRole = item.role;
        }
    }
    // Gemini requires first message to be 'user'
    while (validated.length > 0 && validated[0].role === 'model') {
        validated.shift();
    }
    return validated;
}

// ═══════════════════════════════════════════════════════════════
// In-memory storage
// ═══════════════════════════════════════════════════════════════

const dataStore = new Map();
const sessionStore = new Map();

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
    res.json({
        success: true, status: 'healthy',
        timestamp: new Date().toISOString(),
        version: require('./package.json').version,
        build: '2025-04-03-v2'
    });
});

// ─── PRE-AUTH: OAuth token exchange ──────────────────────────
app.post('/api/oauth/token', oauthRateLimiter, async (req, res) => {
    try {
        const { code, redirect_uri, code_verifier } = req.body;
        if (!validateRedirectUri(redirect_uri)) {
            logger.warn('OAuth token exchange: invalid redirect_uri', { redirect_uri, ip: req.ip });
            return res.status(400).json({ success: false, error: 'Invalid redirect_uri' });
        }
        if (!code) return res.status(400).json({ success: false, error: 'Authorization code is required' });

        const formParams = { code, grant_type: 'authorization_code', client_id: process.env.CANVAS_CLIENT_ID, client_secret: process.env.CANVAS_CLIENT_SECRET, redirect_uri };
        if (code_verifier) formParams.code_verifier = code_verifier;

        const response = await fetch('https://christchurchschool.instructure.com/login/oauth2/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(formParams)
        });
        if (!response.ok) { const errText = await response.text(); logger.error('Canvas token exchange failed:', errText); return res.status(response.status).json({ success: false, error: 'Token exchange failed' }); }

        const tokenData = await response.json();
        if (tokenData.access_token) {
            try {
                const profileRes = await fetch('https://christchurchschool.instructure.com/api/v1/users/self/profile', { headers: { 'Authorization': `Bearer ${tokenData.access_token}` }, signal: AbortSignal.timeout(8000) });
                if (profileRes.ok) {
                    const profile = await profileRes.json();
                    const userId = String(profile.id);
                    if (tokenData.refresh_token) {
                        canvasRefreshStore.set(userId, { encryptedRefresh: encryptToken(tokenData.refresh_token), storedAt: Date.now() });
                        logger.info('Canvas refresh token stored server-side', { userId });
                    }
                }
            } catch (storeErr) { logger.warn('Failed to store refresh token:', storeErr.message); }
        }

        res.json({ access_token: tokenData.access_token, token_type: tokenData.token_type, expires_in: tokenData.expires_in });
    } catch (error) { logger.error('OAuth token exchange error:', error); res.status(500).json({ success: false, error: 'OAuth token exchange failed' }); }
});

// ─── PRE-AUTH: Canvas token refresh ──────────────────────────
app.post('/api/oauth/refresh', oauthRateLimiter, validateCanvasTokenCached, async (req, res) => {
    const userId = String(req.canvasUser.id);
    const stored = canvasRefreshStore.get(userId);
    if (!stored || !stored.encryptedRefresh) {
        return res.status(401).json({ success: false, error: 'No refresh token stored. Please re-authenticate.', needsReauth: true });
    }
    try {
        const refreshToken = decryptToken(stored.encryptedRefresh);
        const response = await fetch('https://christchurchschool.instructure.com/login/oauth2/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: process.env.CANVAS_CLIENT_ID, client_secret: process.env.CANVAS_CLIENT_SECRET })
        });
        if (!response.ok) { canvasRefreshStore.delete(userId); return res.status(response.status).json({ success: false, error: 'Token refresh failed.', needsReauth: true }); }
        const tokenData = await response.json();
        if (tokenData.refresh_token) { canvasRefreshStore.set(userId, { encryptedRefresh: encryptToken(tokenData.refresh_token), storedAt: Date.now() }); }
        res.json({ access_token: tokenData.access_token, token_type: tokenData.token_type, expires_in: tokenData.expires_in });
    } catch (error) { logger.error('Canvas token refresh error:', error); canvasRefreshStore.delete(userId); res.status(500).json({ success: false, error: error.message }); }
});

// ─── PRE-AUTH: Blackbaud token exchange ──────────────────────
app.post('/api/blackbaud/oauth/token', oauthRateLimiter, async (req, res) => {
    const { code, redirect_uri, canvas_user_id, code_verifier } = req.body;
    if (!validateRedirectUri(redirect_uri)) return res.status(400).json({ success: false, error: 'Invalid redirect_uri' });
    if (!canvas_user_id) return res.status(400).json({ success: false, error: 'canvas_user_id is required' });
    try {
        const response = await fetch('https://oauth2.sky.blackbaud.com/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri, client_id: process.env.BLACKBAUD_CLIENT_ID, client_secret: process.env.BLACKBAUD_CLIENT_SECRET, code_verifier})
        });
        if (!response.ok) { const errText = await response.text(); return res.status(response.status).json({ success: false, error: errText }); }
        const data = await response.json();
        if (!data.access_token) return res.status(502).json({ success: false, error: 'No access token from Blackbaud' });
        const expiresAt = Date.now() + ((data.expires_in || 3600) * 1000);
        bbTokenStore.set(String(canvas_user_id), { encryptedAccess: encryptToken(data.access_token), encryptedRefresh: data.refresh_token ? encryptToken(data.refresh_token) : null, expiresAt });
        logger.info('Blackbaud tokens stored server-side', { userId: canvas_user_id });
        res.json({ success: true, expires_in: data.expires_in || 3600 });
    } catch (error) { logger.error('Blackbaud token exchange error:', error); res.status(500).json({ success: false, error: error.message }); }
});

// ─── PRE-AUTH: Blackbaud token refresh ───────────────────────
app.post('/api/blackbaud/oauth/refresh', validateCanvasTokenCached, async (req, res) => {
    const userId = String(req.canvasUser.id);
    const stored = bbTokenStore.get(userId);
    if (!stored || !stored.encryptedRefresh) return res.status(401).json({ success: false, error: 'No Blackbaud session found.', needsReconnect: true });
    try {
        const refreshToken = decryptToken(stored.encryptedRefresh);
        const response = await fetch('https://oauth2.sky.blackbaud.com/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: process.env.BLACKBAUD_CLIENT_ID, client_secret: process.env.BLACKBAUD_CLIENT_SECRET })
        });
        if (!response.ok) { bbTokenStore.delete(userId); return res.status(response.status).json({ success: false, error: 'Blackbaud refresh failed.', needsReconnect: true }); }
        const data = await response.json();
        const expiresAt = Date.now() + ((data.expires_in || 3600) * 1000);
        bbTokenStore.set(userId, { encryptedAccess: encryptToken(data.access_token), encryptedRefresh: data.refresh_token ? encryptToken(data.refresh_token) : stored.encryptedRefresh, expiresAt });
        res.json({ success: true, expires_in: data.expires_in || 3600 });
    } catch (error) { logger.error('Blackbaud refresh error:', error); bbTokenStore.delete(userId); res.status(500).json({ success: false, error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// 🛡️ AUTHENTICATED ROUTES
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 🆕 AI CHAT — GEMINI FUNCTION CALLING (replaces old /api/ai/chat)
// ═══════════════════════════════════════════════════════════════
//
// FLOW:
// 1. Extension sends user message + canvas data + conversation history
// 2. Server sends to Gemini WITH tool declarations
// 3. Gemini returns EITHER:
//    a. Text response → return { type: "text", response: "..." }
//    b. Function call → return { type: "function_call", name: "...", args: {...} }
// 4. Extension executes the tool locally (or server executes web_search)
// 5. Extension calls /api/ai/chat/tool-result with the raw data
// 6. Gemini synthesizes a natural response → return to user
// ═══════════════════════════════════════════════════════════════

app.post('/api/ai/chat', validateCanvasTokenCached, async (req, res) => {
    try {
        const { message, canvasData, conversationHistory } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }

        // 🛡️ Content safety check
        const safety = isQuerySafe(message);
        if (!safety.safe) {
            return res.json({ 
                success: true, type: 'text', 
                response: "I can't help with that type of request. Please keep your questions appropriate for a school setting. 📚",
                blocked: true 
            });
        }

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ success: false, error: 'Gemini API key not configured' });
        }

        // ── Build system instruction WITH canvas data injected ──
        const systemInstruction = buildSystemInstruction(canvasData);

        // ── Build conversation contents ──
        const contents = buildValidatedContents(conversationHistory || [], message);

        // ── Log what we're sending (for debugging) ──
        logger.info('AI Chat Request', {
            user: req.canvasUser?.name,
            messagePreview: message.substring(0, 80),
            hasCourses: !!(canvasData?.courses?.length),
            courseCount: canvasData?.courses?.length || 0,
            assignmentCount: canvasData?.assignments?.length || 0,
            gradeCount: canvasData?.assignmentGrades?.length || 0,
            systemInstructionLength: systemInstruction.length
        });

        // ── Call Gemini with function calling ──
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

        const geminiBody = {
            system_instruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: contents,
            tools: GEMINI_TOOL_DECLARATIONS,
            safety_settings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
            ],
            generation_config: {
                temperature: 0.7,
                max_output_tokens: 2048,
                top_p: 0.9
            }
        };

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody)
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            logger.error('Gemini API error:', { status: geminiResponse.status, body: errText.substring(0, 500) });
            return res.status(502).json({ success: false, error: `Gemini API error: ${geminiResponse.status}` });
        }

        const geminiData = await geminiResponse.json();
        logger.info('GEMINI RAW RESPONSE:', JSON.stringify(geminiData).substring(0, 1000));


        // ── Check for blocked content ──
        if (geminiData.promptFeedback?.blockReason) {
            return res.json({
                success: true, type: 'text',
                response: "I can't respond to that request. Please keep your questions appropriate. 📚",
                blocked: true
            });
        }

        const candidate = geminiData.candidates?.[0];
        if (!candidate || !candidate.content?.parts?.length) {
            logger.warn('Gemini returned no candidates', { geminiData: JSON.stringify(geminiData).substring(0, 500) });
            return res.json({
                success: true, type: 'text',
                response: "I'm having trouble processing that request. Could you try rephrasing?"
            });
        }

        const parts = candidate.content.parts;

        // ── Check if Gemini wants to call a function ──
        const functionCallPart = parts.find(p => p.functionCall);

        if (functionCallPart) {
            const { name, args } = functionCallPart.functionCall;
            logger.info('Gemini requested function call', { name, args });

            // ── Handle web_search server-side ──
            if (name === 'web_search' && args?.query) {
                try {
                    const searchResult = await executeWebSearch(args.query);
                    
                    if (searchResult.blocked) {
                        return res.json({
                            success: true, type: 'text',
                            response: "I can't search for that. Please keep searches appropriate for school. 📚",
                            blocked: true
                        });
                    }

                    // Feed search results back to Gemini for synthesis
                    const synthesisContents = [
                        ...contents,
                        { role: 'model', parts: [{ functionCall: { name, args } }] },
                        { role: 'user', parts: [{ functionResponse: { name, response: { results: searchResult.results } } }] }
                    ];

                    const synthesisResponse = await fetch(geminiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            system_instruction: { parts: [{ text: systemInstruction }] },
                            contents: synthesisContents,
                            tools: GEMINI_TOOL_DECLARATIONS,
                            safety_settings: geminiBody.safety_settings,
                            generation_config: geminiBody.generation_config
                        })
                    });

                    if (synthesisResponse.ok) {
                        const synthesisData = await synthesisResponse.json();
                        const textPart = synthesisData.candidates?.[0]?.content?.parts?.find(p => p.text);
                        if (textPart) {
                            return res.json({ success: true, type: 'text', response: textPart.text });
                        }
                    }

                    // Fallback: format search results directly
                    const formatted = searchResult.results.map(r => `**${r.title}**\n${r.snippet}\n${r.link}`).join('\n\n');
                    return res.json({ success: true, type: 'text', response: `Here's what I found:\n\n${formatted}` });

                } catch (searchErr) {
                    logger.error('Web search failed:', searchErr);
                    return res.json({ success: true, type: 'text', response: "I couldn't complete that search. Please try again." });
                }
            }

            // ── For all other tools: return function_call to extension for local execution ──
            return res.json({
                success: true,
                type: 'function_call',
                functionCall: { name, args: args || {} },
                // Pass the full Gemini response content so tool-result can reconstruct the conversation
                _geminiResponseContent: candidate.content
            });
        }

        // ── Gemini returned a text response ──
        const textPart = parts.find(p => p.text);
        if (textPart) {
            return res.json({ success: true, type: 'text', response: textPart.text });
        }

        // Fallback
        return res.json({
            success: true, type: 'text',
            response: "I processed your request but couldn't generate a response. Please try again."
        });

    } catch (error) {
        logger.error('AI chat error:', error);
        res.status(500).json({ success: false, error: 'AI processing failed' });
    }
});

// ═══════════════════════════════════════════════════════════════
// 🆕 AI CHAT TOOL RESULT — Gemini synthesizes tool output
// ═══════════════════════════════════════════════════════════════
//
// After the extension executes a local tool (get_assignments, etc.),
// it sends the raw result here. The server feeds it back to Gemini
// as a functionResponse, and Gemini generates a natural-language answer.
// ═══════════════════════════════════════════════════════════════

app.post('/api/ai/chat/tool-result', validateCanvasTokenCached, async (req, res) => {
    try {
        const { functionName, functionArgs, toolResult, conversationHistory, canvasData, geminiResponseContent } = req.body;

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ success: false, error: 'Gemini API key not configured' });
        }

        // ── Rebuild system instruction WITH canvas data ──
        const systemInstruction = buildSystemInstruction(canvasData);

        // ── Build contents with function call + response ──
        const contents = buildValidatedContents(conversationHistory || [], '');
        
        // Remove the empty user message we just added (we'll reconstruct properly)
        if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
            contents.pop();
        }

        // Add the model's function call
        if (geminiResponseContent) {
            contents.push({ role: 'model', parts: geminiResponseContent.parts });
        } else {
            contents.push({ 
                role: 'model', 
                parts: [{ functionCall: { name: functionName, args: functionArgs || {} } }] 
            });
        }

        // Add the function response
        contents.push({
            role: 'user',
            parts: [{
                functionResponse: {
                    name: functionName,
                    response: typeof toolResult === 'string' ? { result: toolResult } : toolResult
                }
            }]
        });

        // Ensure valid structure
        while (contents.length > 0 && contents[0].role === 'model') {
            contents.shift();
        }

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: contents,
                tools: GEMINI_TOOL_DECLARATIONS,
                safety_settings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                ],
                generation_config: { temperature: 0.7, max_output_tokens: 2048, top_p: 0.9 }
            })
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            logger.error('Gemini tool-result error:', { status: geminiResponse.status, body: errText.substring(0, 500) });
            return res.status(502).json({ success: false, error: `Gemini synthesis error: ${geminiResponse.status}` });
        }

        const geminiData = await geminiResponse.json();
        const candidate = geminiData.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        // Check if Gemini wants ANOTHER function call (chaining)
        const chainedCall = parts.find(p => p.functionCall);
        if (chainedCall) {
            const { name, args } = chainedCall.functionCall;

            // Handle web_search server-side
            if (name === 'web_search' && args?.query) {
                try {
                    const searchResult = await executeWebSearch(args.query);
                    if (searchResult.blocked) {
                        return res.json({ success: true, type: 'text', response: "I can't search for that. 📚" });
                    }
                    // One more round with Gemini
                    const finalContents = [
                        ...contents,
                        { role: 'model', parts: [{ functionCall: { name, args } }] },
                        { role: 'user', parts: [{ functionResponse: { name, response: { results: searchResult.results } } }] }
                    ];
                    const finalResp = await fetch(geminiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            system_instruction: { parts: [{ text: systemInstruction }] },
                            contents: finalContents,
                            tools: GEMINI_TOOL_DECLARATIONS,
                            generation_config: { temperature: 0.7, max_output_tokens: 2048 }
                        })
                    });
                    if (finalResp.ok) {
                        const finalData = await finalResp.json();
                        const textPart = finalData.candidates?.[0]?.content?.parts?.find(p => p.text);
                        if (textPart) {
                            return res.json({ success: true, type: 'text', response: textPart.text });
                        }
                    }
                } catch (e) {
                    logger.error('Chained web search failed:', e);
                }
            }

            // Return chained function call to extension
            return res.json({
                success: true,
                type: 'function_call',
                functionCall: { name, args: args || {} },
                _geminiResponseContent: candidate.content
            });
        }

        // Text response
        const textPart = parts.find(p => p.text);
        if (textPart) {
            return res.json({ success: true, type: 'text', response: textPart.text });
        }

        return res.json({ success: true, type: 'text', response: "I found some data but had trouble formatting the response. Please try again." });

    } catch (error) {
        logger.error('AI tool-result error:', error);
        res.status(500).json({ success: false, error: 'AI synthesis failed' });
    }
});

// ─── Web Search (standalone endpoint — kept for backward compat) ───
app.post('/api/search', validateCanvasTokenCached, async (req, res) => {
    try {
        const { query, location } = req.body;
        if (!query) return res.status(400).json({ success: false, error: 'Query is required' });

        const safety = isQuerySafe(query);
        if (!safety.safe) {
            logger.warn('Blocked search query', { query: query.substring(0, 50), reason: safety.reason, userId: req.canvasUser?.id });
            return res.status(400).json({ success: false, error: 'This search query is not allowed.', blocked: true, reason: safety.reason });
        }

        const searchResult = await executeWebSearch(query, location);
        if (searchResult.blocked) {
            return res.status(400).json({ success: false, error: 'This search query is not allowed.', blocked: true, reason: searchResult.reason });
        }

        res.json({ success: true, results: searchResult.results, source: 'serper' });
    } catch (error) {
        logger.error('Search proxy error:', error);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// ─── Canvas Data Sync ────────────────────────────────────────
app.post('/api/sync', validateCanvasTokenCached, async (req, res) => {
    try {
        const { canvasData } = req.body;
        if (!canvasData) return res.status(400).json({ success: false, error: 'Canvas data is required' });
        const userSessionId = `user_${req.canvasUser.id}`;
        dataStore.set(userSessionId, { canvasData, lastUpdated: new Date().toISOString(), userId: req.canvasUser.id });
        logger.info('Canvas data synced', { userId: req.canvasUser.id, dataSize: JSON.stringify(canvasData).length });
        res.json({ success: true, sessionId: userSessionId, message: 'Data synced successfully', timestamp: new Date().toISOString() });
    } catch (error) { logger.error('Sync error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ─── Blackbaud API Proxy ─────────────────────────────────────
app.post('/api/blackbaud/proxy', validateCanvasTokenCached, async (req, res) => {
    try {
        const { endpoint, method, body } = req.body;
        if (!endpoint) return res.status(400).json({ success: false, error: 'Missing endpoint' });

        const allowedPrefixes = ['/school/v1/', '/constituent/v1/', '/nxt/data/v1/'];
        if (!allowedPrefixes.some(prefix => endpoint.startsWith(prefix))) {
            return res.status(403).json({ success: false, error: 'Endpoint not allowed' });
        }

        const BLACKBAUD_SUBSCRIPTION_KEY = process.env.BLACKBAUD_SUBSCRIPTION_KEY;
        if (!BLACKBAUD_SUBSCRIPTION_KEY) return res.status(500).json({ success: false, error: 'Blackbaud not configured' });

        const userId = String(req.canvasUser.id);
        let stored = bbTokenStore.get(userId);
        if (!stored) return res.status(401).json({ success: false, error: 'No Blackbaud session.', needsReconnect: true });

        // Auto-refresh if expired
        if (Date.now() > stored.expiresAt - 60000) {
            if (!stored.encryptedRefresh) { bbTokenStore.delete(userId); return res.status(401).json({ success: false, error: 'Blackbaud session expired.', needsReconnect: true }); }
            try {
                const refreshToken = decryptToken(stored.encryptedRefresh);
                const refreshResponse = await fetch('https://oauth2.sky.blackbaud.com/token', {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: process.env.BLACKBAUD_CLIENT_ID, client_secret: process.env.BLACKBAUD_CLIENT_SECRET })
                });
                if (!refreshResponse.ok) { bbTokenStore.delete(userId); return res.status(401).json({ success: false, error: 'Blackbaud refresh failed.', needsReconnect: true }); }
                const refreshData = await refreshResponse.json();
                stored = { encryptedAccess: encryptToken(refreshData.access_token), encryptedRefresh: refreshData.refresh_token ? encryptToken(refreshData.refresh_token) : stored.encryptedRefresh, expiresAt: Date.now() + ((refreshData.expires_in || 3600) * 1000) };
                bbTokenStore.set(userId, stored);
            } catch (refreshErr) { bbTokenStore.delete(userId); return res.status(401).json({ success: false, error: 'Blackbaud session expired.', needsReconnect: true }); }
        }

        const accessToken = decryptToken(stored.encryptedAccess);
        const fetchOptions = { method: method || 'GET', headers: { 'Authorization': `Bearer ${accessToken}`, 'Bb-Api-Subscription-Key': BLACKBAUD_SUBSCRIPTION_KEY, 'Content-Type': 'application/json' } };
        if (body && method !== 'GET') fetchOptions.body = JSON.stringify(body);

        const bbResponse = await fetch(`https://api.sky.blackbaud.com${endpoint}`, fetchOptions);
        if (!bbResponse.ok) { const errText = await bbResponse.text(); return res.status(bbResponse.status).json({ success: false, error: errText }); }
        const data = await bbResponse.json();
        res.json({ success: true, data });
    } catch (error) { logger.error('Blackbaud proxy error:', error); res.status(500).json({ success: false, error: 'Blackbaud proxy request failed' }); }
});

// ─── Get stored data ─────────────────────────────────────────
app.get('/api/data/:sessionId', validateCanvasTokenCached, (req, res) => {
    try {
        const data = dataStore.get(req.params.sessionId);
        if (!data) return res.status(404).json({ success: false, error: 'Data not found' });
        if (data.userId && String(data.userId) !== String(req.canvasUser.id)) return res.status(403).json({ success: false, error: 'Access denied' });
        res.json({ success: true, data: data.canvasData, lastUpdated: data.lastUpdated });
    } catch (error) { logger.error('Data retrieval error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ─── Analytics ───────────────────────────────────────────────
app.get('/api/analytics/:sessionId', validateCanvasTokenCached, (req, res) => {
    try {
        const data = dataStore.get(req.params.sessionId);
        if (!data || !data.canvasData) return res.status(404).json({ success: false, error: 'No data available for analytics' });
        if (data.userId && String(data.userId) !== String(req.canvasUser.id)) return res.status(403).json({ success: false, error: 'Access denied' });
        res.json({ success: true, analytics: generateAnalytics(data.canvasData) });
    } catch (error) { logger.error('Analytics error:', error); res.status(500).json({ success: false, error: 'Analytics generation failed' }); }
});

// ─── Settings ────────────────────────────────────────────────
app.post('/api/settings', validateCanvasTokenCached, (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings) return res.status(400).json({ success: false, error: 'Settings are required' });
        sessionStore.set(`user_${req.canvasUser.id}`, { settings, updatedAt: new Date().toISOString() });
        res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error) { logger.error('Settings error:', error); res.status(500).json({ success: false, error: 'Settings save failed' }); }
});

app.get('/api/settings', validateCanvasTokenCached, (req, res) => {
    try {
        const session = sessionStore.get(`user_${req.canvasUser.id}`);
        res.json({ success: true, settings: session?.settings || {} });
    } catch (error) { logger.error('Settings retrieval error:', error); res.status(500).json({ success: false, error: 'Settings retrieval failed' }); }
});

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function generateAnalytics(canvasData) {
    const analytics = { summary: {}, courses: [], assignments: {}, grades: {}, recommendations: [] };
    analytics.summary = {
        totalCourses: canvasData.courses ? canvasData.courses.length : 0,
        totalAssignments: canvasData.assignments ? canvasData.assignments.length : 0,
        completedAssignments: canvasData.assignments ? canvasData.assignments.filter(a => a.status === 'submitted').length : 0,
        upcomingAssignments: canvasData.assignments ? canvasData.assignments.filter(a => a.dueDate && new Date(a.dueDate) > new Date()).length : 0
    };
    if (canvasData.courses) {
        analytics.courses = canvasData.courses.map(course => ({
            name: course.name, code: course.code, isFavorite: course.isFavorite,
            assignments: canvasData.assignments ? canvasData.assignments.filter(a => a.courseId === course.id).length : 0
        }));
    }
    if (canvasData.assignments) {
        const now = new Date();
        analytics.assignments = {
            upcoming: canvasData.assignments.filter(a => a.dueDate && new Date(a.dueDate) > now).length,
            overdue: canvasData.assignments.filter(a => a.dueDate && new Date(a.dueDate) < now && a.status !== 'submitted').length,
            completed: canvasData.assignments.filter(a => a.status === 'submitted').length,
            pending: canvasData.assignments.filter(a => a.status === 'pending').length
        };
    }
    if (analytics.assignments.overdue > 0) analytics.recommendations.push({ type: 'urgent', title: 'Overdue Assignments', message: `You have ${analytics.assignments.overdue} overdue assignment(s).` });
    if (analytics.assignments.upcoming > 5) analytics.recommendations.push({ type: 'planning', title: 'Heavy Workload', message: 'You have many upcoming assignments. Consider a study schedule.' });
    return analytics;
}

// ═══════════════════════════════════════════════════════════════
// SCHEDULED TASKS
// ═══════════════════════════════════════════════════════════════

cron.schedule('0 0 * * *', () => {
    logger.info('Running data cleanup task');
    const now = new Date();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    let cleanedCount = 0;
    for (const [key, data] of dataStore.entries()) { if (now - new Date(data.lastUpdated) > maxAge) { dataStore.delete(key); cleanedCount++; } }
    for (const [key, val] of tokenCache) { if (Date.now() > val.expiresAt) tokenCache.delete(key); }
    const BB_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
    let bbCleaned = 0;
    for (const [userId, stored] of bbTokenStore) { if (Date.now() > stored.expiresAt + BB_MAX_AGE) { bbTokenStore.delete(userId); bbCleaned++; } }
    const CANVAS_REFRESH_MAX_AGE = 90 * 24 * 60 * 60 * 1000;
    let canvasRefreshCleaned = 0;
    for (const [userId, stored] of canvasRefreshStore) { if (Date.now() - stored.storedAt > CANVAS_REFRESH_MAX_AGE) { canvasRefreshStore.delete(userId); canvasRefreshCleaned++; } }
    logger.info(`Cleanup: removed ${cleanedCount} data, ${bbCleaned} BB tokens, ${canvasRefreshCleaned} Canvas refresh entries`);
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

app.use((error, req, res, next) => { logger.error('Unhandled error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); });
app.use((req, res) => { res.status(404).json({ success: false, error: 'Endpoint not found' }); });

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
    logger.info(`Canvas AI Assistant Backend started on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`CORS enabled for: ${process.env.ALLOWED_ORIGINS || 'chrome-extension://*'}`);
});

process.on('SIGTERM', () => { logger.info('Received SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { logger.info('Received SIGINT'); process.exit(0); });

module.exports = app;