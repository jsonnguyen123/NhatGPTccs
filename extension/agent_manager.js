class CanvasAgentManager {
    constructor(config = {}) {
        this.config = this.initializeConfig(config);
        this.toolManager = this.initializeToolManager();
        this.intents = this.initializeIntents();
        console.log('✅ Agent Manager initialized (local fallback + tool executor)');
    }

    initializeConfig(userConfig) {
        let baseConfig = (typeof AGENT_CONFIG !== 'undefined') ? AGENT_CONFIG : 
                         (window.AGENT_CONFIG || this.createFallbackConfig());
        return { ...baseConfig, ...userConfig };
    }

    createFallbackConfig() {
        return {
            agentBehavior: { useEmojis: true },
            toolPrompts: {},
            errorMessages: { noToolMatch: "I'm not sure how to help with that yet." }
        };
    }

    initializeToolManager() {
        if (typeof ToolManager !== 'undefined') {
            return new ToolManager(this.config.toolPrompts);
        } else if (window.ToolManager) {
            return new window.ToolManager(this.config.toolPrompts);
        } else {
            console.error("❌ ToolManager class not found!");
            return {
                executeTool: () => Promise.resolve("System Error: ToolManager missing.")
            };
        }
    }

    // 🧠 THE BRAIN: Intent definitions (kept for fallback keyword matching)
    initializeIntents() {
        return [
            {
                id: 'gmailEmail',
                keywords: ['email', 'emails', 'gmail', 'inbox', 'mail', 'school email', 'school emails', 'check email', 'read email', 'my email', 'my emails', 'new emails', 'unread'],
                priority: 5
            },
            {
                id:  'diningMenu', 
                keywords: ['menu', 'food', 'lunch', 'dinner', 'breakfast', 'dining', 'cafeteria', 'eat', 'meal', 'hungry', 'snack', 'dining hall'],
                priority: 4
            },
            {
                id: 'assignmentDetail',
                keywords: ['assignment detail', 'assignment details', 'tell me about', 'rubric', 'instructions', 'submission type'],
                priority: 4
            },
            {
                id: 'announcementReader', 
                keywords: ['news', 'announcement','announcements', 'update', 'bulletin', 'posted'],
                priority: 3
            },
            {
                id: 'gradeAnalyzer',  
                keywords: ['grade', 'grades', 'score', 'scores', 'gpa', 'average', 'missing', 'late', 'submitted', 'graded', 'percent', 'percentage', 'failing', 'passed'],
                priority: 3
            },
            {
                id: 'courseLister',
                keywords: ['courses', 'course', 'enrolled', 'enrollment', 'classes', 'class', 'taking', 'my classes', 'my courses'],
                priority: 3
            },
            {
                id: 'globalPlanner',
                keywords: ['calendar', 'schedule', 'plan', 'study', 'week', 'today', 'tomorrow', 'upcoming', 'events', 'todo'],
                priority: 2
            },
            {
                id: 'courseNavigator',
                keywords: ['syllabus', 'rule', 'policy', 'grade', 'score', 'percent', 'assignment', 'homework', 'hw', 'quiz'],
                priority: 1
            },
            {
                id: 'syllabusReader',
                keywords: [
                    'syllabus', 'about', 'what is', 'course about', 'class about',
                    'policy', 'policies', 'grading policy', 'late policy',
                    'textbook', 'materials', 'books', 'supplies',
                    'objectives', 'goals', 'learn in', 'cover in',
                    'office hours', 'contact'
                ],
                priority: 2
            }
        ];
    }

    async processQuery(userMessage, canvasData, useLocalFallback = false) {
        // If not explicitly using local fallback, skip — server handles routing now
        if (!useLocalFallback) {
            console.log('🧠 Agent Manager: Server-first mode — skipping local processing');
            return null;
        }

        console.log('🧠 Agent Manager: Running LOCAL FALLBACK processing');

        // 1. Analyze Intent
        const intent = this.detectIntent(userMessage, canvasData);
        console.log(`🤖 Agent Routing (fallback): "${userMessage}" ➡️ [${intent}]`);
    
        // 🚨 AUTO-REFRESH: Route data fetches through background
        await this.autoRefreshData(intent, canvasData);
    
        // 2. Extract Context (Dates, meal types, etc.)
        const context = this.extractContext(userMessage);
        
        // 3. Execute Tool
        try {
            const result = await this.toolManager.executeTool(intent, userMessage, canvasData, context);
            return this.formatResponse(result);
        } catch (error) {
            console.error('Agent execution failed:', error);
            return "I ran into an issue processing that request. Please try again.";
        }
    }

    /**
     * 🆕 Execute a tool by its Gemini function call name.
     * Called by background.js when Gemini returns a function_call.
     * Maps Gemini tool names → internal tool IDs → ToolManager.
     * 
     * @param {string} functionName - Gemini function name (e.g., 'get_grades')
     * @param {object} args - Arguments extracted by Gemini
     * @param {object} canvasData - Current canvas data
     * @returns {object|string} Raw tool result (NOT synthesized — server does that)
     */
    async executeToolByName(functionName, args, canvasData) {
        // Map Gemini function names → internal tool intent IDs
        const TOOL_NAME_MAP = {
            'get_assignments':      'globalPlanner',
            'get_grades':           'gradeAnalyzer',
            'get_dining_menu':      'diningMenu',
            'get_announcements':    'announcementReader',
            'get_course_list':      'courseLister',
            'get_syllabus':         'syllabusReader',
            'get_assignment_detail': 'assignmentDetail',
            'get_emails':           'gmailEmail',
            // web_search is handled server-side, not here
        };

        const intentId = TOOL_NAME_MAP[functionName];
        if (!intentId) {
            console.warn(`🧠 Agent Manager: Unknown function name "${functionName}"`);
            return { error: true, message: `Unknown tool: ${functionName}` };
        }

        console.log(`🧠 Agent Manager: Executing tool ${functionName} → ${intentId}`, args);

        // Auto-refresh relevant data before executing
        await this.autoRefreshData(intentId, canvasData);

        // Build context from Gemini's extracted args
        const context = this.buildContextFromArgs(functionName, args);

        // Build a synthetic user message from args for tools that need it
        const syntheticMessage = this.buildSyntheticMessage(functionName, args);

        try {
            const result = await this.toolManager.executeTool(
                intentId,
                syntheticMessage,
                canvasData,
                context
            );
            return result;
        } catch (error) {
            console.error(`🧠 Agent Manager: Tool execution failed for ${functionName}:`, error);
            return { error: true, message: `Failed to execute ${functionName}: ${error.message}` };
        }
    }

    /**
     * Convert Gemini function args into the context format that tools expect.
     */
    buildContextFromArgs(functionName, args) {
        const context = {};

        switch (functionName) {
            case 'get_dining_menu':
                if (args.meal_type) context.mealType = args.meal_type;
                if (args.date) context.date = this.resolveDate(args.date);
                break;

            case 'get_assignments':
                if (args.course_name) context.courseName = args.course_name;
                if (args.time_range) context.timeRange = args.time_range;
                break;

            case 'get_grades':
                if (args.course_name) context.courseName = args.course_name;
                if (args.filter) context.filter = args.filter;
                break;

            case 'get_announcements':
                if (args.course_name) context.courseName = args.course_name;
                if (args.time_range) context.timeRange = args.time_range;
                break;

            case 'get_syllabus':
                if (args.course_name) context.courseName = args.course_name;
                if (args.section) context.section = args.section;
                break;

            case 'get_assignment_detail':
                if (args.assignment_name) context.assignmentName = args.assignment_name;
                if (args.course_id) context.courseId = args.course_id;
                if (args.assignment_id) context.assignmentId = args.assignment_id;
                break;

            case 'get_emails':
                if (args.sender_filter) context.senderFilter = args.sender_filter;
                if (args.subject_filter) context.subjectFilter = args.subject_filter;
                break;

            default:
                break;
        }

        return context;
    }

    /**
     * Build a synthetic user message from Gemini args so tools
     * that parse the message text still work correctly.
     */
    buildSyntheticMessage(functionName, args) {
        switch (functionName) {
            case 'get_assignments':
                return `show ${args.time_range || 'upcoming'} assignments${args.course_name ? ` for ${args.course_name}` : ''}`;

            case 'get_grades':
                return `show ${args.filter || 'all'} grades${args.course_name ? ` for ${args.course_name}` : ''}`;

            case 'get_dining_menu':
                return `what's for ${args.meal_type || 'lunch'}${args.date ? ` on ${args.date}` : ''}`;

            case 'get_announcements':
                return `show ${args.time_range || 'recent'} announcements${args.course_name ? ` for ${args.course_name}` : ''}`;

            case 'get_course_list':
                return 'list my courses';

            case 'get_syllabus':
                return `show ${args.section || 'all'} syllabus for ${args.course_name || 'course'}`;

            case 'get_assignment_detail':
                if (args.course_id && args.assignment_id) {
                    return `show assignment details courses/${args.course_id}/assignments/${args.assignment_id}`;
                }
                return `show details for assignment ${args.assignment_name || ''}`;

            case 'get_emails':
                return `check my emails${args.sender_filter ? ` from ${args.sender_filter}` : ''}${args.subject_filter ? ` about ${args.subject_filter}` : ''}`;

            default:
                return JSON.stringify(args);
        }
    }

    /**
     * Resolve date strings like 'today', 'tomorrow' to ISO format.
     */
    resolveDate(dateStr) {
        if (!dateStr) return null;
        const lower = dateStr.toLowerCase();
        if (lower === 'today') return this.parseDateToISO('today');
        if (lower === 'tomorrow') return this.parseDateToISO('tomorrow');
        // Already ISO format or parseable
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
        return this.parseDateToISO(lower) || dateStr;
    }


    /**
     * Centralized auto-refresh logic — keeps processQuery clean
     */
    async autoRefreshData(intent, canvasData) {
        switch (intent) {
            case 'gmailEmail':
                await this.prefetchGmailEmails();
                break;

            case 'announcementReader':
                await this.refreshAnnouncements(canvasData);
                break;

            case 'gradeAnalyzer':
                await this.refreshGrades(canvasData);
                break;

            case 'syllabusReader':
                await this.refreshSyllabi(canvasData);
                break;

            case 'courseLister':
                await this.refreshCourses(canvasData);
                break;

            case 'assignmentDetail':
                await this.refreshCourses(canvasData);
                await this.refreshGrades(canvasData);
                break;

            default:
                break;
        }
    }

    // ─── DATA REFRESH HELPERS ────────────────────────────────────────

    async prefetchGmailEmails() {
        try {
            console.log("📧 Pre-warming Gmail cache...");
            await this.sendBackgroundMessage({ type: 'GMAIL_FETCH_EMAILS' });
        } catch (e) {
            console.warn("📧 Gmail pre-fetch failed (non-critical):", e.message);
        }
    }

    async refreshAnnouncements(canvasData) {
        console.log("🔄 Triggering live announcement fetch via background...");
        try {
            const response = await this.fetchAnnouncementsViaBackground(canvasData);
            if (response && response.length > 0) {
                canvasData.announcements = response;
                console.log(`📢 Received ${response.length} announcements from background`);
            }
        } catch (e) {
            console.warn("⚠️ Background announcement fetch failed, using cached:", e.message);
        }
    }

    async refreshGrades(canvasData) {
        if (!canvasData.assignmentGrades || canvasData.assignmentGrades.length === 0) {
            console.log("🔄 Triggering assignment grades fetch via background...");
            try {
                const response = await this.fetchGradesViaBackground();
                if (response) {
                    canvasData.assignmentGrades = response;
                }
            } catch (e) {
                console.warn("⚠️ Background grades fetch failed, using cached:", e.message);
            }
        }
    }

    async refreshSyllabi(canvasData) {
        if (!canvasData.courseSyllabi || Object.keys(canvasData.courseSyllabi).length === 0) {
            console.log("🔄 Triggering syllabus fetch via background...");
            try {
                const response = await this.fetchSyllabiViaBackground(canvasData);
                if (response) {
                    canvasData.courseSyllabi = response;
                }
            } catch (e) {
                console.warn("⚠️ Background syllabus fetch failed, using cached:", e.message);
            }
        }
    }

    async refreshCourses(canvasData) {
        console.log("🔄 Triggering live course fetch via background...");
        try {
            const response = await this.fetchCoursesViaBackground();
            if (response && response.length > 0) {
                canvasData.courses = response;
                console.log(`📚 Received ${response.length} courses from background`);
            }
        } catch (e) {
            console.warn("⚠️ Background course fetch failed, using cached:", e.message);
        }
    }

    // ─── BACKGROUND MESSAGE HELPERS ──────────────────────────────────

    sendBackgroundMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                if (response?.success) {
                    resolve(response.data || response);
                } else {
                    reject(new Error(response?.error || 'Background message failed'));
                }
            });
        });
    }

    fetchAnnouncementsViaBackground(canvasData) {
        return new Promise((resolve, reject) => {
            const courseIds = (canvasData?.courses || []).slice(0, 10).map(c => c.id);
            chrome.runtime.sendMessage(
                { type: 'FETCH_ANNOUNCEMENTS', courseIds },
                (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(new Error(chrome.runtime.lastError.message));
                    }
                    if (response?.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error(response?.error || 'Failed to fetch announcements'));
                    }
                }
            );
        });
    }

    fetchGradesViaBackground() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: 'FETCH_GRADES' },
                (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(new Error(chrome.runtime.lastError.message));
                    }
                    if (response?.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error(response?.error || 'Failed to fetch grades'));
                    }
                }
            );
        });
    }

    fetchSyllabiViaBackground(canvasData) {
        return new Promise((resolve, reject) => {
            const courseIds = (canvasData?.courses || []).slice(0, 10).map(c => c.id);
            chrome.runtime.sendMessage(
                { type: 'FETCH_SYLLABI', courseIds },
                (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(new Error(chrome.runtime.lastError.message));
                    }
                    if (response?.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error(response?.error || 'Failed to fetch syllabi'));
                    }
                }
            );
        });
    }

    fetchCoursesViaBackground() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: 'FETCH_COURSES' },
                (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(new Error(chrome.runtime.lastError.message));
                    }
                    if (response?.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error(response?.error || 'Failed to fetch courses'));
                    }
                }
            );
        });
    }
    
    extractContext(message) {
        const text = (message || '').toLowerCase();

        const mealType =
            text.includes('breakfast') ? 'breakfast' :
            text.includes('lunch') ? 'lunch' :
            (text.includes('dinner') || text.includes('supper')) ? 'dinner' :
            null;

        const date = this.parseDateToISO(text);

        const emailId = this.extractEmailId(text);

        const assignmentContext = this.extractAssignmentContext(message);

        return { 
            mealType, 
            date, 
            emailId,
            ...assignmentContext
        };
    }

    extractAssignmentContext(message) {
        if (!message) return {};
        const urlPattern = /courses\/(\d+)\/assignments\/(\d+)/i;
        const match = message.match(urlPattern);
        if (match) {
            return { courseId: match[1], assignmentId: match[2] };
        }
        return {};
    }

    extractEmailId(text) {
        return null;
    }

    parseDateToISO(text) {
        const now = new Date();

        const toISO = (d) => {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };

        if (/\btoday\b/.test(text)) return toISO(now);
        if (/\btomorrow\b/.test(text)) {
            const d = new Date(now);
            d.setDate(d.getDate() + 1);
            return toISO(d);
        }

        const nextDowMatch = text.match(/\bnext\s+(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\b/);
        if (nextDowMatch) {
            const map = {
                sun: 0, sunday: 0,
                mon: 1, monday: 1,
                tue: 2, tues: 2, tuesday: 2,
                wed: 3, wednesday: 3,
                thu: 4, thur: 4, thurs: 4, thursday: 4,
                fri: 5, friday: 5,
                sat: 6, saturday: 6
            };
            const key = nextDowMatch[1];
            const target = map[key];
            if (target !== undefined) {
                const d = new Date(now);
                const current = d.getDay();
                let delta = (target - current + 7) % 7;
                if (delta === 0) delta = 7;
                d.setDate(d.getDate() + delta);
                return toISO(d);
            }
        }

        const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
        if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

        const mdMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (mdMatch) {
            const m = Number(mdMatch[1]);
            const d = Number(mdMatch[2]);
            let y = mdMatch[3] ? Number(mdMatch[3]) : now.getFullYear();
            if (y < 100) y += 2000;
            const dt = new Date(y, m - 1, d);
            if (!isNaN(dt.getTime())) return toISO(dt);
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🧠 NEW: WEIGHTED MULTI-SIGNAL INTENT DETECTION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Detects what the user WANTS (action) separately from what ENTITY
     * they're asking about (course, email, food, etc.)
     * 
     * This replaces the old first-match keyword approach with scoring.
     */
    detectIntent(message, canvasData) {
        const lowerMsg = message.toLowerCase().trim();

        // ──────────────────────────────────────────────────────────────
        // PHASE 0: HARD OVERRIDES (unambiguous patterns)
        // These are so specific that no scoring is needed.
        // ──────────────────────────────────────────────────────────────

        // Assignment URL pasted
        if (/courses\/\d+\/assignments\/\d+/i.test(message)) {
            console.log("📝 Assignment URL Detected -> AssignmentDetail");
            return 'assignmentDetail';
        }

        // Explicit email requests
        const emailHardPatterns = [
            /\bemail/i, /\bemails\b/i, /\bgmail\b/i, /\binbox\b/i,
            /check\s+(my\s+)?email/i, /read\s+(my\s+)?email/i,
            /show\s+(my\s+)?email/i, /any\s+(new\s+)?emails?/i,
            /school\s+emails?/i, /what('s|\s+is)\s+in\s+my\s+(inbox|email|mail)/i,
            /email\s+from/i, /emails?\s+about/i
        ];
        if (emailHardPatterns.some(p => p.test(lowerMsg))) {
            console.log("📧 Email detected -> GmailEmail");
            return 'gmailEmail';
        }

        // Explicit dining requests
        if (/\b(menu|food|dining|cafeteria|hungry)\b/i.test(lowerMsg) ||
            /what('s|\s+is)\s+(for\s+)?(lunch|dinner|breakfast)/i.test(lowerMsg)) {
            console.log("🍽️ Dining detected -> DiningMenu");
            return 'diningMenu';
        }

        // ──────────────────────────────────────────────────────────────
        // PHASE 1: DETECT THE ACTION (what does the user want to DO?)
        // ──────────────────────────────────────────────────────────────

        const actionSignals = this.detectActionSignals(lowerMsg);
        console.log('🧠 Action signals:', JSON.stringify(actionSignals));

        // ──────────────────────────────────────────────────────────────
        // PHASE 2: DETECT THE ENTITY (what are they asking ABOUT?)
        // ──────────────────────────────────────────────────────────────

        const entitySignals = this.detectEntitySignals(lowerMsg, canvasData);
        console.log('🧠 Entity signals:', JSON.stringify(entitySignals));

        // ──────────────────────────────────────────────────────────────
        // PHASE 3: COMBINE into tool scores
        // ──────────────────────────────────────────────────────────────

        const scores = this.computeToolScores(actionSignals, entitySignals, lowerMsg, canvasData);

        // Log all scores for debugging
        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        console.log('🧠 Tool scores:', sorted.map(([t, s]) => `${t}=${s}`).join(', '));

        // Pick the winner
        const [bestTool, bestScore] = sorted[0];

        if (bestScore <= 0) {
            console.log('🧠 No confident match -> globalPlanner (default)');
            return 'globalPlanner';
        }

        console.log(`🧠 Winner: ${bestTool} (score=${bestScore})`);
        return bestTool;
    }

    /**
     * Detect ACTION signals — what the user wants to DO.
     * Returns an object with action categories and their confidence scores.
     */
    detectActionSignals(msg) {
        const signals = {
            wantsAssignments: 0,   // hw, assignments, due, submit
            wantsGrades: 0,        // grade, score, average, gpa
            wantsSyllabus: 0,      // syllabus, policy, about the course
            wantsAnnouncements: 0, // news, updates, posted
            wantsSchedule: 0,      // calendar, schedule, upcoming, this week
            wantsCourseList: 0,    // what courses, enrolled, my classes
            wantsAssignmentDetail: 0 // rubric, instructions, how to submit
        };

        // ─── Assignment signals ───
        if (/\b(hw|homework|assignment|assignments)\b/.test(msg)) signals.wantsAssignments += 3;
        if (/\b(due|deadline|submit|turn\s*in|hand\s*in)\b/.test(msg)) signals.wantsAssignments += 2;
        if (/what('s|\s+is)\s+due\b/.test(msg)) signals.wantsAssignments += 4;
        if (/\b(overdue|missing|late)\b/.test(msg) && !/grade/i.test(msg)) signals.wantsAssignments += 2;
        if (/do\s+i\s+have\s+(any\s+)?(hw|homework|assignments?)/i.test(msg)) signals.wantsAssignments += 4;

        // ─── Grade signals ───
        if (/\b(grade|grades|score|scores|gpa|average|percent|percentage)\b/.test(msg)) signals.wantsGrades += 3;
        if (/\b(failing|passed|how\s+am\s+i\s+doing)\b/.test(msg)) signals.wantsGrades += 3;
        if (/how\s+did\s+i\s+do\b/.test(msg)) signals.wantsGrades += 3;
        if (/what\s+did\s+i\s+get\b/.test(msg)) signals.wantsGrades += 3;
        if (/\b(my\s+grade|my\s+grades|grade\s+in|grades\s+in)\b/.test(msg)) signals.wantsGrades += 4;
        if (/\b(lowest|highest|best|worst)\s+grade/.test(msg)) signals.wantsGrades += 3;
        if (/\b(recent\s+grades|latest\s+grades)\b/.test(msg)) signals.wantsGrades += 3;
        // "missing" + "grade" context = grade, not assignment
        if (/\bmissing\b/.test(msg) && /\b(grade|assignment|submission)\b/.test(msg)) signals.wantsGrades += 2;

        // ─── Syllabus signals ───
        if (/\bsyllabus\b/.test(msg)) signals.wantsSyllabus += 5;
        if (/\b(policy|policies)\b/.test(msg)) signals.wantsSyllabus += 4;
        if (/\b(textbook|materials?|books?|supplies)\b/.test(msg)) signals.wantsSyllabus += 4;
        if (/\b(objectives?|goals?|learn\s+in|cover\s+in)\b/.test(msg)) signals.wantsSyllabus += 3;
        if (/\b(office\s+hours?|contact)\b/.test(msg)) signals.wantsSyllabus += 3;
        if (/what\s+is\s+\w+\s+(about|class|course)/i.test(msg)) signals.wantsSyllabus += 3;
        if (/tell\s+me\s+about\s+\w+\s+(class|course)/i.test(msg)) signals.wantsSyllabus += 3;
        // IMPORTANT: "what is [course]" WITHOUT action words = syllabus
        // But "what is the [course] hw" = assignment (handled by assignment signals above)

        // ─── Announcement signals ───
        if (/\b(announcement|announcements|bulletin|notice|notification)\b/.test(msg)) signals.wantsAnnouncements += 4;
        if (/\b(news|updates?|posted)\b/.test(msg)) signals.wantsAnnouncements += 2;
        if (/what('s|\s+is|\s+has)\s+(been\s+)?posted/i.test(msg)) signals.wantsAnnouncements += 3;
        if (/any\s+(new\s+)?announcements?/i.test(msg)) signals.wantsAnnouncements += 4;

        // ─── Schedule signals ───
        if (/\b(calendar|schedule|planner)\b/.test(msg)) signals.wantsSchedule += 3;
        if (/\b(this\s+week|next\s+week|today|tomorrow|upcoming)\b/.test(msg)) signals.wantsSchedule += 2;
        if (/what\s+is\s+due\s+(this|next|today|tomorrow)/i.test(msg)) signals.wantsSchedule += 3;

        // ─── Course list signals ───
        if (/what\s+(courses?|classes)\s+(am\s+i|do\s+i)/i.test(msg)) signals.wantsCourseList += 5;
        if (/\b(my\s+courses|my\s+classes|enrolled\s+in)\b/.test(msg)) signals.wantsCourseList += 4;
        if (/\b(list|show|all)\s+(my\s+)?(courses|classes)\b/.test(msg)) signals.wantsCourseList += 4;
        if (/how\s+many\s+(courses|classes)/i.test(msg)) signals.wantsCourseList += 4;
        if (/what\s+am\s+i\s+taking/i.test(msg)) signals.wantsCourseList += 4;

        // ─── Assignment detail signals ───
        if (/\b(rubric|instructions?|requirements?|submission\s+type)\b/.test(msg)) signals.wantsAssignmentDetail += 4;
        if (/how\s+(do|should)\s+i\s+(submit|do|complete)/i.test(msg)) signals.wantsAssignmentDetail += 3;
        if (/details?\s+(about|on|for)\s+/i.test(msg)) signals.wantsAssignmentDetail += 2;
        if (/tell\s+me\s+(about|more\s+about)\s+(the\s+)?assignment/i.test(msg)) signals.wantsAssignmentDetail += 3;
        if (/explain\s+(the\s+)?assignment/i.test(msg)) signals.wantsAssignmentDetail += 3;

        return signals;
    }

    /**
     * Detect ENTITY signals — what the user is asking ABOUT.
     * Returns info about whether a specific course was mentioned.
     */
    detectEntitySignals(msg, canvasData) {
        const signals = {
            mentionsCourse: false,
            courseName: null,
            courseSubject: null,
            mentionsSpecificAssignment: false
        };

        if (!canvasData?.courses) return signals;

        // Check if message mentions a course by name or subject
        for (const course of canvasData.courses) {
            const name = (course.name || '').toLowerCase();
            const subject = (course.subject || '').toLowerCase();

            if (subject && msg.includes(subject)) {
                signals.mentionsCourse = true;
                signals.courseName = course.name;
                signals.courseSubject = subject;
                break;
            }

            // Check key words from course name (e.g., "AP Physics" matches "physics")
            const nameWords = name.split(/[\s\-:]+/).filter(w => w.length > 3);
            for (const word of nameWords) {
                if (msg.includes(word) && !['class', 'course', 'period', 'section', 'honors'].includes(word)) {
                    signals.mentionsCourse = true;
                    signals.courseName = course.name;
                    signals.courseSubject = subject || word;
                    break;
                }
            }
            if (signals.mentionsCourse) break;
        }

        // Check if user references a specific assignment name
        const allAssignments = canvasData.assignments || [];
        for (const a of allAssignments) {
            const title = (a.title || a.name || '').toLowerCase();
            if (title.length > 4 && msg.includes(title)) {
                signals.mentionsSpecificAssignment = true;
                break;
            }
        }

        return signals;
    }

    /**
     * Combine action + entity signals into final tool scores.
     */
    computeToolScores(actions, entity, msg, canvasData) {
        const scores = {
            globalPlanner: 0,
            courseNavigator: 0,
            gradeAnalyzer: 0,
            syllabusReader: 0,
            announcementReader: 0,
            courseLister: 0,
            assignmentDetail: 0,
            diningMenu: 0,
            gmailEmail: 0
        };

        // ─── Map action signals to tools ───

        // Assignments: if a course is mentioned → courseNavigator, otherwise → globalPlanner
        if (actions.wantsAssignments > 0) {
            if (entity.mentionsCourse) {
                scores.courseNavigator += actions.wantsAssignments + 2; // Boost for course-specific
            } else {
                scores.globalPlanner += actions.wantsAssignments;
            }
        }

        // Grades always → gradeAnalyzer
        scores.gradeAnalyzer += actions.wantsGrades;

        // Syllabus → syllabusReader (only if a course is mentioned, otherwise it's vague)
        if (actions.wantsSyllabus > 0) {
            if (entity.mentionsCourse) {
                scores.syllabusReader += actions.wantsSyllabus + 2;
            } else {
                scores.syllabusReader += actions.wantsSyllabus;
            }
        }

        // Announcements
        scores.announcementReader += actions.wantsAnnouncements;

        // Schedule / planner
        scores.globalPlanner += actions.wantsSchedule;

        // Course listing
        scores.courseLister += actions.wantsCourseList;

        // Assignment detail
        if (actions.wantsAssignmentDetail > 0) {
            scores.assignmentDetail += actions.wantsAssignmentDetail;
            // If also mentions a specific assignment name, big boost
            if (entity.mentionsSpecificAssignment) {
                scores.assignmentDetail += 3;
            }
        }

        // ─── DISAMBIGUATION: Course mentioned but NO clear action ───
        // e.g., "what is physics" → could be syllabus or assignments
        if (entity.mentionsCourse) {
            const totalAction = Object.values(actions).reduce((a, b) => a + b, 0);

            if (totalAction === 0) {
                // No action detected at all — "tell me about physics" → syllabus
                scores.syllabusReader += 2;
            }

            // If grades and assignments are TIED, look for tiebreakers
            if (scores.gradeAnalyzer > 0 && scores.gradeAnalyzer === scores.courseNavigator) {
                // "grade" is more explicit, give it a slight edge
                scores.gradeAnalyzer += 1;
            }
        }

        // ─── TIEBREAKER: "what is" + course + action word ───
        // "what is the physics hw" → hw wins over syllabus
        // "what is physics about" → syllabus wins
        if (/what\s+is\s+/i.test(msg) && entity.mentionsCourse) {
            // If there's a strong assignment signal, suppress syllabus
            if (actions.wantsAssignments >= 3) {
                scores.syllabusReader = Math.max(0, scores.syllabusReader - 3);
            }
            // If there's a strong grade signal, suppress syllabus
            if (actions.wantsGrades >= 3) {
                scores.syllabusReader = Math.max(0, scores.syllabusReader - 3);
            }
        }

        return scores;
    }

    formatResponse(content) {
        return content; 
    }
}

// Initialization Logic
function initializeAgentManager() {
    if (window.canvasAgentManagerInstance) {
        return window.canvasAgentManagerInstance;
    }
    
    console.log('🔄 Initializing Agent Manager...');
    const agentManager = new CanvasAgentManager();
    
    window.CanvasAgentManager = CanvasAgentManager;
    window.canvasAgentManagerInstance = agentManager;
    
    return agentManager;
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initializeAgentManager();
} else {
    document.addEventListener('DOMContentLoaded', initializeAgentManager);
}