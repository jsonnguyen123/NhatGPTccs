if(window.canvasAIContentScriptLoaded)
    {
        console.log('Canvas AI Assistant: Content script already loaded, skipping...');
    } else {
        window.canvasAIContentScriptLoaded = true;
        window.canvasAgentManagerInstance = null;
        window.canvasDataService = null;
        window.canvasAIChatbot = null;
        
        window.canvasSyncState = {
            status: 'idle',
            progress: 0,
            message: '',
            startTime: null,
            endTime: null
        };
        
        console.log('Canvas AI Assistant: Content script loading...');
        
        class CanvasAPIDataService {
            constructor() {
                this.extractedData = {
                    user: {},
                    courses: [],
                    assignments: [],
                    assignmentGrades: [],
                    announcements: [],
                    calendarEvents: [],
                    plannerOverrides: []
                };
                this.syncInterval = null;
                this.lastSyncTime = null;
                this.init();
            }
        
            async init() {
                console.log('Canvas AI Assistant: Initializing API data service...');
                
                // ✅ CHANGED: Don't auto-sync on init. Just load cached data.
                try {
                    const cached = await chrome.storage.local.get(['canvasData', 'lastUpdate']);
                    
                    if (cached.canvasData) {
                        this.extractedData = cached.canvasData;
                        console.log('Canvas AI Assistant: Loaded cached data from last sync');
                        console.log(`Canvas AI Assistant: Last sync: ${cached.lastUpdate || 'unknown'}`);
                        this.updateSyncState('synced', 100, 'Using cached data');
                    } else {
                        console.log('Canvas AI Assistant: No cached data found. Use the Refresh button in the popup to sync.');
                        this.updateSyncState('idle', 0, 'No data yet - click Refresh to sync');
                    }
    
                    // ✅ Start the 30-minute interval timer (but don't sync immediately)
                    this.startAutoSyncTimer();
                    
                } catch (error) {
                    console.error('Canvas AI Assistant: Failed to load cached data:', error);
                    this.updateSyncState('idle', 0, 'Ready to sync');
                }
            }
    
            // 🆕 SYNC STATE MANAGEMENT (unchanged)
            updateSyncState(status, progress = 0, message = '') {
                window.canvasSyncState = {
                    status: status,
                    progress: progress,
                    message: message,
                    startTime: status === 'syncing' && window.canvasSyncState.status !== 'syncing' 
                        ? Date.now() 
                        : window.canvasSyncState.startTime,
                    endTime: status === 'synced' ? Date.now() : null
                };
                
                console.log(`Canvas AI Sync: ${status} (${progress}%) - ${message}`);
                
                if (chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({
                        type: 'SYNC_STATE_CHANGED',
                        syncState: window.canvasSyncState
                    }).catch(() => {});
                }
                
                window.dispatchEvent(new CustomEvent('canvasSyncStateChanged', {
                    detail: window.canvasSyncState
                }));
                
                this.updateSyncUI();
            }
            
            updateSyncUI() {
                const state = window.canvasSyncState;
                
                const fabStatus = document.querySelector('.canvas-ai-fab-status');
                if (fabStatus) {
                    fabStatus.textContent = state.status === 'syncing' ? '⟳' : 
                                            state.status === 'synced' ? '✓' : 
                                            state.status === 'error' ? '!' : '';
                    fabStatus.className = `canvas-ai-fab-status ${state.status}`;
                }
                
                const chatbotStatus = document.querySelector('.canvas-ai-status');
                if (chatbotStatus) {
                    if (state.status === 'syncing') {
                        chatbotStatus.innerHTML = `<span class="sync-spinner"></span> Syncing... ${state.progress}%`;
                        chatbotStatus.className = 'canvas-ai-status syncing';
                    } else if (state.status === 'synced') {
                        chatbotStatus.innerHTML = '● Online';
                        chatbotStatus.className = 'canvas-ai-status';
                    } else if (state.status === 'error') {
                        chatbotStatus.innerHTML = '● Sync Error';
                        chatbotStatus.className = 'canvas-ai-status error';
                    }
                }
            }
        
            // ✅ CHANGED: Renamed and restructured - only sets up the 30-min timer
            startAutoSyncTimer() {
                console.log('Canvas AI Assistant: Starting 30-minute auto-sync timer');
                
                if (this.syncInterval) {
                    clearInterval(this.syncInterval);
                }
    
                // ✅ 30 minutes, not 15
                this.syncInterval = setInterval(async () => {
                    console.log('Canvas AI Assistant: 30-minute auto-sync triggered');
                    await this.performSync();
                }, 30 * 60 * 1000);
            }
        
            stopAutoSync() {
                if (this.syncInterval) {
                    clearInterval(this.syncInterval);
                    this.syncInterval = null;
                    console.log('Canvas AI Assistant: Auto-sync timer stopped');
                }
            }
    
            // ✅ NEW: Single method that performs sync (called by button OR timer)
            async performSync() {
                try {
                    // ✅ FIX: Check BOTH session and local storage for token
                    const [sessionResult, localResult] = await Promise.all([
                        chrome.storage.session.get(['canvasToken']),
                        chrome.storage.local.get(['canvasToken', 'authStatus'])
                    ]);
                    
                    const hasToken = sessionResult.canvasToken || localResult.canvasToken;
                    const isAuthenticated = localResult.authStatus === 'authenticated';
                    
                    if (!hasToken || !isAuthenticated) {
                        console.log('Canvas AI Assistant: Not authenticated, skipping sync');
                        this.updateSyncState('idle', 0, 'Not authenticated');
                        return false;
                    }
    
                    console.log('Canvas AI Assistant: Starting sync...');
                    await this.extractAllData();
                    return true;
                    
                } catch (error) {
                    console.error('Canvas AI Assistant: Sync failed:', error);
                    this.updateSyncState('error', 0, error.message);
                    return false;
                }
            }
        
            setupCleanup() {
                window.addEventListener('beforeunload', () => {
                    this.stopAutoSync();
                });
            }
        
            isCanvasDomain() {
                return window.location.hostname.includes('instructure.com');
            }
        
            async makeAPIRequest(endpoint, params = {}) {
                try {
                    console.log(`Content: Making API request to ${endpoint}`);
                    
                    const response = await chrome.runtime.sendMessage({
                        type: 'MAKE_CANVAS_API_REQUEST',
                        endpoint: endpoint,
                        params: params
                    });
            
                    if (!response) {
                        throw new Error('No response received from background script');
                    }
            
                    if (response.error || response.success === false) {
                        throw new Error(`API Error: ${response.error}`);
                    }
            
                    console.log(`Content: API request successful for ${endpoint}`);
                    return response.data;
                    
                } catch (error) {
                    console.error(`Content: API request failed for ${endpoint}:`, error);
                    throw error;
                }
            }
        
            async extractAllData() {
                try {
                    console.log('Canvas AI Assistant: Starting data extraction...');
                    this.updateSyncState('syncing', 0, 'Starting data sync...');
            
                    // ── PHASE 1: Profile + Courses (parallel) ──
                    this.updateSyncState('syncing', 5, 'Loading profile & courses...');
            
                    const [profileResult, coursesResult] = await Promise.allSettled([
                        this.extractUserData(),
                        this.extractCourses()
                    ]);
            
                    if (coursesResult.status === 'rejected') {
                        throw new Error('Failed to load courses: ' + coursesResult.reason?.message);
                    }
            
                    // ── PHASE 2: Grades + Planner + Syllabi (parallel) ──
                    this.updateSyncState('syncing', 20, 'Loading grades & planner...');
            
                    await Promise.allSettled([
                        this.extractGrades(),
                        this.extractPlannerOverrides(),
                        this.extractCourseSyllabi()
                    ]);
            
                    await this.storeData();
            
                    // ── PHASE 3: Assignments ──
                    this.updateSyncState('syncing', 40, 'Loading assignments...');
                    await this.extractAssignmentsAndGradesCombined();
            
                    // ── PHASE 4: Announcements + Calendar (parallel) ──
                    this.updateSyncState('syncing', 85, 'Loading announcements & calendar...');
            
                    await Promise.allSettled([
                        this.extractAnnouncements(),
                        this.extractCalendarEvents()
                    ]);
            
                    // ── FINALIZE ──
                    this.updateSyncState('syncing', 98, 'Finalizing...');
                    await this.storeData();
                    this.notifyDataReady();
            
                    this.updateSyncState('synced', 100, 'Data sync complete');
                    this.lastSyncTime = Date.now();
            
                    console.log('Canvas AI Assistant: Sync completed');
            
                } catch (error) {
                    console.error('Canvas AI Assistant: Data extraction failed:', error);
                    this.updateSyncState('error', 0, error.message);
                    throw error;
                }
            }
    
            async extractPlannerOverrides() {
                try {
                    const overrides = await this.makeAPIRequest('/planner/overrides', { per_page: 100 });
                    this.extractedData.plannerOverrides = overrides;
                    console.log(`Canvas AI Assistant: Found ${overrides.length} planner overrides.`);
                } catch (error) {
                    console.warn('Canvas AI Assistant: Failed to extract planner overrides:', error);
                    this.extractedData.plannerOverrides = []; 
                }
            }
        
            async extractUserData() {
                try {
                    const profile = await this.makeAPIRequest('/users/self/profile');
                    this.extractedData.user = {
                        id: profile.id,
                        name: profile.name,
                        email: profile.primary_email,
                        avatar: profile.avatar_url,
                        extractedAt: new Date().toISOString()
                    };
                } catch (error) {
                    console.error('Canvas AI Assistant: Failed to extract user data:', error);
                    throw error;
                }
            }
        
            async extractCourses() {
                try {
                    const courses = await this.makeAPIRequest('/courses', {
                        enrollment_state: 'active',
                        include: ['total_scores', 'term', 'favorites'],
                        per_page: 50
                    });
                    
                    const subjectMap = {
                        'math': ['calculus', 'algebra', 'geometry', 'statistics', 'trigonometry', 'precalc', 'math'],
                        'physics': ['physics'],
                        'chemistry': ['chemistry', 'chem'],
                        'biology': ['biology', 'bio', 'anatomy'],
                        'science': ['environmental', 'science', 'forensics'],
                        'english': ['literature', 'composition', 'lang', 'lit', 'reading', 'english', 'writing'],
                        'history': ['government', 'world', 'us history', 'european', 'civics', 'econ', 'history', 'humanities'],
                        'comp sci': ['computer', 'programming', 'java', 'python', 'web', 'tech'],
                        'art': ['design', 'drawing', 'painting', 'sculpture', 'music', 'band', 'art', 'theater'],
                        'language': ['spanish', 'french', 'latin', 'chinese', 'german', 'japanese'],
                        'religion': ['bible', 'religion', 'theology', 'chapel'],
                        'pe': ['physical education', 'pe', 'health', 'fitness', 'athletics']
                    };
        
                    const detectSubject = (name) => {
                        const lowerName = (name || '').toLowerCase();
                        for (const [subject, keywords] of Object.entries(subjectMap)) {
                            if (keywords.some(k => lowerName.includes(k))) return subject;
                        }
                        return 'general'; 
                    };
        
                    // ✅ FIX: Accept courses that are 'available' OR where you have an active enrollment
                    // Canvas returns courses you're enrolled in when using enrollment_state=active,
                    // but workflow_state can vary (available, unpublished, etc.)
                    const validStates = ['available', 'unpublished', 'claimed'];
                    
                    this.extractedData.courses = courses
                        .filter(c => {
                            // If workflow_state exists, check it; otherwise trust enrollment_state filter
                            if (c.workflow_state && !validStates.includes(c.workflow_state)) {
                                // Still include if there's an active enrollment
                                const hasActiveEnrollment = c.enrollments && c.enrollments.length > 0;
                                if (!hasActiveEnrollment) {
                                    console.log(`Canvas AI: Skipping course "${c.name}" (state: ${c.workflow_state}, no enrollment)`);
                                    return false;
                                }
                            }
                            return true;
                        })
                        .map(course => ({
                            id: String(course.id),
                            name: course.name,
                            code: course.course_code,
                            subject: detectSubject(course.name || ''),
                            url: `https://christchurchschool.instructure.com/courses/${course.id}`,
                            isFavorite: course.is_favorite,
                            grade: course.enrollments?.[0]?.grades?.current_score ?? null,
                            letterGrade: course.enrollments?.[0]?.grades?.current_grade ?? null,
                            term: course.term?.name,
                            workflowState: course.workflow_state
                        }));
                    
                    console.log(`Canvas AI Assistant: Extracted ${this.extractedData.courses.length} courses:`);
                    this.extractedData.courses.forEach(c => {
                        console.log(`  • ${c.name} (ID: ${c.id}, Grade: ${c.grade ?? 'N/A'}, State: ${c.workflowState})`);
                    });
                    
                } catch (error) {
                    console.error('Canvas AI Assistant: Failed to extract courses:', error);
                    throw error;
                }
            }
    
            async extractAssignmentsAndGradesCombined() {
                try {
                    this.extractedData.assignments = [];
                    this.extractedData.assignmentGrades = [];
            
                    const cached = await chrome.storage.local.get(['assignmentGrades', 'assignmentGradesLastFetch']);
                    const ONE_HOUR = 60 * 60 * 1000;
                    const useGradeCache = cached.assignmentGradesLastFetch && 
                                          (Date.now() - cached.assignmentGradesLastFetch) < ONE_HOUR &&
                                          cached.assignmentGrades?.length > 0;
            
                    if (useGradeCache) {
                        this.extractedData.assignmentGrades = cached.assignmentGrades;
                    }
            
                    const totalCourses = this.extractedData.courses.length;
                    const processedIds = new Set();
                    const gradeEntries = [];
                    const startOfToday = new Date();
                    startOfToday.setHours(0, 0, 0, 0);
            
                    const BATCH_SIZE = 4;
            
                    for (let batchStart = 0; batchStart < totalCourses; batchStart += BATCH_SIZE) {
                        const batch = this.extractedData.courses.slice(batchStart, batchStart + BATCH_SIZE);
                        const progress = 40 + Math.floor((batchStart / totalCourses) * 45);
                        this.updateSyncState('syncing', progress, `Loading: ${batch.map(c => c.name).join(', ')}...`);
            
                        const batchResults = await Promise.allSettled(
                            batch.map(course => this.fetchCourseAssignments(course))
                        );
            
                        batchResults.forEach((result) => {
                            if (result.status !== 'fulfilled' || !result.value) return;
                            const { course, assignments } = result.value;
            
                            assignments.forEach(item => {
                                const dueDate = item.due_at ? new Date(item.due_at) : null;
                                const isOverdue = dueDate && startOfToday > dueDate;
                                const sub = item.submission;
            
                                if (!item.id || processedIds.has(item.id)) return;
                                processedIds.add(item.id);
            
                                // 🔍 DEBUG: Log every assignment to see what's happening
                                console.log(`📋 ASSIGNMENT DEBUG: "${item.name}" | due_at: ${item.due_at} | points: ${item.points_possible} | sub_state: ${sub?.workflow_state}`);

                                if (item.points_possible && item.points_possible > 0) {
                                    const isSubmitted = sub && 
                                        (sub.workflow_state === 'submitted' || sub.workflow_state === 'graded');
                                    const isOldOverdue = isOverdue && sub && sub.workflow_state !== 'missing';
                                    
                                    // Skip assignments with no due date
                                    if (!item.due_at) {
                                        console.log(`   ⛔ SKIPPED (no due date): "${item.name}"`);
                                        return;
                                    }
                                    
                                    if (!isSubmitted && !isOldOverdue) {
                                        console.log(`   ✅ ADDED to assignments: "${item.name}"`);
                                        this.extractedData.assignments.push({
                                            id: String(item.id),
                                            title: item.name,
                                            courseId: course.id,
                                            courseName: course.name,
                                            dueDate: item.due_at,
                                            points: item.points_possible,
                                            url: item.html_url,
                                            status: this.determineAssignmentStatus(item),
                                            description: item.description,
                                            submissionTypes: item.submission_types || []
                                        });
                                    }
                                }
            
                                if (!useGradeCache && sub) {
                                    gradeEntries.push({
                                        assignmentId: String(item.id),
                                        assignmentName: item.name || 'Unknown Assignment',
                                        courseId: String(course.id),
                                        courseName: course.name,
                                        score: sub.score,
                                        grade: sub.grade,
                                        pointsPossible: item.points_possible,
                                        percentage: (sub.score != null && item.points_possible > 0)
                                            ? Math.round((sub.score / item.points_possible) * 100) : null,
                                        gradedAt: sub.graded_at,
                                        submittedAt: sub.submitted_at,
                                        dueAt: item.due_at,
                                        workflowState: sub.workflow_state,
                                        late: sub.late || false,
                                        missing: sub.missing || false,
                                        excused: sub.excused || false,
                                        comments: []
                                    });
                                }
                            });
                        });
            
                        if (batchStart + BATCH_SIZE < totalCourses) {
                            await new Promise(r => setTimeout(r, 150));
                        }
                    }
                    // 🔍 DEBUG: Final assignment list
                    console.log(`🔍 FINAL ASSIGNMENTS (${this.extractedData.assignments.length}):`);
                    this.extractedData.assignments.forEach(a => {
                        console.log(`   • "${a.title}" | dueDate: ${a.dueDate} | course: ${a.courseName}`);
                    });

                    if (!useGradeCache) {
                        for (const course of this.extractedData.courses.slice(0, 10)) {
                            try {
                                // Paginate to get ALL submissions, not just first 100
                                let page = 1;
                                let hasMore = true;
                                
                                while (hasMore) {
                                    const submissions = await this.makeAPIRequest(
                                        `/courses/${course.id}/students/submissions`,
                                        {
                                            student_ids: ['self'],
                                            include: ['assignment'],
                                            per_page: 100,
                                            page: page
                                        }
                                    );
                        
                                    if (!Array.isArray(submissions) || submissions.length === 0) {
                                        hasMore = false;
                                        break;
                                    }
                        
                                    for (const sub of submissions) {
                                        if (!sub || !sub.assignment) continue;
                                        const item = sub.assignment;
                        
                                        const key = `${course.id}-${item.id}`;
                                        if (processedIds.has(key)) continue;
                                        processedIds.add(key);
                        
                                        gradeEntries.push({
                                            assignmentId: String(item.id),
                                            assignmentName: item.name || 'Unknown Assignment',
                                            courseId: String(course.id),
                                            courseName: course.name,
                                            score: sub.score,
                                            grade: sub.grade,
                                            pointsPossible: item.points_possible,
                                            percentage: (sub.score != null && item.points_possible > 0)
                                                ? Math.round((sub.score / item.points_possible) * 100) : null,
                                            gradedAt: sub.graded_at,
                                            submittedAt: sub.submitted_at,
                                            dueAt: item.due_at,
                                            workflowState: sub.workflow_state,
                                            late: sub.late || false,
                                            missing: sub.missing || false,
                                            excused: sub.excused || false,
                                            comments: []
                                        });
                                    }
                        
                                    // If we got fewer than 100, we're on the last page
                                    if (submissions.length < 100) {
                                        hasMore = false;
                                    } else {
                                        page++;
                                    }
                                    
                                    // Small delay between pages to avoid rate limiting
                                    if (hasMore) {
                                        await new Promise(r => setTimeout(r, 100));
                                    }
                                }
                            } catch (err) {
                                console.warn(`Canvas AI: Gradebook fetch failed for ${course.name}:`, err.message);
                            }
                        }
                    }
                    
                    // IMPORTANT: Store grade entries and save to cache
                    if (!useGradeCache && gradeEntries.length > 0) {
                        this.extractedData.assignmentGrades = this.removeDuplicateGrades(gradeEntries);
                        await chrome.storage.local.set({
                            assignmentGrades: this.extractedData.assignmentGrades,
                            assignmentGradesLastFetch: Date.now()
                        });
                        console.log(`Canvas AI: Stored ${this.extractedData.assignmentGrades.length} grade entries`);
                    }
            
                } catch (error) {
                    console.error('Canvas AI Assistant: Combined assignment extraction failed:', error);
                }
            }
            
            async fetchCourseAssignments(course) {
                try {
                    const assignments = await this.makeAPIRequest(`/courses/${course.id}/assignments`, {
                        include: ['submission'],
                        order_by: 'due_at',
                        per_page: 100
                    });
                    if (!assignments || !Array.isArray(assignments)) return { course, assignments: [] };
                    return { course, assignments };
                } catch (error) {
                    console.warn(`Skipping assignments for ${course.name}: ${error.message}`);
                    return { course, assignments: [] };
                }
            }
            
            removeDuplicateGrades(grades) {
                const seen = new Set();
                return grades.filter(grade => {
                    const key = `${grade.courseId}-${grade.assignmentId}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            }
    
            async extractGrades() {
                try {
                    const enrollments = await this.makeAPIRequest('/users/self/enrollments', {
                        state: ['active'],
                        type: ['StudentEnrollment']
                    });
        
                    if (!Array.isArray(enrollments)) return;
        
                    enrollments.forEach(enrollment => {
                        const courseId = enrollment.course_id;
                        const grades = enrollment.grades;
                        if (!grades) return;
        
                        const courseIndex = this.extractedData.courses.findIndex(c => String(c.id) === String(courseId));
                        if (courseIndex !== -1 && grades.current_score !== undefined) {
                            this.extractedData.courses[courseIndex].grade = grades.current_score;
                        }
                    });
                } catch (error) {
                    console.error('Canvas AI Assistant: Failed to extract grades:', error);
                }
            }
    
            async extractCourseSyllabi() {
                try {
                    const cached = await chrome.storage.local.get(['courseSyllabi', 'syllabiLastFetch']);
                    const ONE_DAY = 24 * 60 * 60 * 1000;
            
                    if (cached.syllabiLastFetch && (Date.now() - cached.syllabiLastFetch) < ONE_DAY && cached.courseSyllabi) {
                        this.extractedData.courseSyllabi = cached.courseSyllabi;
                        return;
                    }
            
                    const syllabi = {};
                    const courses = this.extractedData.courses;
                    const BATCH_SIZE = 5;
            
                    for (let i = 0; i < courses.length; i += BATCH_SIZE) {
                        const batch = courses.slice(i, i + BATCH_SIZE);
                        const results = await Promise.allSettled(
                            batch.map(course =>
                                this.makeAPIRequest(`/courses/${course.id}`, {
                                    include: ['syllabus_body', 'description']
                                }).then(data => ({ course, data }))
                            )
                        );
            
                        results.forEach(result => {
                            if (result.status === 'fulfilled' && result.value?.data) {
                                const { course, data } = result.value;
                                const syllabusHtml = data.syllabus_body || '';
                                syllabi[course.id] = {
                                    courseId: String(course.id),
                                    courseName: course.name,
                                    syllabusHtml,
                                    syllabusText: this.stripHtml(syllabusHtml),
                                    description: this.stripHtml(data.description || ''),
                                    hasSyllabus: syllabusHtml.length > 0,
                                    fetchedAt: new Date().toISOString()
                                };
                            } else {
                                const course = batch[results.indexOf(result)];
                                syllabi[course.id] = {
                                    courseId: String(course.id), courseName: course.name,
                                    syllabusHtml: '', syllabusText: '', description: '',
                                    hasSyllabus: false, error: result.reason?.message || 'Unknown error'
                                };
                            }
                        });
            
                        if (i + BATCH_SIZE < courses.length) await new Promise(r => setTimeout(r, 100));
                    }
            
                    this.extractedData.courseSyllabi = syllabi;
                    await chrome.storage.local.set({ courseSyllabi: syllabi, syllabiLastFetch: Date.now() });
                } catch (error) {
                    console.error('Canvas AI Assistant: Failed to extract syllabi:', error);
                    this.extractedData.courseSyllabi = {};
                }
            }
        
            determineAssignmentStatus(assignment) {
                const submission = assignment.submission;
                const now = new Date();
                const due = assignment.due_at ? new Date(assignment.due_at) : null;
                if (submission && submission.workflow_state === 'submitted') return 'submitted';
                if (submission && submission.workflow_state === 'graded') return 'graded';
                if (due && now > due) return 'missing';
                return 'upcoming';
            }
        
            stripHtml(html) {
                if (!html) return '';
                const temp = document.createElement('div');
                temp.innerHTML = html;
                return temp.textContent || temp.innerText || '';
            }
    
            async extractAnnouncements() {
                try {
                    if (!this.extractedData.courses || this.extractedData.courses.length === 0) return;
    
                    const contextCodes = this.extractedData.courses.slice(0, 10).map(c => `course_${c.id}`);
                    const startDate = new Date();
                    startDate.setDate(startDate.getDate() - 14);
    
                    const announcements = await this.makeAPIRequest('/announcements', {
                        context_codes: contextCodes,
                        start_date: startDate.toISOString(),
                        end_date: new Date().toISOString(),
                        active_only: true,
                        per_page: 10
                    });
                    
                    this.extractedData.announcements = announcements.map(a => {
                        const courseIdStr = a.context_code.split('_')[1];
                        const course = this.extractedData.courses.find(c => String(c.id) === String(courseIdStr));
                        return {
                            id: String(a.id), title: a.title,
                            message: this.stripHtml(a.message),
                            course: course ? course.name : 'Unknown Course',
                            date: a.posted_at, url: a.url, author: a.user_name
                        };
                    });
                } catch (error) {
                    console.warn('Canvas AI Assistant: Failed to extract announcements:', error);
                    this.extractedData.announcements = [];
                }
            }
        
            async extractCalendarEvents() {
                try {
                    const allEvents = [];
                    
                    try {
                        const upcomingEvents = await this.makeAPIRequest('/users/self/upcoming_events', { per_page: 50 });
                        allEvents.push(...upcomingEvents.map(e => ({ ...e, source: 'upcoming' })));
                    } catch (e) { /* non-critical */ }
                    
                    try {
                        if (this.extractedData.courses.length > 0) {
                            const contextCodes = this.extractedData.courses.slice(0, 10).map(c => `course_${c.id}`);
                            const calendarEvents = await this.makeAPIRequest('/calendar_events', {
                                type: 'event', context_codes: contextCodes,
                                start_date: new Date().toISOString(),
                                end_date: new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)).toISOString(),
                                per_page: 50
                            });
                            allEvents.push(...calendarEvents.map(e => ({ ...e, source: 'calendar' })));
                        }
                    } catch (e) { /* non-critical */ }
                    
                    try {
                        const todoItems = await this.makeAPIRequest('/users/self/todo', { per_page: 50 });
                        allEvents.push(...todoItems.map(todo => ({
                            id: `todo-${todo.assignment?.id || todo.id}`,
                            title: `Todo: ${todo.assignment?.name || todo.title}`,
                            start_at: todo.assignment?.due_at || todo.due_at,
                            end_at: todo.assignment?.due_at || todo.due_at,
                            html_url: todo.assignment?.html_url || todo.html_url,
                            context_name: todo.context_name, type: 'assignment', source: 'todo'
                        })));
                    } catch (e) { /* non-critical */ }
                    
                    if (this.extractedData.assignments?.length > 0) {
                        allEvents.push(...this.extractedData.assignments
                            .filter(a => a.dueDate)
                            .map(a => ({
                                id: `assignment-${a.id}`, title: `Due: ${a.title}`,
                                start_at: a.dueDate, end_at: a.dueDate,
                                html_url: a.url, context_name: a.courseName,
                                type: 'assignment', source: 'generated'
                            })));
                    }
                    
                    const uniqueEvents = this.removeDuplicateEvents(allEvents);
                    this.extractedData.calendarEvents = uniqueEvents.map(e => ({
                        id: String(e.id), title: e.title || e.name || 'Untitled Event',
                        start: e.start_at || e.start, end: e.end_at || e.end,
                        url: e.html_url || e.url, course: e.context_name || 'Unknown Course',
                        type: e.type || 'event', source: e.source || 'unknown'
                    }));
                } catch (error) {
                    this.extractedData.calendarEvents = [];
                }
            }
            
            removeDuplicateEvents(events) {
                const seen = new Set();
                return events.filter(e => {
                    const key = `${e.id}-${e.title}-${e.start_at}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            }
        
            async storeData() {
                try {
                    await chrome.storage.local.set({
                        'canvasData': this.extractedData,
                        'lastUpdate': new Date().toISOString()
                    });
                    console.log('Canvas AI Assistant: Data stored successfully');
                } catch (error) {
                    console.error('Canvas AI Assistant: Error storing data:', error);
                    throw error;
                }
            }
        
            notifyDataReady() {
                if (chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({
                        type: 'CANVAS_DATA_READY',
                        data: this.extractedData
                    }).catch(() => {});
                }
                window.dispatchEvent(new CustomEvent('canvasDataReady', {
                    detail: this.extractedData
                }));
            }
        }
        
        // Initialize the service
        (function() {
            function init() {
                if (!window.canvasDataService) {
                    window.canvasDataService = new CanvasAPIDataService();
                }
        
                window.injectChatbotContainer = async function() {
                    try {
                        console.log('Content: Attempting to open chatbot...');
                        
                        // ✅ REMOVED: No more sync-in-progress overlay blocking the chatbot
                        // Chatbot always opens immediately with cached data
                        
                        const existing = document.getElementById('canvas-ai-assistant');
                        if (existing) {
                            existing.classList.remove('hidden');
                            existing.style.display = 'flex';
                            return;
                        }
        
                        const cssUrl = chrome.runtime.getURL('chatbot.css');
                        if (!document.querySelector(`link[href="${cssUrl}"]`)) {
                            const link = document.createElement('link');
                            link.rel = 'stylesheet';
                            link.href = cssUrl;
                            link.type = 'text/css';
                            document.head.appendChild(link);
                        }
        
                        const htmlUrl = chrome.runtime.getURL('chatbot.html');
                        const res = await fetch(htmlUrl);
                        if (!res.ok) throw new Error('Failed to fetch chatbot.html: ' + res.status);
                        const htmlText = await res.text();
        
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(htmlText, 'text/html');
                        let node = doc.querySelector('#canvas-ai-assistant') || doc.body;

                        const logoImages = document.querySelectorAll('#canvas-ai-assistant .header-logo-img');
                        logoImages.forEach(img => {
                            img.src = chrome.runtime.getURL('final-school-logo.png');
                        });
        
                        const injected = node.cloneNode(true);
                        document.body.appendChild(injected);
        
                        setTimeout(() => {
                            if (typeof CanvasAIChatbotInterface !== 'undefined') {
                                if (!window.canvasAIChatbot) {
                                    window.canvasAIChatbot = new CanvasAIChatbotInterface();
                                } else {
                                    window.canvasAIChatbot.init();
                                }
                            }
                        }, 100);
        
                    } catch (error) {
                        console.error('Content: Error injecting chatbot container:', error);
                    }
                };
            }
        
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
            } else {
                init();
            }
        })();
        
        // Message handling
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'ping') {
                sendResponse({ success: true, message: 'Content script is alive' });
                return true;
            }
            
            if (request.action === 'openChatbot') {
                try {
                    injectChatbotContainer();
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
                return true;
            }
            
            if (request.type === 'GET_SYNC_STATE') {
                sendResponse({ success: true, syncState: window.canvasSyncState });
                return true;
            }
    
            // ✅ NEW: Handle manual sync trigger from popup
            if (request.type === 'TRIGGER_MANUAL_SYNC') {
                console.log('Content: Manual sync triggered from popup');
                if (window.canvasDataService) {
                    window.canvasDataService.performSync()
                        .then(() => sendResponse({ success: true, message: 'Sync complete' }))
                        .catch(err => sendResponse({ success: false, error: err.message }));
                } else {
                    sendResponse({ success: false, error: 'Data service not initialized' });
                }
                return true;
            }
            
            if (request.type === 'AGENT_PROCESS_QUERY') {
                if (window.canvasAgentManagerInstance) {
                    window.canvasAgentManagerInstance.processQuery(request.message, request.canvasData)
                        .then(result => sendResponse({ success: true, result }))
                        .catch(error => sendResponse({ success: false, error: error.message }));
                } else {
                    sendResponse({ success: false, error: 'Agent manager not initialized' });
                }
                return true;
            }
            
            sendResponse({ success: false, error: 'Unknown action' });
        });
    }