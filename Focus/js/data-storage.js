const APP_DATA_LOCAL_KEYS = Object.freeze({
    calendar: 'focus_calendar',
    tasks: 'focus_tasks',
    notes: 'focus_notes',
    journals: 'focus_journals',
    books: 'focus_books',
    study: 'focus_study',
    timetable: 'focus_timetable',
    results: 'focus_results',
    pomoStats: 'focus_pomo_stats',
    preferences: 'focus_theme_preference'
});

const APP_DATA_PENDING_KEY = 'focus_pending_sync_sections';

function readPendingSections() {
    try {
        const sections = JSON.parse(localStorage.getItem(APP_DATA_PENDING_KEY) || '[]');
        return Array.isArray(sections)
            ? sections.filter(section => Object.hasOwn(APP_DATA_LOCAL_KEYS, section))
            : [];
    } catch {
        return [];
    }
}

let appDataSyncReady = false;
let appDataSyncTimers = {};
let appDataSyncQueues = {};
const appDataOfflineChanges = new Set(readPendingSections());
let appDataSyncStatus = 'Not connected';
let appDataSyncHasError = false;

function persistPendingSections() {
    localStorage.setItem(APP_DATA_PENDING_KEY, JSON.stringify([...appDataOfflineChanges]));
}

function markSectionPending(section) {
    appDataOfflineChanges.add(section);
    persistPendingSections();
}

function markSectionSynced(section) {
    appDataOfflineChanges.delete(section);
    persistPendingSections();
}

function markSectionSyncedIfUnchanged(section, syncedData) {
    const latestData = getLocalSectionData()[section];
    if (JSON.stringify(latestData) === JSON.stringify(syncedData)) {
        markSectionSynced(section);
    } else {
        markSectionPending(section);
    }
}

function syncErrorMessage(response, fallback) {
    if (response.status === 401) {
        return 'Sync is unavailable. Your changes are saved on this device.';
    }
    if (response.status === 413) return 'This data is too large to sync. Reduce its size and try again.';
    if (response.status === 429) return 'Sync is temporarily busy. Please try again shortly.';
    if (response.status >= 500) {
        return 'Sync is temporarily unavailable. Your changes are saved on this device.';
    }
    return fallback;
}

function assertSyncResponse(response, fallback) {
    if (!response.ok) throw new Error(syncErrorMessage(response, fallback));
}

function syncFailureMessage(error, fallback) {
    if (error instanceof Error && error.message.startsWith('This data is too large to sync.')) {
        return error.message;
    }
    return fallback;
}

function setAppDataSyncStatus(message, isError = false) {
    if (isError) appDataSyncHasError = true;
    if (message === 'Your data is up to date.' && appDataSyncHasError) return;
    appDataSyncStatus = message;
    ['data-sync-status', 'settings-data-sync'].forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        element.textContent = message;
        element.classList.toggle('text-red-500', isError);
        element.classList.toggle('text-mono-400', !isError);
    });
}

function getLocalSectionData() {
    const data = {};
    for (const [section, key] of Object.entries(APP_DATA_LOCAL_KEYS)) {
        const rawValue = localStorage.getItem(key);
        if (section === 'preferences') {
            data.preferences = { theme: rawValue || 'system' };
        } else if (rawValue === null) {
            data[section] = section === 'timetable'
                ? {}
                : section === 'pomoStats'
                    ? { sessions: 0, totalMinutes: 0 }
                    : [];
        } else {
            try {
                data[section] = JSON.parse(rawValue);
            } catch {
                throw new Error(`Local ${section} data is not valid JSON and cannot be synced.`);
            }
        }
    }
    return data;
}

async function fetchAppData(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(appApiUrl(url), {
            ...options,
            headers: {
                ...(options.headers || {}),
                Authorization: `******`
            },
            signal: controller.signal
        });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('application/json') && !url.endsWith('/file')) {
            throw new Error('The app data API did not return JSON. Open Focus from the backend server URL.');
        }
        return response;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function hydrateAppData(data) {
    state.calendar = data.calendar;
    state.tasks = data.tasks;
    state.notes = data.notes;
    state.journals = data.journals;
    state.books = data.books;
    state.studyPlans = data.study;
    state.timetable = data.timetable;
    state.results = data.results;
    state.pomoStats = { sessions: 0, totalMinutes: 0, ...data.pomoStats };
    state.theme = data.preferences.theme || 'system';
    books = state.books;

    for (const [section, key] of Object.entries(APP_DATA_LOCAL_KEYS)) {
        const value = section === 'preferences' ? state.theme : data[section];
        localStorage.setItem(key, section === 'preferences' ? value : JSON.stringify(value));
    }
    renderBooks();
}

async function loadAppDataFromDatabase() {
    appDataSyncReady = false;
    setAppDataSyncStatus('Connecting to your account...');
    try {
        let response = await fetchAppData('/api/data');
        let result = await response.json();
        assertSyncResponse(response, 'Could not load your data. Please try again.');

        if (!result.initialized) {
            const localData = getLocalSectionData();
            response = await fetchAppData('/api/data/bootstrap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: localData })
            });
            result = await response.json();
            if (response.status === 409) {
                response = await fetchAppData('/api/data');
                result = await response.json();
            } else if (!response.ok) {
                assertSyncResponse(response, 'Could not transfer your browser data. Your local copy is safe.');
            } else {
                response = await fetchAppData('/api/data');
                result = await response.json();
            }
            assertSyncResponse(response, 'Could not load your data. Please try again.');
        }

        if (!result.initialized || !result.data) {
            throw new Error('Your data is not ready to sync yet. Please try again.');
        }
        const localData = getLocalSectionData();
        const pendingSections = [...appDataOfflineChanges];
        if (pendingSections.length) {
            for (const section of pendingSections) result.data[section] = localData[section];
        }
        hydrateAppData(result.data);
        appDataSyncReady = true;
        for (const section of pendingSections) {
            const data = section === 'preferences'
                ? { theme: state.theme }
                : section === 'study'
                    ? state.studyPlans
                    : state[section];
            response = await fetchAppData(`/api/data/${section}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data })
            });
            assertSyncResponse(response, 'Could not sync your changes. Your local copy is safe.');
            markSectionSyncedIfUnchanged(section, data);
        }
        appDataSyncHasError = appDataOfflineChanges.size > 0;
        setAppDataSyncStatus(appDataOfflineChanges.size
            ? 'Some changes are still waiting to sync. Your local copy is safe.'
            : 'Your data is up to date.', appDataOfflineChanges.size > 0);
        if (typeof migrateLegacyBookFiles === 'function') {
            try {
                await migrateLegacyBookFiles();
            } catch (error) {
                setAppDataSyncStatus('Your data is synced, but some book files could not be transferred. Try again later.', true);
            }
        }
        return true;
    } catch (error) {
        setAppDataSyncStatus(syncFailureMessage(
            error,
            'Sync is temporarily unavailable. Your changes are saved on this device.'
        ), true);
        return false;
    }
}

async function retryAppDataSync() {
    let offlineChanges = [];
    setAppDataSyncStatus('Syncing your data...');
    try {
        await Promise.all(Object.values(appDataSyncQueues));
        let response = await fetchAppData('/api/data');
        let result = await response.json();
        assertSyncResponse(response, 'Could not load your data. Please try again.');

        if (!result.initialized) {
            const localData = getLocalSectionData();
            response = await fetchAppData('/api/data/bootstrap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: localData })
            });
            result = await response.json();
            if (response.status === 409) {
                response = await fetchAppData('/api/data');
                result = await response.json();
            } else if (!response.ok) {
                assertSyncResponse(response, 'Could not transfer your browser data. Your local copy is safe.');
            } else {
                response = await fetchAppData('/api/data');
                result = await response.json();
            }
        }
        assertSyncResponse(response, 'Could not load your data. Please try again.');
        if (!result.initialized || !result.data) {
            throw new Error('Your data is not ready to sync yet. Please try again.');
        }
        const localData = getLocalSectionData();
        offlineChanges = [...new Set([...appDataOfflineChanges, ...offlineChanges])];
        for (const section of offlineChanges) result.data[section] = localData[section];

        hydrateAppData(result.data);
        appDataSyncReady = true;
        for (const section of offlineChanges) {
            const data = section === 'preferences'
                ? { theme: state.theme }
                : section === 'study'
                    ? state.studyPlans
                    : state[section];
            const saveResponse = await fetchAppData(`/api/data/${section}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data })
            });
            assertSyncResponse(saveResponse, 'Could not sync your changes. Your local copy is safe.');
            markSectionSyncedIfUnchanged(section, data);
        }
        initTheme();
        renderCalendar();
        renderTasks();
        renderNotes();
        renderJournal();
        renderBooks();
        renderStudyPlans();
        renderTimetable();
        renderResults();
        renderDashboard();
        if (typeof migrateLegacyBookFiles === 'function') {
            try {
                await migrateLegacyBookFiles();
            } catch {
                appDataSyncHasError = true;
                setAppDataSyncStatus('Your data is synced, but some book files could not be transferred. Try again later.', true);
                return;
            }
        }
        appDataSyncHasError = appDataOfflineChanges.size > 0;
        setAppDataSyncStatus(appDataOfflineChanges.size
            ? 'Some changes are still waiting to sync. Your local copy is safe.'
            : 'Your data is up to date.', appDataOfflineChanges.size > 0);
    } catch (error) {
        offlineChanges.forEach(markSectionPending);
        setAppDataSyncStatus(syncFailureMessage(
            error,
            'Sync could not be completed. Your changes are saved on this device. Please try again later.'
        ), true);
    }
}

async function prepareAccountDeletion() {
    appDataSyncReady = false;
    for (const timer of Object.values(appDataSyncTimers)) window.clearTimeout(timer);
    await Promise.all(Object.values(appDataSyncQueues));
}

function persistAppData(section, data) {
    const key = APP_DATA_LOCAL_KEYS[section];
    if (!key) throw new Error(`Unknown app data section: ${section}`);
    const localValue = section === 'preferences' ? data.theme : JSON.stringify(data);
    localStorage.setItem(key, localValue);
    if (state.activeTab === 'home' && typeof renderDashboard === 'function') renderDashboard();
    markSectionPending(section);
    if (!appDataSyncReady) {
        return;
    }

    window.clearTimeout(appDataSyncTimers[section]);
    appDataSyncTimers[section] = window.setTimeout(() => {
        const previous = appDataSyncQueues[section] || Promise.resolve();
        appDataSyncQueues[section] = previous.catch(() => {}).then(async () => {
            const response = await fetchAppData(`/api/data/${section}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data })
            });
            assertSyncResponse(response, 'Could not sync your changes. Your local copy is safe.');
            markSectionSyncedIfUnchanged(section, data);
            if (appDataOfflineChanges.size) {
                setAppDataSyncStatus('Some changes are still waiting to sync. Your local copy is safe.', true);
            } else {
                appDataSyncHasError = false;
                setAppDataSyncStatus('Your data is up to date.');
            }
        }).catch(error => {
            markSectionPending(section);
            setAppDataSyncStatus(syncFailureMessage(
                error,
                'Sync is temporarily unavailable. Your changes are saved on this device.'
            ), true);
        });
    }, 250);
}

function getAppDataSyncStatus() {
    return appDataSyncStatus;
}
