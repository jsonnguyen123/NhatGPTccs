// Agent Configuration Helper
function getAgentConfig() {
    if (typeof AGENT_CONFIG !== 'undefined') return AGENT_CONFIG;
    if (window.AGENT_CONFIG) return window.AGENT_CONFIG;
    return {
        agentBehavior: { useEmojis: true },
        responseFormat: { includeSeparators: true, maxLength: 4000 },
        toolPrompts: {},
        errorMessages: { noToolMatch: "I can't help with that right now." }
    };
}

const MIN_COURSE_MATCH_WORD_LENGTH = 4;

// Base Tool Class
class CanvasTool {
    constructor(toolConfig = {}) {
        this.name = new.target?.name?.replace(/Tool$/, '') || 'Base';
        this.globalConfig = getAgentConfig();
        this.config = this.mergeConfig(toolConfig);
    }
    
    mergeConfig(toolConfig) {
        const defaultConfig = this.globalConfig.toolPrompts?.[this.getConfigKey()] || {};
        return { ...defaultConfig, ...toolConfig };
    }

    getConfigKey() {
        const explicitConfigKeys = {
            Announcement: 'announcementReader'
        };

        if (explicitConfigKeys[this.name]) {
            return explicitConfigKeys[this.name];
        }

        return this.name.charAt(0).toLowerCase() + this.name.slice(1);
    }

    getCourseKeywords() {
        return [
            'physics', 'chemistry', 'biology', 'calculus', 'algebra',
            'geometry', 'english', 'history', 'government', 'economics',
            'spanish', 'french', 'latin', 'art', 'music', 'computer',
            'forensics', 'humanities', 'composition', 'literature', 'math',
            'science', 'psychology', 'sociology', 'religion', 'chapel'
        ];
    }

    findCourse(message, canvasData) {
        if (!canvasData?.courses) return null;

        const lowerMsg = message.toLowerCase();

        let match = canvasData.courses.find(c =>
            c.subject && lowerMsg.includes(String(c.subject).toLowerCase())
        );
        if (match) return match;

        for (const keyword of this.getCourseKeywords()) {
            if (!lowerMsg.includes(keyword)) continue;

            match = canvasData.courses.find(c =>
                c.name && c.name.toLowerCase().includes(keyword)
            );

            if (match) return match;
        }

        match = canvasData.courses.find(c =>
            c.name && lowerMsg.includes(c.name.toLowerCase())
        );
        if (match) return match;

        return canvasData.courses.find(c => {
            if (!c.name) return false;
            const words = c.name.toLowerCase().split(/[\s\-]+/).filter(w => w.length >= MIN_COURSE_MATCH_WORD_LENGTH);
            return words.some(word => lowerMsg.includes(word));
        }) || null;
    }

    // --- 🛠️ SHARED LOGIC ---

    findUpcomingAssignments(canvasData, limit = 5) {
        console.group("🕵️‍♀️ DEEP DEBUG: findUpcomingAssignments");

        // --- CONFIGURATION ---
        const MAX_LOOKBACK_DAYS = 21; 
        const ONLINE_TYPES = ['online_upload', 'online_text_entry', 'online_url', 'media_recording'];
        // ---------------------

        // 1. Check Planner Overrides Data
        console.log("1. RAW OVERRIDES DATA:", canvasData.plannerOverrides);
        
        const tickedItemIds = new Set();
        if (canvasData.plannerOverrides && Array.isArray(canvasData.plannerOverrides)) {
            canvasData.plannerOverrides.forEach(item => {
                if (item.plannable_type === 'assignment' && (item.marked_complete || item.dismissed)) {
                    tickedItemIds.add(String(item.plannable_id));
                }
            });
        }
        console.log(`📝 Ticked Items Set (IDs):`, [...tickedItemIds]);

        // 2. Gather Assignments
        let assignments = [];
        if (Array.isArray(canvasData.assignments)) {
            assignments = [...canvasData.assignments];
        }
        if (canvasData.courses && Array.isArray(canvasData.courses)) {
            canvasData.courses.forEach(c => {
                if (Array.isArray(c.assignments)) {
                    assignments = assignments.concat(c.assignments.map(a => ({...a, courseName: c.name})));
                }
            });
        }
        console.log(`📚 Total Assignments Found: ${assignments.length}`);

        const now = new Date();
        const cutoffDate = new Date();
        cutoffDate.setDate(now.getDate() - MAX_LOOKBACK_DAYS);

        const processed = assignments
            .map(a => {
                // normalizing data
                return {
                    id: String(a.id),
                    title: a.title || a.name || 'Untitled Task',
                    courseName: a.courseName || a.context_name || 'Class',
                    // DEBUG: Print raw points to see if it's 0, null, or undefined
                    rawPoints: a.points_possible, 
                    points: (a.points !== undefined && a.points !== null) ? a.points : a.points_possible,
                    
                    dueDate: a.dueDate || a.due_at || a.todo_date || a.start_at || a.lock_at,
                    submissionTypes: a.submissionTypes || a.submission_types || [],
                    workflowState: a.submission?.workflow_state || a.workflow_state || 'unsubmitted',
                    isGraded: a.submission?.grade != null || a.submission?.score != null,
                    hasSubmitted: a.submission?.submitted_at != null
                };
            })
            .map(a => ({
                ...a,
                dateObj: a.dueDate ? new Date(a.dueDate) : null
            }))
            .filter(a => a.dateObj !== null)
            .sort((a, b) => a.dateObj - b.dateObj);

        console.log(`✅ Final Results: ${processed.length} items.`);
        console.groupEnd();
        return processed.slice(0, limit);
    }
}

// 1. GLOBAL PLANNER (For "What is due?" / "Schedule")
class GlobalPlannerTool extends CanvasTool {
    constructor(toolConfig = {}) {
        super(toolConfig);
        this.name = 'GlobalPlanner';
    }

    async execute(message, canvasData) {
        const lowerMsg = message.toLowerCase();
        
        if (lowerMsg.includes('event') || lowerMsg.includes('calendar')) {
             return this.getCalendarEvents(canvasData);
        }

        // Use the SHARED logic
        const upcoming = this.findUpcomingAssignments(canvasData, 8);

        if (upcoming.length === 0) return "No upcoming assignments found in your Canvas.";

        let response = "📅 **Upcoming Tasks:**\n\n";
        upcoming.forEach(a => {
            const days = Math.ceil((new Date(a.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
            const emoji = days <= 1 ? '🔴' : (days <= 3 ? '🟡' : '🟢');
            response += `${emoji} **${a.title}** (${a.courseName})\n   Due: ${new Date(a.dueDate).toLocaleDateString()}\n`;
        });
        
        return response;
    }

    getCalendarEvents(canvasData) {
        const events = canvasData.calendarEvents || [];
        const upcoming = events.filter(e => e.start && new Date(e.start) > new Date()).slice(0, 5);
        if (upcoming.length === 0) return "No calendar events found.";
        return "🗓 **Calendar Events:**\n" + upcoming.map(e => `• ${e.title} (${new Date(e.start).toLocaleDateString()})`).join('\n');
    }
}

class BlackbaudCalendarTool extends CanvasTool {
    constructor(toolConfig = {}) {
        super(toolConfig);
        this.name = 'BlackbaudCalendar';
    }

    async execute(message, canvasData, context = {}) {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'FETCH_BLACKBAUD_CALENDAR',
                startDate: context.startDate,
                endDate: context.endDate
            });

            if (!response?.success) {
                return this.formatError(response?.error, response?.needsReconnect);
            }

            const events = Array.isArray(response.data?.events) ? response.data.events : [];
            const { startDate, endDate } = response.data;

            if (events.length === 0) {
                return `📅 No Blackbaud calendar events found from **${startDate}** to **${endDate}**.`;
            }

            return this.formatEvents(events, startDate, endDate);
        } catch (error) {
            console.error('📅 BlackbaudCalendarTool: Error:', error);
            return this.formatError(error.message);
        }
    }

    formatEvents(events, startDate, endDate) {
        const visibleEvents = [...events]
            .sort((a, b) => this.compareEventStartDates(a, b))
            .slice(0, this.config.maxItemsToShow || 10);

        let response = `📅 **Blackbaud Calendar Events** (${startDate} → ${endDate})\n\n`;

        visibleEvents.forEach(event => {
            const title = event.title || event.name || 'Untitled Event';
            const start = event.start_date || event.start;
            const location = event.location || event.location_name;
            const dateLabel = start
                ? new Date(start).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric'
                })
                : 'Date unavailable';

            response += `• **${title}** — ${dateLabel}`;
            if (location) response += ` @ ${location}`;
            response += '\n';
        });

        if (events.length > visibleEvents.length) {
            response += `\n_...and ${events.length - visibleEvents.length} more events._`;
        }

        return response;
    }

    compareEventStartDates(firstEvent, secondEvent) {
        const firstTime = this.getEventStartTime(firstEvent);
        const secondTime = this.getEventStartTime(secondEvent);

        if (firstTime == null && secondTime == null) return 0;
        if (firstTime == null) return 1;
        if (secondTime == null) return -1;

        return firstTime - secondTime;
    }

    getEventStartTime(event) {
        const startValue = event.start_date || event.start;
        if (!startValue) return null;

        const parsedTime = new Date(startValue).getTime();
        return Number.isNaN(parsedTime) ? null : parsedTime;
    }

    formatError(errorMessage = '', needsReconnect = false) {
        if (needsReconnect) {
            return "📅 **Blackbaud Not Connected**\n\nConnect Blackbaud in Settings to view your school calendar events.";
        }

        return `📅 I couldn't fetch your Blackbaud calendar right now.${errorMessage ? `\n\n**Error:** ${errorMessage}` : ''}`;
    }
}

class GradeAnalyzerTool extends CanvasTool {
    constructor(toolConfig = {}) {
        super(toolConfig);
        this.name = 'GradeAnalyzer';
    }

    // ─── TRIMESTER HELPERS (mirrors background.js logic) ──────────

    getTrimesterForDate(date) {
        return globalThis.TrimesterUtils?.getTrimesterForDate(date) || null;
    }

    getCurrentTrimester() {
        return globalThis.TrimesterUtils?.getCurrentTrimester(new Date()) || this.getTrimesterForDate(new Date());
    }

    /**
     * Get the best date for a grade entry to determine its trimester.
     * Priority: dueAt → gradedAt → submittedAt
     */
    getGradeDate(grade) {
        return grade.dueAt || grade.gradedAt || grade.submittedAt || null;
    }

    /**
     * Filter grades to a specific trimester number (1, 2, or 3).
     */
    filterByTrimester(grades, trimesterNum) {
        return globalThis.TrimesterUtils?.filterByTrimester(grades, trimesterNum, {
            currentDate: new Date(),
            getDate: (grade, currentDate) => grade?.dueAt ?? currentDate
        }) || [];
    }

    /**
     * Detect if user is asking about a specific trimester.
     * Returns trimester number (1/2/3) or null for current.
     */
    detectRequestedTrimester(message) {
        const msg = message.toLowerCase();

        // Explicit trimester references
        if (/\b(trimester|tri|t)\s*1\b/i.test(msg) || msg.includes('first trimester')) return 1;
        if (/\b(trimester|tri|t)\s*2\b/i.test(msg) || msg.includes('second trimester')) return 2;
        if (/\b(trimester|tri|t)\s*3\b/i.test(msg) || msg.includes('third trimester')) return 3;

        // "all trimesters" / "full year" / "all grades"
        if (/all\s+(trimester|grade|year)/i.test(msg) || msg.includes('full year') || msg.includes('whole year')) return 'all';

        return null; // Will use current trimester
    }

    /**
     * Check if user is asking about a specific assignment by name.
     */
    isSpecificAssignmentQuery(message) {
        const msg = message.toLowerCase();
        // Patterns like "grade on [assignment]", "score for [assignment]", "how did I do on [assignment]"
        const patterns = [
            /grade\s+(on|for)\s+/i,
            /score\s+(on|for)\s+/i,
            /how\s+did\s+i\s+do\s+on/i,
            /what\s+did\s+i\s+get\s+on/i,
            /result\s+(of|for|on)/i
        ];
        return patterns.some(p => p.test(msg));
    }

    async execute(message, canvasData) {
        const lowerMsg = message.toLowerCase();
        let grades = canvasData.assignmentGrades || [];
        
        console.log('📊 GradeAnalyzer: Processing request');
        console.log('📊 GradeAnalyzer: Total grades available:', grades.length);
        
        if (grades.length === 0) {
            return "I don't have your assignment grades loaded yet. Please wait for the sync to complete or try refreshing your Canvas data.\n\n" +
                "**Tip:** You can force a refresh by going to the extension options and clicking 'Re-sync Data'.";
        }

        // ─── TRIMESTER FILTERING ──────────────────────────────────
        const requestedTri = this.detectRequestedTrimester(message);
        const isSpecificAssignment = this.isSpecificAssignmentQuery(message);
        const currentTri = this.getCurrentTrimester();

        let trimesterLabel = '';
        let filteredGrades = grades;

        // Only filter by trimester if NOT asking about a specific assignment
        if (!isSpecificAssignment) {
            if (requestedTri === 'all') {
                trimesterLabel = '(All Trimesters)';
                // No filtering — show everything
            } else {
                const triNum = requestedTri || currentTri.trimester;
                const triInfo = requestedTri 
                    ? { trimester: requestedTri, label: `Trimester ${requestedTri}` }
                    : currentTri;
                
                filteredGrades = this.filterByTrimester(grades, triNum);
                trimesterLabel = `(${triInfo.label})`;

                console.log(`📊 GradeAnalyzer: Filtered to T${triNum}: ${filteredGrades.length}/${grades.length} grades`);

                // If current trimester has no grades yet, fall back to previous
                if (filteredGrades.length === 0 && !requestedTri) {
                    const prevTri = triNum === 1 ? 3 : triNum - 1;
                    filteredGrades = this.filterByTrimester(grades, prevTri);
                    if (filteredGrades.length > 0) {
                        trimesterLabel = `(Trimester ${prevTri} — current trimester has no grades yet)`;
                        console.log(`📊 GradeAnalyzer: Fell back to T${prevTri}: ${filteredGrades.length} grades`);
                    } else {
                        // Nothing in previous either, show all
                        filteredGrades = grades;
                        trimesterLabel = '(All available)';
                    }
                }
            }
        } else {
            // Specific assignment query — search ALL grades
            trimesterLabel = '';
        }

        // Check if user wants grades for a specific course
        const course = this.findCourse(message, canvasData);

        if (course) {
            const courseGrades = filteredGrades.filter(g => g.courseName === course.name);
            console.log(`📊 GradeAnalyzer: Found ${courseGrades.length} grades for ${course.name} ${trimesterLabel}`);
            
            if (courseGrades.length === 0) {
                return `No graded assignments found for **${course.name}** ${trimesterLabel}.\n\n` +
                    `💡 Try: *"show my ${course.subject || course.name} grades for all trimesters"*`;
            }
        }
        
        // Check for specific intents — pass trimesterLabel for display
        if (lowerMsg.includes('missing') || lowerMsg.includes('not submitted')) {
            return this.getMissingAssignments(filteredGrades, course, trimesterLabel);
        }
        if (lowerMsg.includes('late')) {
            return this.getLateAssignments(filteredGrades, course, trimesterLabel);
        }
        if (lowerMsg.includes('recent') || lowerMsg.includes('latest')) {
            return this.getRecentGrades(filteredGrades, course, 5, trimesterLabel);
        }
        if (lowerMsg.includes('low') || lowerMsg.includes('bad') || lowerMsg.includes('failing')) {
            return this.getLowGrades(filteredGrades, course, 70, trimesterLabel);
        }
        if (lowerMsg.includes('high') || lowerMsg.includes('best') || lowerMsg.includes('top')) {
            return this.getHighGrades(filteredGrades, course, 90, trimesterLabel);
        }
        if (lowerMsg.includes('average') || lowerMsg.includes('gpa')) {
            return this.getAverageGrades(filteredGrades, course, trimesterLabel);
        }

        // Default: show summary or course-specific grades
        if (course) {
            return this.getCourseGrades(filteredGrades, course, trimesterLabel);
        }
        
        return this.getGradeSummary(filteredGrades, canvasData, trimesterLabel);
    }

    getCourseGrades(grades, course, trimesterLabel = '') {
        const courseGrades = grades
            .filter(g => g.courseName === course.name && g.score !== null)
            .sort((a, b) => new Date(b.gradedAt || 0) - new Date(a.gradedAt || 0))
            .slice(0, 10);
        
        if (courseGrades.length === 0) {
            return `No graded assignments found for **${course.name}** ${trimesterLabel}.`;
        }

        let response = `📊 **Grades for ${course.name}** ${trimesterLabel}\n\n`;
        
        // Show hidden grades
        const hidden = courseGrades.filter(g => g.score === null && g.grade === null && !g.excused);
        const visible = courseGrades.filter(g => g.score !== null);

        visible.forEach(g => {
            const emoji = this.getGradeEmoji(g.percentage);
            response += `${emoji} **${g.assignmentName}**: ${g.score}/${g.pointsPossible} (${g.percentage}%)\n`;
        });

        if (hidden.length > 0) {
            response += `\n🔒 **${hidden.length} grade(s) hidden** by instructor\n`;
        }
        
        // Calculate average
        const avg = this.calculateAverage(visible);
        response += `\n📈 **Average**: ${avg}%`;

        
        return response;
    }

    getGradeSummary(grades, canvasData, trimesterLabel = '') {
        const gradedItems = grades.filter(g => g.score !== null && !g.excused);
        const hiddenItems = grades.filter(g => g.score === null && g.grade === null && !g.excused && !g.missing);
        
        if (gradedItems.length === 0 && hiddenItems.length === 0) {
            return `No graded assignments found ${trimesterLabel}.`;
        }

        let response = `📊 **Grade Summary** ${trimesterLabel}\n\n`;
        
        const courseGroups = {};
        gradedItems.forEach(g => {
            if (!courseGroups[g.courseName]) courseGroups[g.courseName] = [];
            courseGroups[g.courseName].push(g);
        });

        // Also count hidden per course
        const hiddenByCourse = {};
        hiddenItems.forEach(g => {
            hiddenByCourse[g.courseName] = (hiddenByCourse[g.courseName] || 0) + 1;
        });

        // Include overall course grade from canvasData.courses
        const courseMap = {};
        if (canvasData?.courses) {
            canvasData.courses.forEach(c => { courseMap[c.name] = c; });
        }

        for (const [courseName, courseGrades] of Object.entries(courseGroups)) {
            const avg = this.calculateAverage(courseGrades);
            const emoji = this.getGradeEmoji(avg);
            const count = courseGrades.length;
            const hiddenCount = hiddenByCourse[courseName] || 0;
            const hiddenStr = hiddenCount > 0 ? ` + ${hiddenCount} hidden` : '';
            
            // Show overall course grade if different from assignment average
            const courseInfo = courseMap[courseName];
            const overallStr = courseInfo?.grade != null ? ` | Overall: ${courseInfo.grade}%` : '';
            
            response += `${emoji} **${courseName}**: ${avg}% avg (${count} graded${hiddenStr})${overallStr}\n`;
        }

        if (hiddenItems.length > 0) {
            response += `\n🔒 ${hiddenItems.length} total grade(s) are hidden by instructors`;
        }

        return response;
    }

    getRecentGrades(grades, course, limit = 5, trimesterLabel = '') {
        let filtered = grades.filter(g => g.gradedAt && g.score !== null);
        
        if (course) {
            filtered = filtered.filter(g => g.courseName === course.name);
        }
        
        const recent = filtered
            .sort((a, b) => new Date(b.gradedAt) - new Date(a.gradedAt))
            .slice(0, limit);
        
        if (recent.length === 0) {
            return course 
                ? `No recent grades for **${course.name}** ${trimesterLabel}.`
                : `No recent grades found ${trimesterLabel}.`;
        }

        let response = course 
            ? `📝 **Recent Grades for ${course.name}** ${trimesterLabel}\n\n`
            : `📝 **Your Recent Grades** ${trimesterLabel}\n\n`;
        
        recent.forEach(g => {
            const emoji = this.getGradeEmoji(g.percentage);
            const date = new Date(g.gradedAt).toLocaleDateString();
            response += `${emoji} **${g.assignmentName}** (${g.courseName})\n   ${g.score}/${g.pointsPossible} (${g.percentage}%) - Graded ${date}\n\n`;
        });

        return response;
    }

    getMissingAssignments(grades, course, trimesterLabel = '') {
        let missing = grades.filter(g => g.missing && !g.excused);
        
        if (course) {
            missing = missing.filter(g => g.courseName === course.name);
        }
        
        if (missing.length === 0) {
            return course 
                ? `✅ No missing assignments in **${course.name}** ${trimesterLabel}!`
                : `✅ You have no missing assignments ${trimesterLabel}!`;
        }

        let response = `⚠️ **Missing Assignments${course ? ` for ${course.name}` : ''}** ${trimesterLabel}\n\n`;
        missing.forEach(g => {
            response += `❌ **${g.assignmentName}** (${g.courseName}) - ${g.pointsPossible} points\n`;
        });

        return response;
    }

    getLateAssignments(grades, course, trimesterLabel = '') {
        let late = grades.filter(g => g.late && g.score !== null);
        
        if (course) {
            late = late.filter(g => g.courseName === course.name);
        }
        
        if (late.length === 0) {
            return course 
                ? `✅ No late submissions in **${course.name}** ${trimesterLabel}!`
                : `✅ You have no late submissions ${trimesterLabel}!`;
        }

        let response = `⏰ **Late Submissions${course ? ` for ${course.name}` : ''}** ${trimesterLabel}\n\n`;
        late.slice(0, 10).forEach(g => {
            response += `🕐 **${g.assignmentName}** (${g.courseName}) - ${g.score}/${g.pointsPossible}\n`;
        });

        return response;
    }

    getLowGrades(grades, course, threshold = 70, trimesterLabel = '') {
        let low = grades.filter(g => g.percentage !== null && g.percentage < threshold && !g.excused);
        
        if (course) {
            low = low.filter(g => g.courseName === course.name);
        }
        
        low = low.sort((a, b) => a.percentage - b.percentage).slice(0, 10);
        
        if (low.length === 0) {
            return course 
                ? `🎉 No grades below ${threshold}% in **${course.name}** ${trimesterLabel}!`
                : `🎉 No grades below ${threshold}% ${trimesterLabel}!`;
        }

        let response = `📉 **Below ${threshold}%${course ? ` in ${course.name}` : ''}** ${trimesterLabel}\n\n`;
        low.forEach(g => {
            response += `⚠️ **${g.assignmentName}** (${g.courseName}) - ${g.percentage}%\n`;
        });

        return response;
    }

    getHighGrades(grades, course, threshold = 90, trimesterLabel = '') {
        let high = grades.filter(g => g.percentage !== null && g.percentage >= threshold);
        
        if (course) {
            high = high.filter(g => g.courseName === course.name);
        }
        
        high = high.sort((a, b) => b.percentage - a.percentage).slice(0, 10);
        
        if (high.length === 0) {
            return course 
                ? `No grades at or above ${threshold}% in **${course.name}** ${trimesterLabel} yet.`
                : `No grades at or above ${threshold}% ${trimesterLabel} yet.`;
        }

        let response = `🌟 **Top Grades${course ? ` in ${course.name}` : ''}** ${trimesterLabel}\n\n`;
        high.forEach(g => {
            response += `⭐ **${g.assignmentName}** (${g.courseName}) - ${g.percentage}%\n`;
        });

        return response;
    }

    getAverageGrades(grades, course, trimesterLabel = '') {
        let filtered = grades.filter(g => g.score !== null && !g.excused);
        
        if (course) {
            filtered = filtered.filter(g => g.courseName === course.name);
        }
        
        if (filtered.length === 0) {
            return `No graded assignments to calculate average ${trimesterLabel}.`;
        }

        if (course) {
            const avg = this.calculateAverage(filtered);
            return `📊 **${course.name} Average** ${trimesterLabel}: ${avg}% across ${filtered.length} assignments`;
        }

        const courseGroups = {};
        filtered.forEach(g => {
            if (!courseGroups[g.courseName]) courseGroups[g.courseName] = [];
            courseGroups[g.courseName].push(g);
        });

        let response = `📊 **Course Averages** ${trimesterLabel}\n\n`;
        for (const [courseName, courseGrades] of Object.entries(courseGroups)) {
            const avg = this.calculateAverage(courseGrades);
            const emoji = this.getGradeEmoji(avg);
            response += `${emoji} **${courseName}**: ${avg}%\n`;
        }

        const overallAvg = this.calculateAverage(filtered);
        response += `\n📈 **Overall Average**: ${overallAvg}%`;

        return response;
    }

    calculateAverage(grades) {
        if (grades.length === 0) return 0;
        const validGrades = grades.filter(g => g.percentage !== null);
        if (validGrades.length === 0) return 0;
        const sum = validGrades.reduce((acc, g) => acc + g.percentage, 0);
        return Math.round(sum / validGrades.length);
    }

    getGradeEmoji(percentage) {
        if (percentage === null) return '❓';
        if (percentage >= 90) return '🌟';
        if (percentage >= 80) return '✅';
        if (percentage >= 70) return '🟡';
        if (percentage >= 60) return '🟠';
        return '🔴';
    }
}

// SYLLABUS READER TOOL - For "What is this course about?" queries
class SyllabusReaderTool extends CanvasTool {
    constructor(toolConfig = {}) {
        super(toolConfig);
        this.name = 'SyllabusReader';
    }

    async execute(message, canvasData) {
        const lowerMsg = message.toLowerCase();
        const syllabi = canvasData.courseSyllabi || {};
        
        console.log('📚 SyllabusReader: Processing request');
        console.log('📚 SyllabusReader: Available syllabi:', Object.keys(syllabi).length);
        
        // Find which course the user is asking about
        const course = this.findCourse(message, canvasData);
        
        if (!course) {
            // If no specific course, show available courses with syllabi
            return this.listAvailableSyllabi(syllabi, canvasData);
        }
        
        console.log(`📚 SyllabusReader: Found course: ${course.name}`);
        
        // Get syllabus for this course
        const syllabus = syllabi[course.id];
        
        if (!syllabus || !syllabus.hasSyllabus) {
            return this.noSyllabusResponse(course);
        }
        
        // Check what specifically the user wants
        if (lowerMsg.includes('policy') || lowerMsg.includes('policies')) {
            return this.extractPolicies(syllabus, course);
        }
        
        if (lowerMsg.includes('contact') || lowerMsg.includes('email') || lowerMsg.includes('office')) {
            return this.extractContactInfo(syllabus, course);
        }
        
        if (lowerMsg.includes('grade') || lowerMsg.includes('grading') || lowerMsg.includes('weight')) {
            return this.extractGradingInfo(syllabus, course);
        }
        
        if (lowerMsg.includes('textbook') || lowerMsg.includes('book') || lowerMsg.includes('material')) {
            return this.extractMaterials(syllabus, course);
        }
        
        if (lowerMsg.includes('objective') || lowerMsg.includes('goal') || lowerMsg.includes('learn')) {
            return this.extractObjectives(syllabus, course);
        }
        
        // Default: provide a summary of the course
        return this.getSyllabusSummary(syllabus, course);
    }

    listAvailableSyllabi(syllabi, canvasData) {
        const coursesWithSyllabi = Object.values(syllabi).filter(s => s.hasSyllabus);
        
        if (coursesWithSyllabi.length === 0) {
            return "📚 I don't have any course syllabi loaded yet.\n\n" +
                "This could mean:\n" +
                "• Your courses haven't published syllabi yet\n" +
                "• The syllabus data is still syncing\n" +
                "• Your school uses a different method for sharing course info\n\n" +
                "Try asking about a specific course, like: *\"What is Physics about?\"*";
        }
        
        let response = "📚 **Available Course Information:**\n\n";
        response += "I have syllabus information for these courses:\n\n";
        
        coursesWithSyllabi.forEach(s => {
            const previewLength = Math.min(s.syllabusText.length, 100);
            const hasContent = s.syllabusText.length > 50;
            response += `• **${s.courseName}** ${hasContent ? '✓' : '(limited info)'}\n`;
        });
        
        response += "\n💡 **Ask me things like:**\n";
        response += "• *\"What is Physics about?\"*\n";
        response += "• *\"What are the grading policies for Math?\"*\n";
        response += "• *\"What materials do I need for English?\"*";
        
        return response;
    }

    noSyllabusResponse(course) {
        return `📚 I don't have detailed syllabus information for **${course.name}** yet.\n\n` +
            `**What I do know:**\n` +
            `• Course: ${course.name}\n` +
            `• Code: ${course.code || 'N/A'}\n` +
            `• Current Grade: ${course.grade ? course.grade + '%' : 'N/A'}\n\n` +
            `The syllabus might not be published yet, or the course uses a different format.\n\n` +
            `👉 You can view the course directly: [Open in Canvas](${course.url})`;
    }

    getSyllabusSummary(syllabus, course) {
        const text = syllabus.syllabusText || syllabus.description || '';
        
        if (text.length < 50) {
            return this.noSyllabusResponse(course);
        }
        
        let response = `📚 **About ${course.name}:**\n\n`;
        
        // Provide course description if available
        if (syllabus.description && syllabus.description.length > 20) {
            response += `**Description:**\n${this.truncateText(syllabus.description, 500)}\n\n`;
        }
        
        // Provide syllabus summary
        if (syllabus.syllabusText && syllabus.syllabusText.length > 20) {
            // Try to extract key sections
            const sections = this.extractKeySections(syllabus.syllabusText);
            
            if (sections.overview) {
                response += `**Overview:**\n${this.truncateText(sections.overview, 400)}\n\n`;
            } else {
                response += `**Syllabus Preview:**\n${this.truncateText(syllabus.syllabusText, 600)}\n\n`;
            }
        }
        
        // Add course grade if available
        if (course.grade) {
            response += `📊 **Your Current Grade:** ${course.grade}%\n\n`;
        }
        
        response += `👉 [View Full Syllabus in Canvas](${course.url}/assignments/syllabus)`;
        
        return response;
    }

    extractPolicies(syllabus, course) {
        const text = syllabus.syllabusText.toLowerCase();
        let response = `📋 **Policies for ${course.name}:**\n\n`;
        
        const policyKeywords = ['policy', 'policies', 'late', 'attendance', 'academic integrity', 'homework', 'missing'];
        let foundPolicies = false;
        
        // Try to find policy-related sections
        const lines = syllabus.syllabusText.split(/[\n.]+/);
        const policyLines = lines.filter(line => {
            const lowerLine = line.toLowerCase();
            return policyKeywords.some(kw => lowerLine.includes(kw));
        });
        
        if (policyLines.length > 0) {
            foundPolicies = true;
            policyLines.slice(0, 10).forEach(line => {
                const trimmed = line.trim();
                if (trimmed.length > 10) {
                    response += `• ${trimmed}\n`;
                }
            });
        }
        
        if (!foundPolicies) {
            response += "I couldn't find specific policy information in the syllabus.\n\n";
            response += `Please check the full syllabus for details.\n`;
        }
        
        response += `\n👉 [View Full Syllabus](${course.url}/assignments/syllabus)`;
        return response;
    }

    extractContactInfo(syllabus, course) {
        const text = syllabus.syllabusText;
        let response = `📧 **Contact Info for ${course.name}:**\n\n`;
        
        // Try to find email addresses
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const emails = text.match(emailRegex) || [];
        
        // Try to find office hours
        const officeHoursRegex = /office\s*hours?[:\s]*([^\n.]+)/gi;
        const officeMatches = text.match(officeHoursRegex) || [];
        
        if (emails.length > 0) {
            response += "**Email(s):**\n";
            [...new Set(emails)].slice(0, 3).forEach(email => {
                response += `• ${email}\n`;
            });
            response += "\n";
        }
        
        if (officeMatches.length > 0) {
            response += "**Office Hours:**\n";
            officeMatches.slice(0, 2).forEach(match => {
                response += `• ${match.trim()}\n`;
            });
            response += "\n";
        }
        
        if (emails.length === 0 && officeMatches.length === 0) {
            response += "I couldn't find specific contact information in the syllabus.\n";
            response += "Check Canvas or the course page for teacher contact info.\n";
        }
        
        response += `\n👉 [View Full Syllabus](${course.url}/assignments/syllabus)`;
        return response;
    }

    extractGradingInfo(syllabus, course) {
        const text = syllabus.syllabusText;
        let response = `📊 **Grading for ${course.name}:**\n\n`;
        
        // Look for percentage patterns (e.g., "Tests: 40%", "Homework 20%")
        const gradingRegex = /([a-zA-Z\s]+)[:\s]*(\d{1,3})\s*%/g;
        const matches = [...text.matchAll(gradingRegex)];
        
        if (matches.length > 0) {
            response += "**Grade Breakdown:**\n";
            matches.slice(0, 10).forEach(match => {
                const category = match[1].trim();
                const percentage = match[2];
                response += `• ${category}: ${percentage}%\n`;
            });
            response += "\n";
        }
        
        // Look for grading scale
        const scalePatterns = [
            /A[:\s]*(\d{2,3})\s*[-–]\s*(\d{2,3})/gi,
            /(\d{2,3})\s*[-–]\s*(\d{2,3})\s*[=:]\s*A/gi
        ];
        
        // Current grade
        if (course.grade) {
            response += `**Your Current Grade:** ${course.grade}%\n\n`;
        }
        
        if (matches.length === 0) {
            response += "I couldn't find detailed grading information in the syllabus.\n";
        }
        
        response += `👉 [View Full Syllabus](${course.url}/assignments/syllabus)`;
        return response;
    }

    extractMaterials(syllabus, course) {
        const text = syllabus.syllabusText;
        let response = `📖 **Materials for ${course.name}:**\n\n`;
        
        const materialKeywords = ['textbook', 'book', 'material', 'required', 'supply', 'supplies', 'calculator', 'notebook'];
        
        const lines = syllabus.syllabusText.split(/[\n]+/);
        const materialLines = lines.filter(line => {
            const lowerLine = line.toLowerCase();
            return materialKeywords.some(kw => lowerLine.includes(kw));
        });
        
        if (materialLines.length > 0) {
            response += "**Required/Recommended:**\n";
            materialLines.slice(0, 8).forEach(line => {
                const trimmed = line.trim();
                if (trimmed.length > 5) {
                    response += `• ${trimmed}\n`;
                }
            });
        } else {
            response += "I couldn't find specific material requirements in the syllabus.\n";
            response += "Check with your teacher or the course page for required materials.\n";
        }
        
        response += `\n👉 [View Full Syllabus](${course.url}/assignments/syllabus)`;
        return response;
    }

    extractObjectives(syllabus, course) {
        const text = syllabus.syllabusText;
        let response = `🎯 **Learning Objectives for ${course.name}:**\n\n`;
        
        const objectiveKeywords = ['objective', 'goal', 'learn', 'understand', 'able to', 'will be able', 'student will'];
        
        const lines = syllabus.syllabusText.split(/[\n]+/);
        const objectiveLines = lines.filter(line => {
            const lowerLine = line.toLowerCase();
            return objectiveKeywords.some(kw => lowerLine.includes(kw));
        });
        
        if (objectiveLines.length > 0) {
            objectiveLines.slice(0, 8).forEach(line => {
                const trimmed = line.trim();
                if (trimmed.length > 10) {
                    response += `• ${trimmed}\n`;
                }
            });
        } else {
            // Provide general course description
            if (syllabus.description && syllabus.description.length > 20) {
                response += "**Course Description:**\n";
                response += this.truncateText(syllabus.description, 500) + "\n";
            } else {
                response += "I couldn't find specific learning objectives in the syllabus.\n";
            }
        }
        
        response += `\n👉 [View Full Syllabus](${course.url}/assignments/syllabus)`;
        return response;
    }

    extractKeySections(text) {
        const sections = {};
        const lowerText = text.toLowerCase();
        
        // Try to find overview/description section
        const overviewPatterns = [
            /course\s*description[:\s]*([^]*?)(?=\n\n|course\s*objectives|grading|$)/i,
            /overview[:\s]*([^]*?)(?=\n\n|objectives|grading|$)/i,
            /about\s*this\s*course[:\s]*([^]*?)(?=\n\n|$)/i
        ];
        
        for (const pattern of overviewPatterns) {
            const match = text.match(pattern);
            if (match && match[1] && match[1].length > 30) {
                sections.overview = match[1].trim();
                break;
            }
        }
        
        return sections;
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        
        // Try to cut at a sentence boundary
        const truncated = text.substring(0, maxLength);
        const lastPeriod = truncated.lastIndexOf('.');
        const lastNewline = truncated.lastIndexOf('\n');
        
        const cutPoint = Math.max(lastPeriod, lastNewline);
        if (cutPoint > maxLength * 0.7) {
            return truncated.substring(0, cutPoint + 1);
        }
        
        return truncated + '...';
    }
}

// 2. COURSE NAVIGATOR (For "Math HW" / "Syllabus" / "My Assignments")
class CourseNavigatorTool extends CanvasTool {
    constructor(toolConfig = {}) {
        super(toolConfig);
        this.name = 'CourseNavigator';
        this.sentSyllabi = new Set();
    }

    async execute(message, canvasData) {
        const lowerMsg = message.toLowerCase();
        const course = this.findCourse(message, canvasData);

        // Check if the user is asking for the syllabus
        if (lowerMsg.includes('syllabus')) {
            return this.getSyllabus(course);
        }
        
        // --- FALLBACK: If no course found, check Global Intents ---
        if (!course) {
            if (lowerMsg.includes('grade')) return this.getAllGrades(canvasData);
            
            // ✅ FIX: Use the SHARED logic here too!
            // If user asks "My assignments" and we didn't find a course name, return ALL assignments.
            if (lowerMsg.includes('assign') || lowerMsg.includes('hw') || lowerMsg.includes('due')) {
                const upcoming = this.findUpcomingAssignments(canvasData, 5);
                if (upcoming.length === 0) return "No upcoming assignments found.";
                return "Here are your next assignments across all courses:\n" + 
                       upcoming.map(a => `• **${a.title}** (${a.courseName}) - Due: ${new Date(a.dueDate).toLocaleDateString()}`).join('\n');
            }

            return "I'm not sure which course you mean. Try 'Math assignments' or 'All assignments'.";
        }

        // --- SPECIFIC COURSE FOUND ---
        const wantsSyllabus = lowerMsg.includes('syllabus') || lowerMsg.includes('policy');
        const wantsGrades = lowerMsg.includes('grade');
        const wantsAssignments = lowerMsg.includes('assign') || lowerMsg.includes('hw') || lowerMsg.includes('due');

        // Context Logic
        const shouldSendContext = wantsSyllabus || !this.sentSyllabi.has(course.id);
        let contextBlock = shouldSendContext 
            ? `--- CONTEXT: SYLLABUS ---\nCourse: ${course.name}\nText: "${(course.syllabus || course.description || '').substring(0,1500)}..."\n--- END ---`
            : `[System: Syllabus context for ${course.name} is in history.]`;
        
        if (shouldSendContext) this.sentSyllabi.add(course.id);

        // Data Logic
        let specificData = "";
        let instruction = "Answer based on context.";

        if (wantsGrades) {
            specificData = `\nDATA: Grade is ${course.grade || 'N/A'}%`;
            instruction = "State the grade clearly.";
        } else if (wantsAssignments) {
            // Find assignments for THIS SPECIFIC course
            const allAssignments = this.findUpcomingAssignments(canvasData, 50); // Get all
            const courseAssignments = allAssignments.filter(a => a.courseName === course.name).slice(0, 5);
            
            if (courseAssignments.length === 0) {
                specificData = `\nDATA: No upcoming assignments found specifically for ${course.name}.`;
            } else {
                specificData = `\nDATA: Next assignments for ${course.name}:\n` + 
                               courseAssignments.map(a => `• ${a.title} (${new Date(a.dueDate).toLocaleDateString()})`).join('\n');
            }
            instruction = "List the assignments provided in the DATA section.";
        }

        return `${contextBlock}\n${specificData}\n\nSYSTEM INSTRUCTION: ${instruction}`;
    }

    async getSyllabus(course) {
        if (!course) {
            return "I couldn't find the course you're asking about.";
        }

        // Fetch the syllabus from Canvas API
        const syllabusUrl = `${this.globalConfig.canvasBaseUrl}/api/v1/courses/${course.id}/syllabus`;
        const response = await fetch(syllabusUrl, {
            headers: {
                'Authorization': `Bearer ${await this.getCanvasToken()}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            return "I couldn't fetch the syllabus at the moment. Please try again later.";
        }

        const syllabusData = await response.json();
        return this.formatSyllabusResponse(syllabusData);
    }

    async getCanvasToken() {
        const settings = await chrome.storage.local.get(['canvasToken']);
        return settings.canvasToken;
    }

    formatSyllabusResponse(syllabusData) {
        if (!syllabusData || !syllabusData.body) {
            return "No syllabus content available.";
        }

        return `📚 **Syllabus for ${syllabusData.title}:**\n\n${syllabusData.body}`;
    }

    getAllGrades(canvasData) {
        if (!canvasData.courses) return "No data.";
        return canvasData.courses.filter(c => c.grade).map(c => `**${c.name}**: ${c.grade}%`).join('\n');
    }
}
class DiningMenuTool extends CanvasTool {
    constructor(toolConfig = {}) {
        super(toolConfig);
        this.name = 'DiningMenu';  // 🔥 FIX: Match the naming convention
        this.cache = null;
        this.cacheExpiry = null;
        this.CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
    }
    
    async execute(message, canvasData, context = {}) {
        console.log('🍽️ DiningMenuTool: Processing request...', { message, context });

        try {
            const mealType = context.mealType || this.detectMealType(message); // breakfast/lunch/dinner/null

            console.log('🍽️ DiningMenuTool: Fetching menu via background...', { mealType });

            const response = await chrome.runtime.sendMessage({
                type: 'FETCH_DINING_MENU',
                mealType: mealType,  // pass through
                date: context.date || null
            });

            console.log('🍽️ DiningMenuTool: Response from background:', response);

            if (!response?.success) {
                return this.getFallbackResponse();
            }

            // NEW: background returns an object, not a list
            const menuObj = response.data;

            // Let background format for consistency
            // (We already added formatMenuResponse there; simplest is to call GET_DINING_MENU instead,
            // but to keep changes minimal we’ll format here.)
            return this.formatMenuObject(menuObj, mealType);

        } catch (error) {
            console.error('🍽️ DiningMenuTool: Error:', error);
            return this.getFallbackResponse();
        }
    }

    formatMenuObject(menuObj, mealType = null) {
        if (!menuObj?.success) return this.getFallbackResponse();

        const dateLabel = menuObj.date || 'Today';
        const meals = menuObj.meals || {};
        const mealKey = mealType ? mealType.toLowerCase() : null;

        const pick = mealKey ? { [mealKey]: meals[mealKey] } : meals;

        let out = `🍽️ **Dining Hall Menu** (${dateLabel})\n\n`;

        for (const [meal, items] of Object.entries(pick)) {
            if (!items || items.length === 0) continue;

            out += `**${meal.charAt(0).toUpperCase() + meal.slice(1)}:**\n`;

            // Group items by category
            const byCategory = {};
            items.forEach(it => {
                const cat = (it.category || 'Other').trim();
                if (!byCategory[cat]) byCategory[cat] = [];
                byCategory[cat].push(it);
            });

            // Entree keywords to detect the entree category
            const entreeKeywords = ['entree', 'entrée', 'entre', 'main', 'grill', 'rotisserie'];

            for (const [category, catItems] of Object.entries(byCategory)) {
                const isEntree = entreeKeywords.some(kw => 
                    category.toLowerCase().includes(kw)
                );

                if (isEntree) {
                    out += `\n🌟 **${category}** _(Featured)_\n`;
                } else {
                    out += `\n_${category}:_\n`;
                }

                catItems.slice(0, 15).forEach(it => {
                    const name = it.name || String(it);
                    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(name + ' food')}`;
                    
                    if (isEntree) {
                        out += `⭐ [**${name}**](${googleUrl})\n`;
                    } else {
                        out += `• [${name}](${googleUrl})\n`;
                    }
                });
            }

            out += `\n`;
        }

        if (out.trim() === `🍽️ **Dining Hall Menu** (${dateLabel})`) {
            return this.getFallbackResponse();
        }

        out += `📍 **Full menu:** https://www.sagedining.com/sites/christchurch/menu`;
        return out;
    }
    
    detectMealType(message) {
        if (!message) return null;
        const msg = message.toLowerCase();
        if (msg.includes('breakfast')) return 'breakfast';
        if (msg.includes('lunch')) return 'lunch';
        if (msg.includes('dinner') || msg.includes('supper')) return 'dinner';
        return null;
    }
    
    formatMenuResponse(menuData, mealType = null) {
        console.log('🍽️ DiningMenuTool: Formatting response, items:', menuData?.length);
        
        if (!menuData || menuData.length === 0) {
            return this.getFallbackResponse();
        }
        
        // Check if it's just the fallback message
        if (menuData.length === 1 && menuData[0].category === 'Info') {
            return this.getFallbackResponse();
        }
        
        let response = "🍽️ **Today's Dining Hall Menu**\n\n";
        
        if (mealType) {
            response = `🍽️ **Today's ${mealType.charAt(0).toUpperCase() + mealType.slice(1)} Menu**\n\n`;
        }
        
        menuData.forEach(item => {
            if (item.name && item.name !== 'Menu available on website') {
                response += `• ${item.name}`;
                if (item.category && !['Menu Item', 'Menu', 'Info'].includes(item.category)) {
                    response += ` _(${item.category})_`;
                }
                response += '\n';
            }
        });
        
        response += "\n📍 **Full menu:** https://www.sagedining.com/sites/christchurch/menu";
        
        return response;
    }
    
    getFallbackResponse() {
        return "🍽️ I couldn't fetch the dining menu right now.\n\n" +
               "Please check the menu directly at:\n" +
               "👉 https://www.sagedining.com/sites/christchurch/menu";
    }
}
class AnnouncementTool extends CanvasTool {
    constructor(toolConfig = {}) {
        super(toolConfig);
        this.name = 'AnnouncementReader';
    }

    async execute(message, canvasData) {
        const lowerMsg = message.toLowerCase();
        const announcements = canvasData.announcements || [];

        console.log(`📢 AnnouncementTool: Processing. Total announcements available: ${announcements.length}`);

        // ─── CHECK FOR GMAIL EMAILS ──────────────────────────────────
        const wantsEmail = this.isEmailQuery(lowerMsg);
        let gmailEmails = [];
        let gmailConnected = false;

        try {
            const connCheck = await chrome.runtime.sendMessage({ type: 'GMAIL_CHECK_CONNECTION' });
            gmailConnected = connCheck?.connected || false;
        } catch (e) {
            console.warn('📢 AnnouncementTool: Gmail check failed:', e.message);
        }

        // Fetch Gmail emails if connected and user is asking about announcements/emails
        if (gmailConnected) {
            try {
                const gmailResult = await chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS' });
                if (gmailResult?.success && gmailResult.emails?.length > 0) {
                    gmailEmails = gmailResult.emails;
                    console.log(`📧 AnnouncementTool: Got ${gmailEmails.length} Gmail emails`);
                }
            } catch (e) {
                console.warn('📧 AnnouncementTool: Gmail fetch failed:', e.message);
            }
        }

        // If user specifically asked about emails and Gmail isn't connected
        if (wantsEmail && !gmailConnected) {
            return "📧 Gmail is not connected yet.\n\n" +
                "To see school email announcements, connect your Gmail:\n" +
                "1. Open the extension **Settings** (gear icon)\n" +
                "2. Find the **Gmail Integration** section\n" +
                "3. Click **Connect Gmail**\n\n" +
                "💡 This will let me show you school emails alongside Canvas announcements.";
        }

        // If user specifically asked about emails and we have them
        if (wantsEmail && gmailEmails.length > 0) {
            return this.formatGmailEmails(gmailEmails, message);
        }

        // ─── MERGE CANVAS + GMAIL ────────────────────────────────────
        // Convert Gmail emails to announcement-like format for unified display
        const gmailAsAnnouncements = gmailEmails.map(email => ({
            id: `gmail-${email.id}`,
            title: email.subject || '(No Subject)',
            message: email.snippet || '',
            course: this.extractSenderName(email.from),
            date: email.date ? new Date(email.date).toISOString() : null,
            url: email.gmailUrl,
            author: this.extractSenderName(email.from),
            source: 'gmail'
        }));

        const allAnnouncements = [
            ...announcements.map(a => ({ ...a, source: 'canvas' })),
            ...gmailAsAnnouncements
        ];

        if (allAnnouncements.length === 0) {
            let noDataMsg = "📢 No announcements found.\n\n" +
                "This could mean:\n" +
                "• Your courses haven't posted any announcements recently\n" +
                "• The data hasn't synced yet — try refreshing\n\n" +
                "💡 **Tip:** Click the refresh button in the extension popup to re-sync.";
            
            if (!gmailConnected) {
                noDataMsg += "\n\n📧 **Want email announcements too?** Connect Gmail in Settings.";
            }
            
            return noDataMsg;
        }

        // 1. Check if user wants a specific course's announcements
        const specificCourse = this.findCourse(message, canvasData);

        // 2. Check for time-based filters
        const timeFilter = this.detectTimeFilter(lowerMsg);

        // 3. Check for keyword search
        const searchTerms = this.extractSearchTerms(lowerMsg, specificCourse);

        // 4. Apply filters
        let filtered = [...allAnnouncements];

        if (specificCourse) {
            filtered = filtered.filter(a => {
                const aCourseLower = (a.course || '').toLowerCase();
                return aCourseLower.includes(specificCourse.name.toLowerCase()) ||
                       (specificCourse.subject && aCourseLower.includes(specificCourse.subject));
            });
        }

        if (timeFilter) {
            filtered = filtered.filter(a => {
                if (!a.date) return false;
                const aDate = new Date(a.date);
                return aDate >= timeFilter.start && aDate <= timeFilter.end;
            });
        } else {
            // 🆕 DEFAULT: Only show announcements from the last 14 days
            const twoWeeksAgo = new Date();
            twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
            filtered = filtered.filter(a => {
                if (!a.date) return false;
                return new Date(a.date) >= twoWeeksAgo;
            });
        }

        if (searchTerms.length > 0) {
            filtered = filtered.filter(a => {
                const text = `${a.title} ${a.message}`.toLowerCase();
                return searchTerms.some(term => text.includes(term));
            });
        }

        // 5. Sort by date (newest first)
        filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        // 6. Format response
        if (filtered.length === 0) {
            return this.noResultsResponse(specificCourse, timeFilter, searchTerms, allAnnouncements);
        }

        return this.formatAnnouncements(filtered, specificCourse, timeFilter);
    }

    // ─── NEW HELPER METHODS ──────────────────────────────────────────

    /**
     * Detect if user is specifically asking about emails
     */
    isEmailQuery(msg) {
        const emailKeywords = [
            'email', 'emails', 'gmail', 'inbox', 'mail',
            'school email', 'school emails',
            'email announcement', 'email announcements'
        ];
        return emailKeywords.some(kw => msg.includes(kw));
    }

    /**
     * Extract display name from email "From" header
     * e.g., "John Smith <john@school.org>" → "John Smith"
     */
    extractSenderName(from) {
        if (!from) return 'Unknown Sender';
        const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
        if (nameMatch) return nameMatch[1].trim();
        // If no angle brackets, check for just an email
        const emailMatch = from.match(/([^@]+)@/);
        if (emailMatch) return emailMatch[1].replace(/[._]/g, ' ').trim();
        return from.trim();
    }

    /**
     * Format Gmail emails as a standalone response
     */
    formatGmailEmails(emails, message) {
        const lowerMsg = message.toLowerCase();
        let filtered = [...emails];

        // Apply basic time filter
        if (lowerMsg.includes('today')) {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            filtered = filtered.filter(e => e.date && new Date(e.date) >= todayStart);
        } else if (lowerMsg.includes('this week')) {
            const weekStart = new Date();
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            weekStart.setHours(0, 0, 0, 0);
            filtered = filtered.filter(e => e.date && new Date(e.date) >= weekStart);
        }

        // Sort newest first
        filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        const shown = filtered.slice(0, 15);

        if (shown.length === 0) {
            return "📧 No school emails found for the requested time period.\n\n" +
                "💡 Try: *\"show all emails\"* or *\"emails from this week\"*";
        }

        let response = `📧 **School Emails** — ${filtered.length} found\n\n`;

        shown.forEach((email, idx) => {
            const date = email.date ? new Date(email.date) : null;
            const dateStr = date ? date.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric'
            }) : 'Unknown date';

            const daysAgo = date ? Math.floor((Date.now() - date.getTime()) / (1000*60*60*24)) : null;
            const agoStr = daysAgo !== null 
                ? (daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`) 
                : '';

            const sender = this.extractSenderName(email.from);
            const snippet = email.snippet && email.snippet.length > 120
                ? email.snippet.substring(0, 120).trim() + '...'
                : (email.snippet || '');

            response += `**${idx + 1}. ${email.subject || '(No Subject)'}**\n`;
            response += `📅 ${dateStr} (${agoStr}) — from ${sender}\n`;
            if (snippet) response += `${snippet}\n`;
            if (email.gmailUrl) {
                response += `🔗 [Open in Gmail](${email.gmailUrl})\n`;
            }
            response += `\n`;
        });

        if (filtered.length > 15) {
            response += `_...and ${filtered.length - 15} more emails._\n`;
        }

        return response;
    }

    detectTimeFilter(msg) {
        const now = new Date();

        // "today"
        if (msg.includes('today')) {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            return { start, end: now, label: 'today' };
        }

        // "this week"
        if (msg.includes('this week')) {
            const start = new Date(now);
            start.setDate(now.getDate() - now.getDay()); // Sunday
            start.setHours(0, 0, 0, 0);
            return { start, end: now, label: 'this week' };
        }

        // "last week"
        if (msg.includes('last week')) {
            const end = new Date(now);
            end.setDate(now.getDate() - now.getDay());
            end.setHours(0, 0, 0, 0);
            const start = new Date(end);
            start.setDate(start.getDate() - 7);
            return { start, end, label: 'last week' };
        }

        // "this month"
        if (msg.includes('this month')) {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            return { start, end: now, label: 'this month' };
        }

        // "last month"
        if (msg.includes('last month')) {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
            return { start, end, label: 'last month' };
        }

        // "march" / specific month name
        const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        for (let i = 0; i < months.length; i++) {
            if (msg.includes(months[i])) {
                // Assume current year, or last year if month is in the future
                let year = now.getFullYear();
                if (i > now.getMonth()) year--; // e.g., asking about "October" in March → last year
                const start = new Date(year, i, 1);
                const end = new Date(year, i + 1, 0, 23, 59, 59);
                return { start, end, label: months[i] };
            }
        }

        // "recent" / "latest" → last 30 days
        if (msg.includes('recent') || msg.includes('latest') || msg.includes('new')) {
            const start = new Date(now);
            start.setDate(now.getDate() - 30);
            return { start, end: now, label: 'last 30 days' };
        }

        return null; // No time filter
    }

    extractSearchTerms(msg, course) {
        // Remove common announcement query words to find actual search terms
        const stopWords = [
            'announcement', 'announcements', 'news', 'update', 'updates',
            'bulletin', 'posted', 'show', 'find', 'get', 'list', 'any',
            'what', 'are', 'the', 'there', 'from', 'about', 'for', 'in',
            'my', 'me', 'all', 'recent', 'latest', 'new', 'today',
            'this', 'last', 'week', 'month', 'course', 'class',
            'january','february','march','april','may','june',
            'july','august','september','october','november','december'
        ];

        // Also remove the course name if matched
        let cleaned = msg;
        if (course?.name) {
            cleaned = cleaned.replace(course.name.toLowerCase(), '');
        }
        if (course?.subject) {
            cleaned = cleaned.replace(course.subject.toLowerCase(), '');
        }

        const words = cleaned.split(/\s+/).filter(w => 
            w.length > 2 && !stopWords.includes(w)
        );

        return words;
    }

    formatAnnouncements(announcements, course, timeFilter) {
        const limit = 10;
        const shown = announcements.slice(0, limit);
        const total = announcements.length;

        // Count sources
        const canvasCount = announcements.filter(a => a.source !== 'gmail').length;
        const gmailCount = announcements.filter(a => a.source === 'gmail').length;

        let header = '📢 ';
        if (course) {
            header += `**Announcements for ${course.name}**`;
        } else {
            header += `**Announcements**`;
        }
        if (timeFilter) {
            header += ` (${timeFilter.label})`;
        }
        header += ` — ${total} found`;
        if (canvasCount > 0 && gmailCount > 0) {
            header += ` (${canvasCount} Canvas, ${gmailCount} Email)`;
        }
        header += `\n\n`;

        let response = header;

        shown.forEach((a, idx) => {
            const date = a.date ? new Date(a.date) : null;
            const dateStr = date ? date.toLocaleDateString('en-US', { 
                month: 'short', day: 'numeric', year: 'numeric' 
            }) : 'Unknown date';
            
            const daysAgo = date ? Math.floor((Date.now() - date.getTime()) / (1000*60*60*24)) : null;
            const agoStr = daysAgo !== null ? (daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`) : '';

            // Truncate message preview
            const preview = a.message && a.message.length > 150 
                ? a.message.substring(0, 150).trim() + '...' 
                : (a.message || 'No preview available');

            const authorStr = a.author ? ` by ${a.author}` : '';
            const sourceIcon = a.source === 'gmail' ? '📧' : '📢';

            response += `${sourceIcon} **${idx + 1}. [${a.course}] ${a.title}**\n`;
            response += `📅 ${dateStr} (${agoStr})${authorStr}\n`;
            response += `${preview}\n`;
            if (a.url) {
                const linkLabel = a.source === 'gmail' ? 'Open in Gmail' : 'View full announcement';
                response += `🔗 [${linkLabel}](${a.url})\n`;
            }
            response += `\n`;
        });

        if (total > limit) {
            response += `_...and ${total - limit} more. Ask me to narrow it down by course or date!_\n`;
        }

        return response;
    }

    noResultsResponse(course, timeFilter, searchTerms, allAnnouncements) {
        let response = '📢 No announcements found';
        const conditions = [];

        if (course) conditions.push(`for **${course.name}**`);
        if (timeFilter) conditions.push(`from **${timeFilter.label}**`);
        if (searchTerms.length > 0) conditions.push(`matching "${searchTerms.join(', ')}"`);

        if (conditions.length > 0) {
            response += ' ' + conditions.join(' ');
        }
        response += '.\n\n';

        // Suggest what IS available
        if (allAnnouncements.length > 0) {
            const courseNames = [...new Set(allAnnouncements.map(a => a.course))];
            const oldest = new Date(Math.min(...allAnnouncements.map(a => new Date(a.date || Date.now()))));
            const newest = new Date(Math.max(...allAnnouncements.map(a => new Date(a.date || 0))));

            const canvasCount = allAnnouncements.filter(a => a.source !== 'gmail').length;
            const gmailCount = allAnnouncements.filter(a => a.source === 'gmail').length;

            response += `📊 **What I do have:**\n`;
            response += `• ${allAnnouncements.length} announcements total`;
            if (canvasCount > 0 && gmailCount > 0) {
                response += ` (${canvasCount} Canvas, ${gmailCount} Email)`;
            }
            response += `\n`;
            response += `• From ${oldest.toLocaleDateString()} to ${newest.toLocaleDateString()}\n`;
            response += `• Sources: ${courseNames.slice(0, 5).join(', ')}\n\n`;
            response += `💡 Try: *"show all announcements"* or *"announcements from March"*`;
        }

        return response;
    }

}

// GMAIL EMAIL TOOL - For dedicated "check my email" / "read email" queries
class GmailEmailTool extends CanvasTool {
    constructor(toolConfig = {}) {
        super(toolConfig);
        this.name = 'GmailEmail';
    }

    async execute(message, canvasData, context = {}) {
        const lowerMsg = message.toLowerCase();

        console.log('📧 GmailEmailTool: Processing request');

        // 1. Check Gmail connection
        let gmailConnected = false;
        try {
            const connCheck = await chrome.runtime.sendMessage({ type: 'GMAIL_CHECK_CONNECTION' });
            gmailConnected = connCheck?.connected || false;
        } catch (e) {
            console.warn('📧 GmailEmailTool: Connection check failed:', e.message);
        }

        if (!gmailConnected) {
            return "📧 **Gmail Not Connected**\n\n" +
                "To view your school emails, please connect Gmail in the extension settings:\n" +
                "1. Click the extension icon → Settings\n" +
                "2. Find the **Gmail Integration** section\n" +
                "3. Click **Connect Gmail**\n\n" +
                "This only needs to be done once!";
        }

        // 2. Check if user wants to read a specific email body
        if (context.emailId) {
            return await this.readEmailBody(context.emailId);
        }

        // 3. Fetch emails
        let emails = [];
        let needsReconnect = false;
        try {
            const result = await chrome.runtime.sendMessage({ type: 'GMAIL_FETCH_EMAILS' });
            if (result?.success) {
                emails = result.emails || [];
            } else {
                needsReconnect = result?.needsReconnect || false;
                console.warn('📧 GmailEmailTool: Fetch returned error:', result?.error);
            }
        } catch (e) {
            console.error('📧 GmailEmailTool: Fetch failed:', e.message);
        }

        // ✅ NEW: Handle expired token gracefully
        if (needsReconnect) {
            return "📧 **Gmail Session Expired**\n\n" +
                "Your Gmail connection needs to be refreshed.\n\n" +
                "Please go to **Extension Settings → Gmail Integration** and click **Reconnect Gmail**.\n\n" +
                "This happens occasionally for security reasons.";
        }

        if (emails.length === 0) {
            return "📧 No school emails found in the last week.\n\n" +
                "Try asking: *\"show emails from last month\"* for a wider search.";
        }

        // 4. Apply filters based on message
        let filtered = [...emails];

        // Time filters
        if (lowerMsg.includes('today')) {
            const today = new Date().toDateString();
            filtered = filtered.filter(e => e.date && new Date(e.date).toDateString() === today);
        } else if (lowerMsg.includes('yesterday')) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yStr = yesterday.toDateString();
            filtered = filtered.filter(e => e.date && new Date(e.date).toDateString() === yStr);
        }

        // Sender filter
        const senderKeywords = this.extractSenderFilter(lowerMsg);
        if (senderKeywords) {
            filtered = filtered.filter(e => 
                (e.from || '').toLowerCase().includes(senderKeywords.toLowerCase())
            );
        }

        // Subject keyword filter
        const subjectSearch = this.extractSubjectFilter(lowerMsg);
        if (subjectSearch) {
            filtered = filtered.filter(e => 
                (e.subject || '').toLowerCase().includes(subjectSearch.toLowerCase()) ||
                (e.snippet || '').toLowerCase().includes(subjectSearch.toLowerCase())
            );
        }

        // Sort newest first
        filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        // 5. Format
        return this.formatEmails(filtered, emails.length);
    }

    async readEmailBody(messageId) {
        try {
            const result = await chrome.runtime.sendMessage({
                type: 'GMAIL_GET_EMAIL_BODY',
                messageId
            });

            if (!result?.success) {
                return "📧 I couldn't read that email. It may have been deleted or the connection expired.";
            }

            const body = result.body || result.snippet || 'No content available.';
            // Truncate very long emails
            const truncated = body.length > 2000 
                ? body.substring(0, 2000) + '\n\n_...email truncated. Open in Gmail for full content._'
                : body;

            return `📧 **Email Content:**\n\n${truncated}`;

        } catch (e) {
            return `📧 Error reading email: ${e.message}`;
        }
    }

    extractSenderFilter(msg) {
        // "emails from Mr. Smith" / "emails from smith"
        const fromMatch = msg.match(/(?:from|by)\s+(?:mr\.?|mrs\.?|ms\.?|dr\.?)?\s*(\w+)/i);
        if (fromMatch) return fromMatch[1].toLowerCase();
        return null;
    }

    extractSubjectFilter(msg) {
        // "emails about field trip" / "emails mentioning test"
        const aboutMatch = msg.match(/(?:about|regarding|mentioning|with|subject)\s+(.+?)(?:\?|$)/i);
        if (aboutMatch) return aboutMatch[1].trim().toLowerCase();
        return null;
    }

    formatEmails(emails, totalAvailable) {
        if (emails.length === 0) {
            return "📧 No emails match your search.\n\n" +
                `I have ${totalAvailable} school emails available.\n` +
                "💡 Try: *\"show all emails\"* or *\"emails from today\"*";
        }

        const shown = emails.slice(0, 12);
        let response = `📧 **School Emails** — ${emails.length} found\n\n`;

        shown.forEach((email, idx) => {
            const date = email.date ? new Date(email.date) : null;
            const dateStr = date ? date.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            }) : '';

            const daysAgo = date ? Math.floor((Date.now() - date.getTime()) / (1000*60*60*24)) : null;
            const agoStr = daysAgo !== null
                ? (daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`)
                : '';

            const sender = this.extractSenderDisplay(email.from);
            const snippet = email.snippet && email.snippet.length > 100
                ? email.snippet.substring(0, 100).trim() + '...'
                : (email.snippet || '');

            response += `**${idx + 1}. ${email.subject || '(No Subject)'}**\n`;
            response += `📅 ${dateStr} (${agoStr}) — from ${sender}\n`;
            if (snippet) response += `_${snippet}_\n`;
            if (email.gmailUrl) {
                response += `🔗 [Open in Gmail](${email.gmailUrl})\n`;
            }
            response += `\n`;
        });

        if (emails.length > 12) {
            response += `_...and ${emails.length - 12} more._\n`;
        }

        return response;
    }

    extractSenderDisplay(from) {
        if (!from) return 'Unknown';
        const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
        if (nameMatch) return nameMatch[1].trim();
        const emailMatch = from.match(/([^@]+)@/);
        if (emailMatch) return emailMatch[1].replace(/[._]/g, ' ').trim();
        return from.trim();
    }
}

// COURSE LISTER TOOL - For "What courses am I enrolled in?" queries
class CourseListerTool extends CanvasTool {
    async execute(userMessage, canvasData, context) {
        console.log('📚 CourseListerTool: Listing all enrolled courses');

        const courses = canvasData?.courses || [];

        if (courses.length === 0) {
            return "I don't see any courses in your Canvas data yet. Please try syncing your data first (click the refresh button in the extension popup).";
        }

        let output = `📚 **Your Enrolled Courses** (${courses.length} total)\n\n`;

        // Group by subject category if available
        const bySubject = {};
        courses.forEach(c => {
            const subject = c.subject || 'general';
            if (!bySubject[subject]) bySubject[subject] = [];
            bySubject[subject].push(c);
        });

        const subjectEmojis = {
            'math': '🔢', 'physics': '⚛️', 'chemistry': '🧪', 'biology': '🧬',
            'science': '🔬', 'english': '📖', 'history': '🏛️', 'comp sci': '💻',
            'art': '🎨', 'language': '🌍', 'religion': '⛪', 'pe': '🏃',
            'general': '📁'
        };

        for (const [subject, subjectCourses] of Object.entries(bySubject)) {
            const emoji = subjectEmojis[subject] || '📁';
            
            subjectCourses.forEach(c => {
                const gradeStr = c.grade != null ? ` — Grade: **${c.grade}%**` : '';
                const letterStr = c.letterGrade ? ` (${c.letterGrade})` : '';
                const favStr = c.isFavorite ? ' ⭐' : '';
                const termStr = c.term ? ` [${c.term}]` : '';
                
                output += `${emoji} **${c.name}**${favStr}${termStr}${gradeStr}${letterStr}\n`;
            });
        }

        output += `\n---\n💡 *Ask me about grades, assignments, or syllabus for any specific course!*`;

        return output;
    }
}

// ASSIGNMENT DETAIL TOOL - For "tell me about assignment X" / pasted assignment URLs
class AssignmentDetailTool extends CanvasTool {
    constructor(toolConfig = {}) {
        super(toolConfig);
        this.name = 'AssignmentDetail';
    }

    async execute(message, canvasData, context = {}) {
        console.log('📝 AssignmentDetailTool: Processing request');

        // 1. Try to get courseId + assignmentId from context (URL parsing)
        let courseId = context.courseId || null;
        let assignmentId = context.assignmentId || null;

        // 2. Try to extract from a pasted URL in the message
        if (!courseId || !assignmentId) {
            const urlMatch = this.extractAssignmentUrl(message);
            if (urlMatch) {
                courseId = urlMatch.courseId;
                assignmentId = urlMatch.assignmentId;
            }
        }

        // 3. Try to match by assignment name from cached data
        if (!assignmentId) {
            const matched = this.findAssignmentByName(message, canvasData);
            if (matched) {
                courseId = matched.courseId;
                assignmentId = matched.id;
                console.log(`📝 AssignmentDetailTool: Matched by name: "${matched.title}" (ID: ${assignmentId})`);
            }
        }

        if (!courseId || !assignmentId) {
            return this.noMatchResponse(canvasData);
        }

        // 4. Fetch full detail from background
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'FETCH_ASSIGNMENT_DETAIL',
                courseId: String(courseId),
                assignmentId: String(assignmentId)
            });

            if (!response?.success || !response.data) {
                console.error('📝 AssignmentDetailTool: Fetch failed:', response?.error);
                return `❌ I couldn't fetch the details for that assignment.\n\n**Error:** ${response?.error || 'Unknown error'}\n\nMake sure you're enrolled in the course and the assignment exists.`;
            }

            return this.formatAssignmentDetail(response.data, canvasData);

        } catch (error) {
            console.error('📝 AssignmentDetailTool: Error:', error);
            return `❌ Something went wrong fetching the assignment details.\n\n**Error:** ${error.message}`;
        }
    }

    /**
     * Extract courseId and assignmentId from a Canvas URL in the message.
     * Supports: .../courses/1599/assignments/45663
     */
    extractAssignmentUrl(message) {
        const urlPattern = /courses\/(\d+)\/assignments\/(\d+)/i;
        const match = message.match(urlPattern);
        if (match) {
            return { courseId: match[1], assignmentId: match[2] };
        }
        return null;
    }

    /**
     * Try to match user's message to an assignment in cached canvasData.
     * Uses fuzzy name matching across all known assignments.
     */
    findAssignmentByName(message, canvasData) {
        const assignments = canvasData?.assignments || [];
        const grades = canvasData?.assignmentGrades || [];

        // Combine both sources for broader search
        const allAssignments = [
            ...assignments.map(a => ({ id: a.id, title: a.title || a.name, courseId: a.courseId, courseName: a.courseName })),
            ...grades.map(g => ({ id: g.assignmentId, title: g.assignmentName, courseId: g.courseId, courseName: g.courseName }))
        ];

        // De-duplicate by ID
        const seen = new Set();
        const unique = allAssignments.filter(a => {
            if (!a.id || seen.has(String(a.id))) return false;
            seen.add(String(a.id));
            return true;
        });

        if (unique.length === 0) return null;

        const lowerMsg = this.cleanMessage(message);

        // 1. Exact title match
        let match = unique.find(a => 
            a.title && lowerMsg.includes(a.title.toLowerCase())
        );
        if (match) return match;

        // 2. Fuzzy match — check if most words of an assignment title appear in the message
        let bestMatch = null;
        let bestScore = 0;

        for (const a of unique) {
            if (!a.title) continue;
            const titleWords = a.title.toLowerCase().split(/[\s\-_:,]+/).filter(w => w.length > 2);
            if (titleWords.length === 0) continue;

            const matchedWords = titleWords.filter(w => lowerMsg.includes(w));
            const score = matchedWords.length / titleWords.length;

            // Require at least 50% of title words to match, and at least 2 words
            if (score > bestScore && score >= 0.5 && matchedWords.length >= 2) {
                bestScore = score;
                bestMatch = a;
            }
        }

        // 3. Also check if user mentioned a course name to narrow down
        if (!bestMatch) {
            const courses = canvasData?.courses || [];
            for (const course of courses) {
                const courseName = (course.name || '').toLowerCase();
                const courseSubject = (course.subject || '').toLowerCase();

                if (lowerMsg.includes(courseName) || (courseSubject && lowerMsg.includes(courseSubject))) {
                    // User mentioned a course — find assignments for that course
                    const courseAssignments = unique.filter(a => String(a.courseId) === String(course.id));
                    // Try to match any assignment title word
                    for (const a of courseAssignments) {
                        if (!a.title) continue;
                        const titleWords = a.title.toLowerCase().split(/[\s\-_:,]+/).filter(w => w.length > 3);
                        const matchedWords = titleWords.filter(w => lowerMsg.includes(w));
                        if (matchedWords.length >= 1) {
                            return a;
                        }
                    }
                }
            }
        }

        return bestMatch;
    }

    /**
     * Clean user message by removing common question words.
     */
    cleanMessage(message) {
        const stopWords = [
            'what', 'is', 'the', 'tell', 'me', 'about', 'show', 'details',
            'for', 'of', 'assignment', 'assignments', 'can', 'you', 'please',
            'get', 'fetch', 'find', 'look', 'up', 'info', 'information',
            'describe', 'explain', 'how', 'do', 'i', 'need', 'to', 'on'
        ];
        return message.toLowerCase()
            .split(/\s+/)
            .filter(w => !stopWords.includes(w) || w.length > 4)
            .join(' ');
    }

    /**
     * Format the full assignment detail into a user-friendly response.
     */
    formatAssignmentDetail(detail, canvasData) {
        // Find course name
        const course = canvasData?.courses?.find(c => String(c.id) === String(detail.courseId));
        const courseName = course?.name || 'Unknown Course';

        let response = `📝 **${detail.name}**\n`;
        response += `📚 ${courseName}\n\n`;

        // ── Due Date & Status ──
        if (detail.dueAt) {
            const due = new Date(detail.dueAt);
            const now = new Date();
            const daysUntil = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
            
            let dueEmoji = '📅';
            let dueStatus = '';
            if (daysUntil < 0) {
                dueEmoji = '🔴';
                dueStatus = ` (${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} overdue)`;
            } else if (daysUntil === 0) {
                dueEmoji = '🟠';
                dueStatus = ' (due today!)';
            } else if (daysUntil <= 2) {
                dueEmoji = '🟡';
                dueStatus = ` (in ${daysUntil} day${daysUntil !== 1 ? 's' : ''})`;
            } else {
                dueStatus = ` (in ${daysUntil} days)`;
            }

            response += `${dueEmoji} **Due:** ${due.toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit'
            })}${dueStatus}\n`;
        } else {
            response += `📅 **Due:** No due date set\n`;
        }

        // ── Points ──
        if (detail.pointsPossible != null) {
            response += `📊 **Points:** ${detail.pointsPossible}`;
            if (detail.gradingType && detail.gradingType !== 'points') {
                response += ` (${detail.gradingType})`;
            }
            response += `\n`;
        }

        // ── Submission Status ──
        if (detail.submission) {
            const sub = detail.submission;
            response += `\n--- **Your Submission** ---\n`;

            if (sub.workflowState === 'graded' && sub.score != null) {
                const pct = detail.pointsPossible > 0 
                    ? Math.round((sub.score / detail.pointsPossible) * 100) 
                    : null;
                const emoji = this.getGradeEmoji(pct);
                response += `${emoji} **Score:** ${sub.score}/${detail.pointsPossible}`;
                if (pct != null) response += ` (${pct}%)`;
                if (sub.grade && sub.grade !== String(sub.score)) response += ` — ${sub.grade}`;
                response += `\n`;
            } else if (sub.workflowState === 'submitted') {
                response += `✅ **Status:** Submitted`;
                if (sub.submittedAt) {
                    response += ` on ${new Date(sub.submittedAt).toLocaleDateString()}`;
                }
                response += ` (awaiting grade)\n`;
            } else if (sub.missing) {
                response += `❌ **Status:** Missing\n`;
            } else {
                response += `⬜ **Status:** Not submitted\n`;
            }

            if (sub.late) response += `⏰ **Late submission**\n`;
            if (sub.excused) response += `🔵 **Excused**\n`;
            if (sub.attempt && sub.attempt > 1) response += `🔄 **Attempts:** ${sub.attempt}\n`;

            // Submission comments
            if (sub.submissionComments && sub.submissionComments.length > 0) {
                response += `\n💬 **Comments:**\n`;
                sub.submissionComments.slice(0, 5).forEach(c => {
                    const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '';
                    response += `> **${c.author}** ${date ? `(${date})` : ''}: ${c.comment}\n`;
                });
                if (sub.submissionComments.length > 5) {
                    response += `> _...and ${sub.submissionComments.length - 5} more comments_\n`;
                }
            }

            // Attachments
            if (sub.attachments && sub.attachments.length > 0) {
                response += `\n📎 **Your Files:**\n`;
                sub.attachments.forEach(a => {
                    const sizeStr = a.size ? ` (${this.formatFileSize(a.size)})` : '';
                    response += `• [${a.name}](${a.url})${sizeStr}\n`;
                });
            }
        } else {
            response += `\n⬜ **Status:** Not submitted\n`;
        }

        // ── Description / Instructions ──
        if (detail.description && detail.description.trim().length > 0) {
            response += `\n--- **Instructions** ---\n`;
            const desc = detail.description.length > 1500
                ? detail.description.substring(0, 1500).trim() + '...\n\n_Description truncated. View full instructions on Canvas._'
                : detail.description;
            response += `${desc}\n`;
        }

        // ── Rubric ──
        if (detail.rubric && detail.rubric.length > 0) {
            response += `\n--- **Rubric** ---\n`;
            if (detail.rubricSettings?.title) {
                response += `📋 _${detail.rubricSettings.title}_\n\n`;
            }
            detail.rubric.forEach(criterion => {
                response += `**${criterion.description}** (${criterion.points} pts)\n`;
                if (criterion.longDescription) {
                    response += `_${criterion.longDescription}_\n`;
                }
                if (criterion.ratings && criterion.ratings.length > 0) {
                    criterion.ratings.forEach(r => {
                        response += `  • ${r.description}: ${r.points} pts\n`;
                    });
                }
                response += `\n`;
            });
        }

        // ── Submission Types ──
        if (detail.submissionTypes && detail.submissionTypes.length > 0) {
            const typeLabels = {
                'online_upload': '📄 File Upload',
                'online_text_entry': '✏️ Text Entry',
                'online_url': '🔗 URL',
                'media_recording': '🎥 Media Recording',
                'online_quiz': '📝 Quiz',
                'discussion_topic': '💬 Discussion',
                'external_tool': '🔧 External Tool',
                'on_paper': '📃 On Paper',
                'none': '—  None'
            };
            const types = detail.submissionTypes.map(t => typeLabels[t] || t).join(', ');
            response += `\n📤 **Submission Type:** ${types}\n`;
        }

        // ── Allowed Extensions ──
        if (detail.allowedExtensions && detail.allowedExtensions.length > 0) {
            response += `📁 **Allowed File Types:** ${detail.allowedExtensions.map(e => `.${e}`).join(', ')}\n`;
        }

        // ── Discussion Topic ──
        if (detail.discussionTopic) {
            response += `\n💬 **Discussion:** ${detail.discussionTopic.title || 'Untitled'}\n`;
            if (detail.discussionTopic.message) {
                const msg = detail.discussionTopic.message.length > 300
                    ? detail.discussionTopic.message.substring(0, 300) + '...'
                    : detail.discussionTopic.message;
                response += `${msg}\n`;
            }
        }

        // ── External Tool ──
        if (detail.externalToolUrl) {
            response += `\n🔧 **External Tool:** [Open](${detail.externalToolUrl})\n`;
        }

        // ── Link to Canvas ──
        if (detail.htmlUrl) {
            response += `\n🔗 [**View on Canvas**](${detail.htmlUrl})`;
        }

        return response;
    }

    getGradeEmoji(percentage) {
        if (percentage === null || percentage === undefined) return '❓';
        if (percentage >= 90) return '🌟';
        if (percentage >= 80) return '✅';
        if (percentage >= 70) return '🟡';
        if (percentage >= 60) return '🟠';
        return '🔴';
    }

    formatFileSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    }

    noMatchResponse(canvasData) {
        let response = "📝 I couldn't identify which assignment you're asking about.\n\n";
        response += "**You can:**\n";
        response += "• Paste a Canvas assignment URL (e.g., `.../courses/1599/assignments/45663`)\n";
        response += "• Use the assignment name (e.g., *\"tell me about the lab report\"*)\n";
        response += "• Specify the course (e.g., *\"details on the essay for English\"*)\n";

        // Show a few recent assignments as suggestions
        const assignments = canvasData?.assignments || [];
        if (assignments.length > 0) {
            response += "\n**Recent assignments I know about:**\n";
            assignments.slice(0, 5).forEach(a => {
                response += `• _${a.title}_ (${a.courseName || 'Unknown Course'})\n`;
            });
        }

        return response;
    }
}


// --- TOOL MANAGER ---
class ToolManager {
    constructor(toolConfigs = {}) {
        this.tools = {
            globalPlanner: new GlobalPlannerTool(toolConfigs.globalPlanner),
            blackbaudCalendar: new BlackbaudCalendarTool(toolConfigs.blackbaudCalendar),
            courseNavigator: new CourseNavigatorTool(toolConfigs.courseNavigator),
            announcementReader: new AnnouncementTool(toolConfigs.announcementReader),
            gmailEmail: new GmailEmailTool(toolConfigs.gmailEmail),
            diningMenu:  new DiningMenuTool(toolConfigs.diningMenu),
            gradeAnalyzer: new GradeAnalyzerTool(toolConfigs.gradeAnalyzer),
            syllabusReader: new SyllabusReaderTool(toolConfigs.syllabusReader),
            courseLister: new CourseListerTool(toolConfigs.courseLister),
            assignmentDetail: new AssignmentDetailTool(toolConfigs.assignmentDetail)
        };
    }
    getTool(toolName) { return this.tools[toolName]; }
    async executeTool(toolName, message, canvasData, context = {}) {
        const tool = this.tools[toolName];
        if (!tool) {
            console.warn(`⚠️ ToolManager: Unknown tool "${toolName}", falling back to globalPlanner`);
            return this.tools.globalPlanner.execute(message, canvasData, context);
        }
        
        console.log(`🔧 ToolManager: Executing "${toolName}"`);
        return tool.execute(message, canvasData, context);
    }
}

if (typeof window !== 'undefined') {
    window.ToolManager = ToolManager;
}
