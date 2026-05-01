const MAX_BINARY_SEARCH_ITERATIONS = 25;
const SPARKLINE_VERTICAL_PADDING = 12;
const SPARKLINE_OFFSET = 6;

class AcademicDashboard {
    constructor() {
        this.canvasData = null;
        this.lastUpdate = null;
        this.briefing = null;
        this.selectedTarget = null;
        this.simulatorCache = new Map();
        this.simulatorRows = [];
        this.simulatorMeta = null;
        this.init();
    }

    async init() {
        this.cacheElements();
        this.bindEvents();
        await this.loadCachedData();
        this.renderHeader();
        this.renderGradeTrends();
        this.renderWeeklyWorkloadChart();
        this.renderCourseHealthGrid();
        this.renderRecentActivity();
        this.populateCourseSelector();
        await Promise.all([
            this.loadAcademicBriefing(),
            this.initializeSimulator()
        ]);
    }

    cacheElements() {
        this.studentNameEl = document.getElementById('student-name');
        this.currentDateEl = document.getElementById('current-date');
        this.lastSyncEl = document.getElementById('last-sync');
        this.briefingSummaryEl = document.getElementById('briefing-summary');
        this.gradeTrendsEl = document.getElementById('grade-trends');
        this.workloadChartEl = document.getElementById('workload-chart');
        this.courseHealthGridEl = document.getElementById('course-health-grid');
        this.recentActivityListEl = document.getElementById('recent-activity-list');
        this.courseSelectorEl = document.getElementById('course-selector');
        this.resetSimulatorEl = document.getElementById('reset-simulator');
        this.simulatorOverallGradeEl = document.getElementById('simulator-overall-grade');
        this.remainingWorkSummaryEl = document.getElementById('remaining-work-summary');
        this.simulatorTableBodyEl = document.getElementById('simulator-table-body');
        this.targetButtonGroupEl = document.getElementById('target-button-group');
        this.targetGradeOutputEl = document.getElementById('target-grade-output');
        this.refreshBriefingEl = document.getElementById('refresh-briefing');
        this.openSettingsEl = document.getElementById('open-settings');
    }

    bindEvents() {
        this.courseSelectorEl.addEventListener('change', () => this.handleCourseSelection());
        this.resetSimulatorEl.addEventListener('click', () => this.resetSimulator());
        this.targetButtonGroupEl.addEventListener('click', (event) => {
            const button = event.target.closest('.target-button');
            if (!button) return;
            this.selectedTarget = Number(button.dataset.target);
            [...this.targetButtonGroupEl.querySelectorAll('.target-button')].forEach(item => {
                item.classList.toggle('active', item === button);
            });
            this.updateTargetGradeOutput();
        });
        this.refreshBriefingEl.addEventListener('click', () => this.loadAcademicBriefing(true));
        this.openSettingsEl.addEventListener('click', () => chrome.runtime.openOptionsPage());
    }

    async sendMessage(message) {
        const response = await chrome.runtime.sendMessage(message);
        if (!response?.success) {
            throw new Error(response?.error || 'Request failed');
        }
        return response;
    }

    async loadCachedData() {
        try {
            const response = await this.sendMessage({ type: 'GET_CACHED_DATA' });
            this.canvasData = response.data || {
                user: null,
                courses: [],
                assignments: [],
                assignmentGrades: [],
                announcements: [],
                calendarEvents: []
            };
            this.lastUpdate = response.lastUpdate || null;
        } catch (error) {
            console.error('Dashboard: Failed to load cached data', error);
            this.canvasData = {
                user: null,
                courses: [],
                assignments: [],
                assignmentGrades: [],
                announcements: [],
                calendarEvents: []
            };
            this.lastUpdate = null;
        }
    }

    renderHeader() {
        this.studentNameEl.textContent = this.canvasData?.user?.name || 'Academic Overview';
        this.currentDateEl.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        this.lastSyncEl.textContent = this.lastUpdate ? this.formatRelativeTime(this.lastUpdate) : 'Not synced';
    }

    async loadAcademicBriefing(forceRefresh = false) {
        if (forceRefresh) {
            this.briefingSummaryEl.textContent = 'Refreshing your academic briefing.';
        }

        try {
            const response = await this.sendMessage({ type: 'GET_ACADEMIC_BRIEFING' });
            this.briefing = response.data;
            this.briefingSummaryEl.textContent = response.data.summary;
        } catch (error) {
            console.error('Dashboard: Failed to load academic briefing', error);
            this.briefingSummaryEl.textContent = 'Academic briefing is unavailable right now. The dashboard visuals below still reflect your latest synced data.';
        }
    }

    renderGradeTrends() {
        const courses = this.canvasData?.courses || [];
        const grades = this.canvasData?.assignmentGrades || [];
        if (courses.length === 0) {
            this.gradeTrendsEl.innerHTML = '<div class="empty-state">No course grade history is available yet.</div>';
            return;
        }

        const cards = courses.map(course => {
            const courseGrades = grades
                .filter(grade => String(grade.courseId) === String(course.id) && Number.isFinite(Number(grade.percentage)))
                .sort((firstGrade, secondGrade) => this.getGradeSortTimestamp(firstGrade) - this.getGradeSortTimestamp(secondGrade))
                .slice(-6);

            const values = courseGrades.map(grade => Number(grade.percentage));
            const chart = values.length >= 2 ? this.buildSparkline(values) : '<div class="empty-state">Need at least two graded items to show a trend.</div>';
            const trendDelta = values.length >= 2 ? values[values.length - 1] - values[0] : 0;
            const trendClass = trendDelta > 1 ? 'trend-up' : trendDelta < -1 ? 'trend-down' : 'trend-flat';
            const trendLabel = trendDelta > 1 ? `▲ ${Math.abs(trendDelta).toFixed(0)} pts` : trendDelta < -1 ? `▼ ${Math.abs(trendDelta).toFixed(0)} pts` : 'Flat';

            return `
                <article class="trend-card">
                    <div class="health-top">
                        <div>
                            <h3>${this.escapeHtml(course.name)}</h3>
                            <p class="meta-text">Last ${values.length || 0} graded items</p>
                        </div>
                        <strong class="${trendClass}">${trendLabel}</strong>
                    </div>
                    ${chart}
                </article>
            `;
        });

        this.gradeTrendsEl.innerHTML = cards.join('');
    }

    renderWeeklyWorkloadChart() {
        const assignments = (this.canvasData?.assignments || []).filter(assignment => assignment.dueDate);
        if (assignments.length === 0) {
            this.workloadChartEl.innerHTML = '<div class="empty-state">No upcoming assignments are available for this week.</div>';
            return;
        }

        const startOfWeek = new Date();
        startOfWeek.setHours(0, 0, 0, 0);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

        const dayBuckets = Array.from({ length: 7 }, (_, index) => {
            const dayDate = new Date(startOfWeek);
            dayDate.setDate(startOfWeek.getDate() + index);
            return {
                label: dayDate.toLocaleDateString('en-US', { weekday: 'short' }),
                date: dayDate,
                total: 0,
                count: 0
            };
        });

        assignments.forEach(assignment => {
            const dueDate = new Date(assignment.dueDate);
            const diff = Math.floor((dueDate.setHours(0, 0, 0, 0) - startOfWeek.getTime()) / (1000 * 60 * 60 * 24));
            if (diff >= 0 && diff < 7) {
                dayBuckets[diff].count += 1;
                dayBuckets[diff].total += this.computePriorityScore(assignment);
            }
        });

        const maxTotal = Math.max(...dayBuckets.map(bucket => bucket.total), 1);
        this.workloadChartEl.innerHTML = dayBuckets.map(bucket => {
            const height = Math.max((bucket.total / maxTotal) * 100, bucket.total > 0 ? 12 : 8);
            return `
                <div class="workload-day">
                    <div class="workload-bar-wrap">
                        <div class="workload-bar" style="height:${height}%"></div>
                    </div>
                    <strong>${bucket.label}</strong>
                    <span class="chart-caption">${bucket.count} item${bucket.count === 1 ? '' : 's'}</span>
                </div>
            `;
        }).join('');
    }

    renderCourseHealthGrid() {
        const courses = this.canvasData?.courses || [];
        const assignments = this.canvasData?.assignments || [];
        const grades = this.canvasData?.assignmentGrades || [];
        if (courses.length === 0) {
            this.courseHealthGridEl.innerHTML = '<div class="empty-state">No courses are available yet.</div>';
            return;
        }

        this.courseHealthGridEl.innerHTML = courses.map(course => {
            const nearestAssignment = assignments
                .filter(assignment => String(assignment.courseId) === String(course.id) && assignment.dueDate && new Date(assignment.dueDate) >= new Date())
                .sort((firstAssignment, secondAssignment) => new Date(firstAssignment.dueDate) - new Date(secondAssignment.dueDate))[0];
            const courseGrades = grades
                .filter(grade => String(grade.courseId) === String(course.id) && Number.isFinite(Number(grade.percentage)))
                .sort((firstGrade, secondGrade) => new Date(firstGrade.gradedAt || firstGrade.dueAt || 0) - new Date(secondGrade.gradedAt || secondGrade.dueAt || 0));
            const latestValues = courseGrades.slice(-2).map(grade => Number(grade.percentage));
            const trendDelta = latestValues.length === 2 ? latestValues[1] - latestValues[0] : 0;
            const trendClass = trendDelta > 1 ? 'trend-up' : trendDelta < -1 ? 'trend-down' : 'trend-flat';
            const trendArrow = trendDelta > 1 ? '▲' : trendDelta < -1 ? '▼' : '■';
            const deadlineText = nearestAssignment
                ? `${nearestAssignment.title} · ${this.formatShortDate(nearestAssignment.dueDate)}`
                : 'No upcoming deadlines';

            return `
                <article class="health-card">
                    <div class="health-top">
                        <div>
                            <h3>${this.escapeHtml(course.name)}</h3>
                            <p class="meta-text">Nearest deadline</p>
                        </div>
                        <span class="${trendClass}">${trendArrow}</span>
                    </div>
                    <div class="health-grade">${Number.isFinite(Number(course.grade)) ? `${Math.round(Number(course.grade))}%` : '--'}</div>
                    <p class="meta-text ${trendClass}">${trendDelta === 0 ? 'Stable trend' : `${trendDelta > 0 ? 'Up' : 'Down'} ${Math.abs(trendDelta).toFixed(0)} pts`}</p>
                    <p class="meta-text" style="margin-top: 10px;">${this.escapeHtml(deadlineText)}</p>
                </article>
            `;
        }).join('');
    }

    renderRecentActivity() {
        const assignments = (this.canvasData?.assignments || [])
            .filter(assignment => assignment.dueDate && new Date(assignment.dueDate) > new Date())
            .sort((firstAssignment, secondAssignment) => new Date(firstAssignment.dueDate) - new Date(secondAssignment.dueDate))
            .slice(0, 6);

        if (assignments.length === 0) {
            this.recentActivityListEl.innerHTML = '<div class="empty-state">No recent activity. Visit Canvas and sync your data to populate this section.</div>';
            return;
        }

        this.recentActivityListEl.innerHTML = assignments.map(assignment => `
            <div class="activity-row">
                <div>
                    <div class="activity-title">${this.escapeHtml(assignment.title)}</div>
                    <div class="meta-text">${this.escapeHtml(assignment.courseName || 'Unknown Course')}</div>
                </div>
                <div style="text-align:right;">
                    <div class="activity-date">${this.formatShortDate(assignment.dueDate)}</div>
                    ${assignment.url ? `<button data-url="${this.escapeHtml(assignment.url)}" class="activity-open">Open</button>` : ''}
                </div>
            </div>
        `).join('');

        this.recentActivityListEl.querySelectorAll('.activity-open').forEach(button => {
            button.addEventListener('click', () => chrome.tabs.create({ url: button.dataset.url }));
        });
    }

    populateCourseSelector() {
        const courses = this.canvasData?.courses || [];
        if (courses.length === 0) {
            this.courseSelectorEl.innerHTML = '<option value="">No courses available</option>';
            this.courseSelectorEl.disabled = true;
            return;
        }

        this.courseSelectorEl.disabled = false;
        this.courseSelectorEl.innerHTML = courses
            .map(course => `<option value="${this.escapeHtml(course.id)}">${this.escapeHtml(course.name)}</option>`)
            .join('');
    }

    async initializeSimulator() {
        if (!this.courseSelectorEl.value) {
            this.renderSimulatorPlaceholder('Sync your Canvas data to start using the simulator.');
            return;
        }
        await this.handleCourseSelection();
    }

    async handleCourseSelection() {
        const courseId = this.courseSelectorEl.value;
        if (!courseId) {
            this.renderSimulatorPlaceholder('Choose a course to load the grade simulator.');
            return;
        }

        if (!this.simulatorCache.has(courseId)) {
            try {
                const response = await this.sendMessage({ type: 'GET_COURSE_SIMULATOR_DATA', courseId });
                this.simulatorCache.set(courseId, response.data);
            } catch (error) {
                console.error('Dashboard: Failed to load simulator data', error);
                this.renderSimulatorPlaceholder('The grade simulator could not load this course right now.');
                return;
            }
        }

        const cached = this.simulatorCache.get(courseId);
        this.simulatorMeta = cached;
        this.simulatorRows = cached.rows.map(row => ({ ...row }));
        this.renderSimulator();
    }

    resetSimulator() {
        if (!this.simulatorMeta) return;
        this.simulatorRows = this.simulatorMeta.rows.map(row => ({ ...row }));
        this.renderSimulator();
    }

    renderSimulator() {
        if (!this.simulatorMeta || this.simulatorRows.length === 0) {
            this.renderSimulatorPlaceholder('No assignment data is available for this course.');
            return;
        }

        const overallGrade = this.calculateOverallGrade(this.simulatorRows);
        const remainingPoints = this.simulatorRows
            .filter(row => row.isPending)
            .reduce((sum, row) => sum + Number(row.possible || 0), 0);

        this.simulatorOverallGradeEl.textContent = Number.isFinite(overallGrade) ? `${overallGrade.toFixed(1)}%` : '--';
        this.remainingWorkSummaryEl.textContent = `${Math.round(remainingPoints)} pts across ${this.simulatorRows.filter(row => row.isPending).length} assignments`;

        this.simulatorTableBodyEl.innerHTML = this.simulatorRows.map(row => {
            const contribution = this.calculateContribution(row, this.simulatorRows);
            const isEdited = !row.isPending && row.actualEarned != null && Number(row.earned) !== Number(row.actualEarned);
            const gradePercent = Number.isFinite(Number(row.earned)) && Number(row.possible) > 0
                ? `${((Number(row.earned) / Number(row.possible)) * 100).toFixed(1)}%`
                : '<span class="pending-badge">Pending</span>';
            const contributionText = contribution == null ? '—' : `${contribution.toFixed(1)}%`;
            const weightText = Number(row.categoryWeight) > 0 ? `${Number(row.categoryWeight).toFixed(0)}%` : 'Points';

            return `
                <tr class="grade-row ${row.isPending ? 'pending' : ''} ${isEdited ? 'edited' : ''}" data-assignment-id="${row.assignmentId}">
                    <td>
                        <div class="activity-title">${this.escapeHtml(row.title)}</div>
                        <div class="meta-text">${row.dueDate ? this.formatShortDate(row.dueDate) : 'No due date'}</div>
                    </td>
                    <td>${this.escapeHtml(row.category)}</td>
                    <td>
                        ${row.isPending
                            ? '<span class="pending-badge">Pending</span>'
                            : `<input class="earned-input" type="number" min="0" step="0.1" value="${Number(row.earned).toFixed(1).replace(/\.0$/, '')}" data-assignment-id="${row.assignmentId}">`
                        }
                    </td>
                    <td>${Number(row.possible || 0).toFixed(1).replace(/\.0$/, '')}</td>
                    <td><span class="weight-chip">${weightText}</span></td>
                    <td>${gradePercent}</td>
                    <td>${contributionText}</td>
                </tr>
            `;
        }).join('');

        this.simulatorTableBodyEl.querySelectorAll('.earned-input').forEach(input => {
            input.addEventListener('input', () => {
                const row = this.simulatorRows.find(item => item.assignmentId === input.dataset.assignmentId);
                if (!row) return;
                const value = Number(input.value);
                row.earned = Number.isFinite(value) ? Math.max(0, Math.min(value, Number(row.possible || value))) : row.actualEarned;
                this.renderSimulator();
            });
        });

        this.updateTargetGradeOutput();
    }

    renderSimulatorPlaceholder(message) {
        this.simulatorOverallGradeEl.textContent = '--';
        this.remainingWorkSummaryEl.textContent = '--';
        this.simulatorTableBodyEl.innerHTML = `<tr><td colspan="7"><div class="empty-state">${this.escapeHtml(message)}</div></td></tr>`;
        this.targetGradeOutputEl.textContent = 'Select a target grade to calculate what you need on remaining work.';
    }

    updateTargetGradeOutput() {
        if (!this.selectedTarget) {
            this.targetGradeOutputEl.textContent = 'Select a target grade to calculate what you need on remaining work.';
            return;
        }

        const result = this.calculateTargetRequirement(this.simulatorRows, this.selectedTarget);
        if (result.status === 'achieved') {
            this.targetGradeOutputEl.textContent = 'You have already reached this target. Maintain your current average to keep it.';
            return;
        }

        if (result.status === 'impossible') {
            this.targetGradeOutputEl.textContent = 'This target cannot be reached based on available remaining assignments.';
            return;
        }

        this.targetGradeOutputEl.textContent = `To reach ${result.label}, you need an average of ${result.requiredAverage.toFixed(1)}% on remaining work (${Math.round(result.remainingPoints)} pts total).`;
    }

    calculateTargetRequirement(rows, targetPercent) {
        const currentOverall = this.calculateOverallGrade(rows);
        const remainingRows = rows.filter(row => row.isPending && Number(row.possible) > 0);
        const remainingPoints = remainingRows.reduce((sum, row) => sum + Number(row.possible), 0);

        const labelMap = {
            93: 'A (93%)',
            90: 'A- (90%)',
            87: 'B+ (87%)',
            83: 'B (83%)',
            80: 'B- (80%)',
            77: 'C+ (77%)',
            73: 'C (73%)'
        };

        if (Number.isFinite(currentOverall) && currentOverall >= targetPercent) {
            return { status: 'achieved', label: labelMap[targetPercent], remainingPoints };
        }

        if (remainingPoints <= 0) {
            return { status: 'impossible', label: labelMap[targetPercent], remainingPoints };
        }

        const maxRows = rows.map(row => row.isPending ? { ...row, earned: Number(row.possible) } : row);
        if (this.calculateOverallGrade(maxRows) < targetPercent) {
            return { status: 'impossible', label: labelMap[targetPercent], remainingPoints };
        }

        let low = 0;
        let high = 100;
        for (let iteration = 0; iteration < MAX_BINARY_SEARCH_ITERATIONS; iteration += 1) {
            const mid = (low + high) / 2;
            const projectedRows = rows.map(row => row.isPending
                ? { ...row, earned: Number(row.possible) * (mid / 100) }
                : row
            );
            const projectedOverall = this.calculateOverallGrade(projectedRows);
            if (projectedOverall >= targetPercent) {
                high = mid;
            } else {
                low = mid;
            }
        }

        return {
            status: 'needed',
            label: labelMap[targetPercent],
            requiredAverage: high,
            remainingPoints
        };
    }

    calculateOverallGrade(rows) {
        const gradedRows = rows.filter(row => Number.isFinite(Number(row.earned)) && Number(row.possible) > 0);
        if (gradedRows.length === 0) return null;

        const hasWeights = this.simulatorMeta?.weightingMode === 'weighted' && gradedRows.some(row => Number(row.categoryWeight) > 0);
        if (!hasWeights) {
            const earned = gradedRows.reduce((sum, row) => sum + Number(row.earned), 0);
            const possible = gradedRows.reduce((sum, row) => sum + Number(row.possible), 0);
            return possible > 0 ? (earned / possible) * 100 : null;
        }

        const groupMap = new Map();
        gradedRows.forEach(row => {
            const key = row.categoryId || row.category;
            const existing = groupMap.get(key) || {
                weight: Number(row.categoryWeight) || 0,
                earned: 0,
                possible: 0
            };
            existing.earned += Number(row.earned);
            existing.possible += Number(row.possible);
            groupMap.set(key, existing);
        });

        let weightedSum = 0;
        let totalWeight = 0;
        groupMap.forEach(group => {
            if (group.possible <= 0 || group.weight <= 0) return;
            weightedSum += (group.earned / group.possible) * 100 * group.weight;
            totalWeight += group.weight;
        });

        if (totalWeight <= 0) {
            const earned = gradedRows.reduce((sum, row) => sum + Number(row.earned), 0);
            const possible = gradedRows.reduce((sum, row) => sum + Number(row.possible), 0);
            return possible > 0 ? (earned / possible) * 100 : null;
        }

        return weightedSum / totalWeight;
    }

    calculateContribution(row, rows) {
        if (row.isPending || !Number.isFinite(Number(row.earned)) || Number(row.possible) <= 0) {
            return null;
        }

        const hasWeights = this.simulatorMeta?.weightingMode === 'weighted' && rows.some(item => Number(item.categoryWeight) > 0);
        if (!hasWeights) {
            const totalPossible = rows
                .filter(item => !item.isPending && Number(item.possible) > 0)
                .reduce((sum, item) => sum + Number(item.possible), 0);
            return totalPossible > 0 ? (Number(row.earned) / totalPossible) * 100 : null;
        }

        const activeGroups = new Map();
        rows.filter(item => !item.isPending && Number(item.possible) > 0).forEach(item => {
            const key = item.categoryId || item.category;
            const current = activeGroups.get(key) || { weight: Number(item.categoryWeight) || 0, possible: 0 };
            current.possible += Number(item.possible);
            activeGroups.set(key, current);
        });

        const totalWeight = [...activeGroups.values()].reduce((sum, item) => sum + (item.weight > 0 ? item.weight : 0), 0);
        const group = activeGroups.get(row.categoryId || row.category);
        if (!group || group.possible <= 0 || totalWeight <= 0 || Number(row.categoryWeight) <= 0) {
            return null;
        }

        return (Number(row.earned) / group.possible) * (Number(row.categoryWeight) / totalWeight) * 100;
    }

    computePriorityScore(assignment) {
        const dueDate = assignment?.dueDate ? new Date(assignment.dueDate) : null;
        const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 99;
        const points = Number(assignment?.points || 0);
        let score = 8;
        if (daysUntilDue <= 0) score += 20;
        else if (daysUntilDue === 1) score += 16;
        else if (daysUntilDue <= 3) score += 12;
        else if (daysUntilDue <= 7) score += 8;
        if (points >= 100) score += 10;
        else if (points >= 50) score += 6;
        else if (points >= 20) score += 3;
        return score;
    }

    buildSparkline(values) {
        const width = 220;
        const height = 72;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        const stepX = values.length === 1 ? width : width / (values.length - 1);
        const points = values.map((value, index) => {
            const x = index * stepX;
            const y = height - (((value - min) / range) * (height - SPARKLINE_VERTICAL_PADDING) + SPARKLINE_OFFSET);
            return { x, y };
        });
        const line = points.map(point => `${point.x},${point.y}`).join(' ');
        const fill = `M ${points[0].x} ${height} L ${line.replace(/,/g, ' ')} L ${points[points.length - 1].x} ${height} Z`;
        const circles = points.map(point => `<circle cx="${point.x}" cy="${point.y}" r="3"></circle>`).join('');
        return `
            <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
                <path class="fill" d="${fill}"></path>
                <path class="line" d="M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}"></path>
                ${circles}
            </svg>
        `;
    }

    formatShortDate(value) {
        return new Date(value).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
    }

    getGradeSortTimestamp(grade) {
        const timestamp = grade?.gradedAt || grade?.dueAt;
        if (!timestamp) return Number.MAX_SAFE_INTEGER;
        const parsed = new Date(timestamp).getTime();
        return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
    }

    formatRelativeTime(value) {
        const diffMinutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
        if (diffMinutes < 1) return 'just now';
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)}h ago`;
        return `${Math.round(diffMinutes / 1440)}d ago`;
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AcademicDashboard();
});
