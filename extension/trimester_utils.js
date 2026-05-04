(function attachTrimesterUtils(globalScope) {
    const SCHOOL_YEAR_START_MONTH = 7; // Month index 7 = August
    const SCHOOL_YEAR_START_DAY = 20;
    const SCHOOL_YEAR_END_MONTH = 5; // Month index 5 = June
    const SCHOOL_YEAR_END_DAY = 25;

    function createLocalDate(year, month, day) {
        const date = new Date(year, month, day);
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function normalizeDateOnly(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function buildTrimesterInfo(trimesterNumber, startYear) {
        return {
            trimester: trimesterNumber,
            code: `T${trimesterNumber}`,
            label: `Trimester ${trimesterNumber}`,
            academicYear: `${startYear}-${startYear + 1}`
        };
    }

    function resolveSchoolYearStartYear(date) {
        const year = date.getFullYear();
        const currentSchoolYearStart = createLocalDate(year, SCHOOL_YEAR_START_MONTH, SCHOOL_YEAR_START_DAY);
        return date >= currentSchoolYearStart ? year : year - 1;
    }

    function resolveTrimesterCode(trimester) {
        if (typeof trimester === 'string' && /^T[123]$/i.test(trimester)) {
            return trimester.toUpperCase();
        }
        if ([1, 2, 3].includes(Number(trimester))) {
            return `T${Number(trimester)}`;
        }
        if (trimester && typeof trimester === 'object') {
            return resolveTrimesterCode(trimester.code || trimester.trimester);
        }
        return null;
    }

    function getTrimesterForDate(value) {
        const date = normalizeDateOnly(value);
        if (!date) return null;

        const startYear = resolveSchoolYearStartYear(date);
        const schoolYearStart = createLocalDate(startYear, SCHOOL_YEAR_START_MONTH, SCHOOL_YEAR_START_DAY);
        const trimesterOneEnd = createLocalDate(startYear, 10, 30);
        const trimesterTwoStart = createLocalDate(startYear, 11, 1);
        const trimesterTwoEnd = createLocalDate(startYear + 1, 2, 14);
        const trimesterThreeStart = createLocalDate(startYear + 1, 2, 15);
        const schoolYearEnd = createLocalDate(startYear + 1, SCHOOL_YEAR_END_MONTH, SCHOOL_YEAR_END_DAY);
        const nextSchoolYearStart = createLocalDate(startYear + 1, SCHOOL_YEAR_START_MONTH, SCHOOL_YEAR_START_DAY);

        if (date >= schoolYearStart && date <= trimesterOneEnd) {
            return buildTrimesterInfo(1, startYear);
        }

        if (date >= trimesterTwoStart && date <= trimesterTwoEnd) {
            return buildTrimesterInfo(2, startYear);
        }

        if (date >= trimesterThreeStart && date <= schoolYearEnd) {
            return buildTrimesterInfo(3, startYear);
        }

        if (date > schoolYearEnd && date < nextSchoolYearStart) {
            return buildTrimesterInfo(3, startYear);
        }

        return null;
    }

    function getAssignmentDueDate(item, currentDate) {
        return item?.due_at ?? item?.dueAt ?? item?.dueDate ?? currentDate;
    }

    function filterByTrimester(items, trimester, options = {}) {
        if (!Array.isArray(items)) return [];

        const trimesterCode = resolveTrimesterCode(trimester);
        if (!trimesterCode) {
            return [...items];
        }

        const currentDate = options.currentDate ? new Date(options.currentDate) : new Date();
        const getDate = typeof options.getDate === 'function'
            ? options.getDate
            : (item) => getAssignmentDueDate(item, currentDate);

        return items.filter(item => {
            const dateValue = getDate(item, currentDate) ?? currentDate;
            const trimesterInfo = getTrimesterForDate(dateValue);
            return trimesterInfo?.code === trimesterCode;
        });
    }

    globalScope.TrimesterUtils = {
        getTrimesterForDate,
        getCurrentTrimester(referenceDate = new Date()) {
            return getTrimesterForDate(referenceDate);
        },
        filterByTrimester,
        resolveTrimesterCode
    };
})(globalThis);
