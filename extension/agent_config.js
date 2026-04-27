const AGENT_CONFIG = {
    // 🛠️ TOOL CONFIGURATION
    // Keys must match the tool names in canvas_tools.js (lowercase)
    toolPrompts: {

        syllabusReader: {
            systemPrompt: "You are a course information assistant. Help students understand what their courses are about, course policies, grading, materials needed, and learning objectives based on syllabus information.",
            fallbackResponse: "I couldn't find syllabus information for that course.",
            maxPreviewLength: 600
        },
        
        // Config for "GlobalPlanner" (Time-based queries)
        globalPlanner: {
            systemPrompt: "You are a master scheduler. Help the student prioritize tasks based on deadlines. Be encouraging but realistic.",
            fallbackResponse: "I checked your schedule but couldn't find upcoming items.",
            maxItemsToShow: 8,
            searchWindowDays: 14 // How far ahead to look
        },

        // Config for "CourseNavigator" (Specific Course/Grade queries)
        courseNavigator: {
            systemPrompt: "You are a course assistant. When answering about syllabus or grades, be precise. Use the provided context context heavily.",
            fallbackResponse: "I couldn't find specific details for that course.",
            includeSyllabusContext: true
        },
        // 🆕 Config for "GradeAnalyzer" (Assignment-level grades)
        gradeAnalyzer: {
            systemPrompt: "You are an academic performance analyst. Help students understand their grades, identify areas for improvement, and celebrate successes.",
            fallbackResponse: "I couldn't find grade information. Make sure your Canvas data has synced.",
            lowGradeThreshold: 70,
            highGradeThreshold: 90,
            maxItemsToShow: 10
        },

        // Config for "DiningMenu"
        diningMenu: {
            systemPrompt: "You are a helpful dining assistant. Highlight the entrees and any special dietary options available in the dining hall for the current day.",
            fallbackResponse: "I couldn't fetch the menu right now.",
            cacheDuration: 30 * 60 * 1000
        },

        // Config for "AnnouncementReader"
        announcementReader: {
            systemPrompt: "You summarize announcements clearly and highlight important deadlines or action items.",
            fallbackResponse: "No announcements found.",
            maxItemsToShow: 10,
            defaultLookbackDays: 90
        },
        
        // Config for "CourseLister"
        courseLister: {
            systemPrompt: "You list all courses the student is enrolled in, including grades and term information.",
            fallbackResponse: "I couldn't find your course list. Please sync your Canvas data.",
            maxItemsToShow: 50
        },
        
        // 📧 NEW: Gmail Email Tool Config
        gmailEmail: {
            systemPrompt: "You help students check and summarize their school emails. Show sender, subject, date, and a brief preview. Highlight action items or deadlines mentioned in emails.",
            fallbackResponse: "I couldn't fetch your emails. Make sure Gmail is connected in Settings.",
            maxItemsToShow: 12,
            defaultLookbackDays: 7,
            senderDomains: ['christchurchschool.org']
        }
    },

    // 🤖 AGENT BEHAVIOR
    agentBehavior: {
        useEmojis: true,           // If false, tools will return plain text
        defaultTool: 'globalPlanner',
        cacheDuration: 15 * 60 * 1000 // 15 minutes
    },

    // 📝 RESPONSE FORMATTING
    responseFormat: {
        maxLength: 8000,
        useMarkdown: true,
        includeSeparators: true    // Adds "---" between sections
    },

    // ⚠️ ERROR HANDLING
    errorMessages: {
        noData: "I can't see your Canvas data yet. Please make sure you are logged in and the data has finished syncing.",
        apiError: "I'm having trouble connecting to Canvas right now. Please try again in a moment.",
        noToolMatch: "I'm not sure how to help with that. Try asking about 'assignments', 'grades', or 'what is due'.",
        genericError: "Something went wrong. Please try again."
    },
    // ═══════════════════════════════════════════════════════════════
    // 🆕 GEMINI FUNCTION NAME → LOCAL CONFIG MAPPING
    // Maps server-side Gemini tool names to local toolPrompts keys
    // Used by background.js executeToolCall() to look up config
    // ═══════════════════════════════════════════════════════════════
    geminiToolMap: {
        'get_assignments':      'globalPlanner',
        'get_grades':           'gradeAnalyzer',
        'get_dining_menu':      'diningMenu',
        'get_announcements':    'announcementReader',
        'get_course_list':      'courseLister',
        'get_syllabus':         'syllabusReader',
        'get_assignment_detail': 'courseNavigator',
        'get_emails':           'gmailEmail',
        'web_search':           null  // Handled server-side, no local config needed
    },

    // ═══════════════════════════════════════════════════════════════
    // 🆕 OFFLINE FALLBACK TOOL SCHEMA
    // Lightweight version of server's GEMINI_TOOL_DECLARATIONS
    // Used ONLY when server is unreachable and we need to do
    // basic keyword matching as a last resort
    // ═══════════════════════════════════════════════════════════════
    offlineFallbackKeywords: {
        'get_assignments': [
            'assignment', 'assignments', 'homework', 'hw', 'due', 'deadline',
            'deadlines', 'submit', 'submission', 'task', 'tasks', 'upcoming',
            'overdue', 'late', 'missing work', 'what do i have to do',
            'whats due', "what's due", 'do i have hw', 'do i have homework'
        ],
        'get_grades': [
            'grade', 'grades', 'score', 'scores', 'gpa', 'average',
            'percentage', 'how am i doing', 'am i passing', 'am i failing',
            'what did i get', 'my grade', 'my grades', 'report card',
            'performance', 'marks'
        ],
        'get_dining_menu': [
            'menu', 'food', 'lunch', 'dinner', 'breakfast', 'dining',
            'cafeteria', 'eat', 'eating', 'meal', 'meals', "what's for",
            'whats for', 'dining hall', 'sage'
        ],
        'get_announcements': [
            'announcement', 'announcements', 'news', 'update', 'updates',
            'posted', 'bulletin', 'notice', 'notification', 'teacher said',
            'professor said'
        ],
        'get_course_list': [
            'courses', 'classes', 'enrolled', 'enrollment', 'my classes',
            'my courses', 'what am i taking', 'course list', 'class list',
            'schedule'
        ],
        'get_syllabus': [
            'syllabus', 'course info', 'grading policy', 'late policy',
            'textbook', 'office hours', 'what is the class about',
            'course description', 'materials'
        ],
        'get_assignment_detail': [
            'rubric', 'instructions', 'requirements', 'how to submit',
            'submission type', 'assignment detail', 'tell me about the assignment'
        ],
        'get_emails': [
            'email', 'emails', 'inbox', 'mail', 'gmail', 'check my email',
            'school email', 'new emails', 'unread'
        ]
    }
};

// Export for use in other files
if (typeof window !== 'undefined') {
    window.AGENT_CONFIG = AGENT_CONFIG;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AGENT_CONFIG };
}