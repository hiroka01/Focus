/* MODULE DEFINITIONS */
const MODULES = [
    { id: 'home', name: 'Dashboard', icon: 'fa-solid fa-house' },
    { id: 'calendar', name: '01. Calendar', icon: 'fa-regular fa-calendar' },
    { id: 'tasks', name: '02. To-Do Lists', icon: 'fa-solid fa-list-check' },
    { id: 'notes', name: '03. Notes', icon: 'fa-regular fa-file-lines' },
    { id: 'timer', name: '04. Timer', icon: 'fa-regular fa-clock' },
    { id: 'journal', name: '05. Journal', icon: 'fa-solid fa-book-open' },
    { id: 'books', name: '06. Books', icon: 'fa-solid fa-book' },
    { id: 'study', name: '07. Study Plan', icon: 'fa-solid fa-graduation-cap' },
    { id: 'timetable', name: '08. Timetable', icon: 'fa-solid fa-table-cells' },
    { id: 'results', name: '09. Results', icon: 'fa-solid fa-chart-line' },
];

/* APPLICATION STATE */
let state = {
    theme: localStorage.getItem('focus_theme_preference') || 'system',
    activeTab: 'home',
    calendar: JSON.parse(localStorage.getItem('focus_calendar')) || [],
    tasks: JSON.parse(localStorage.getItem('focus_tasks')) || [],
    notes: JSON.parse(localStorage.getItem('focus_notes')) || [],
    activeNoteId: null,
    journals: JSON.parse(localStorage.getItem('focus_journals')) || [],
    books: JSON.parse(localStorage.getItem('focus_books')) || [],
    studyPlans: JSON.parse(localStorage.getItem('focus_study')) || [],
    timetable: JSON.parse(localStorage.getItem('focus_timetable')) || {},
    results: JSON.parse(localStorage.getItem('focus_results')) || [],
    pomoStats: JSON.parse(localStorage.getItem('focus_pomo_stats')) || { sessions: 0, totalMinutes: 0 }
};

/* WEB AUDIO BELL SYNTHESIZER */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBell() {
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.8);
    } catch(e) {}
}

/* INITIALIZATION */
window.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem('focus_auth_token')) return;

    void initializeApp();
});

async function initializeApp() {
    await loadAppDataFromDatabase();
    initTheme();
    renderNavigation();
    registerFocusServiceWorker();
    void loadNotificationPreferences();
    initDefaultData();
    switchTab('home');

    // Render Modules
    renderCalendar();
    renderTasks();
    renderNotes();
    updateTimerDisplay();
    renderJournal();
    renderBooks();
    renderStudyPlans();
    renderTimetable();
    renderResults();
}

/* NAVIGATION BUILDER */
function renderNavigation() {
    const desktopNav = document.getElementById('desktop-nav');
    const mobileNav = document.getElementById('mobile-nav');

    let desktopHtml = '';
    let mobileHtml = '';

    MODULES.forEach(mod => {
        desktopHtml += `
            <button onclick="switchTab('${mod.id}')" data-tab="${mod.id}" class="nav-btn w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-mono font-medium text-mono-500 hover:text-mono-900 dark:hover:text-mono-100">
                <i class="${mod.icon} w-4 text-center"></i>
                <span>${mod.name}</span>
            </button>
        `;

        mobileHtml += `
            <button onclick="switchTab('${mod.id}')" data-tab="${mod.id}" class="mobile-nav-btn shrink-0 px-3 py-1.5 rounded-lg text-xs font-mono font-medium border border-mono-200 dark:border-mono-800 text-mono-500">
                ${mod.name.includes('. ') ? mod.name.split('. ')[1] : mod.name}
            </button>
        `;
    });

    desktopNav.innerHTML = desktopHtml;
    mobileNav.innerHTML = mobileHtml;
}

function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`mod-${tabId}`);
    if (target) target.classList.remove('hidden');

    // Nav States
    document.querySelectorAll('.nav-btn').forEach(btn => {
        const isCurrent = btn.getAttribute('data-tab') === tabId;
        btn.className = isCurrent 
            ? 'nav-btn w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-mono font-bold bg-mono-100 dark:bg-mono-900 text-mono-900 dark:text-mono-100 border border-mono-200 dark:border-mono-800'
            : 'nav-btn w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-mono font-medium text-mono-500 hover:text-mono-900 dark:hover:text-mono-100';
    });

    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        const isCurrent = btn.getAttribute('data-tab') === tabId;
        btn.className = isCurrent 
            ? 'mobile-nav-btn shrink-0 px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-mono-900 dark:bg-mono-100 text-white dark:text-mono-900'
            : 'mobile-nav-btn shrink-0 px-3 py-1.5 rounded-lg text-xs font-mono font-medium border border-mono-200 dark:border-mono-800 text-mono-500';
    });

    if (tabId === 'settings') renderSettings();
    if (tabId === 'home') renderDashboard();
}

function escapeDashboardText(value) {
    const element = document.createElement('span');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function dashboardItems(items, emptyMessage) {
    if (!items.length) {
        return `<p class="text-xs text-mono-400 font-mono">${escapeDashboardText(emptyMessage)}</p>`;
    }
    return `<ul class="space-y-2">${items.map(item => `<li class="text-xs font-mono text-mono-700 dark:text-mono-300">${item}</li>`).join('')}</ul>`;
}

function renderDashboard() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const activeTasks = state.tasks.filter(task => !task.completed);
    const todaysEvents = state.calendar.filter(event => event.date === today);
    const activeStudyPlans = state.studyPlans.filter(plan => plan.completed < plan.target);
    const resultAverage = state.results.length
        ? state.results.reduce((total, result) => total + Number(result.actual || 0), 0) / state.results.length
        : 0;
    const upcomingEvents = state.calendar
        .filter(event => event.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
        .slice(0, 3);
    const todayDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
    const todaySchedule = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00']
        .map(time => ({ time, activity: state.timetable[`${todayDay}_${time}`] }))
        .filter(slot => slot.activity);
    const activeBooks = books.filter(book => book.status !== 'Finished');

    document.getElementById('dashboard-open-tasks').textContent = activeTasks.length;
    document.getElementById('dashboard-today-events').textContent = todaysEvents.length;
    document.getElementById('dashboard-study-goals').textContent = activeStudyPlans.length;
    document.getElementById('dashboard-results-average').textContent = `${resultAverage.toFixed(1)}%`;

    document.getElementById('dashboard-calendar').innerHTML = dashboardItems(
        upcomingEvents.map(event => `<span class="font-bold">${escapeDashboardText(event.title)}</span><span class="text-mono-400"> · ${escapeDashboardText(event.date)}${event.time ? ` ${escapeDashboardText(event.time)}` : ''}</span>`),
        'No upcoming events.'
    );
    document.getElementById('dashboard-tasks').innerHTML = dashboardItems(
        activeTasks.slice(0, 3).map(task => `${escapeDashboardText(task.title)}<span class="text-mono-400"> · ${escapeDashboardText(task.priority || 'Task')}</span>`),
        'All clear — no open tasks.'
    );
    document.getElementById('dashboard-notes').innerHTML = dashboardItems(
        state.notes.slice().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 3)
            .map(note => escapeDashboardText(note.title || 'Untitled note')),
        'No notes yet.'
    );
    document.getElementById('dashboard-timer').innerHTML =
        `<p class="text-xs font-mono">${state.pomoStats.sessions} focus sessions completed</p><p class="text-[10px] text-mono-400 font-mono mt-1">${state.pomoStats.totalMinutes} total focus minutes</p>`;
    document.getElementById('dashboard-journal').innerHTML = dashboardItems(
        state.journals.slice(0, 2).map(entry => `${escapeDashboardText(entry.date)}<span class="text-mono-400"> · ${escapeDashboardText(entry.mood)}</span><span class="block text-mono-500 truncate mt-1">${escapeDashboardText(entry.text)}</span>`),
        'No journal entries yet.'
    );
    document.getElementById('dashboard-books').innerHTML =
        `<p class="text-xs font-mono">${books.length} ${books.length === 1 ? 'book' : 'books'} in your library</p><p class="text-[10px] text-mono-400 font-mono mt-1">${activeBooks.length} currently in progress</p>`;
    document.getElementById('dashboard-study').innerHTML = dashboardItems(
        activeStudyPlans.slice(0, 3).map(plan => `${escapeDashboardText(plan.subject)}<span class="text-mono-400"> · ${Number(plan.completed || 0)}/${Number(plan.target || 0)} hrs</span>`),
        'No active study goals.'
    );
    document.getElementById('dashboard-timetable').innerHTML = dashboardItems(
        todaySchedule.map(slot => `<span class="text-mono-400">${slot.time}</span> · ${escapeDashboardText(slot.activity)}`),
        'No activities scheduled for today.'
    );
    document.getElementById('dashboard-results').innerHTML =
        `<p class="text-xs font-mono">${state.results.length} ${state.results.length === 1 ? 'course result' : 'course results'} recorded</p><p class="text-[10px] text-mono-400 font-mono mt-1">Average actual grade: ${resultAverage.toFixed(1)}%</p>`;
}

function initDefaultData() {
    if (state.notes.length === 0) {
        state.notes.push({
            id: 'n_1',
            title: 'Welcome to Focus',
            content: 'Focus is an ultra-minimalist workspace designed for maximum clarity.\n\n- Pure monochrome layout\n- Zero distraction ethos\n- Integrated tools',
            pinned: true,
            updatedAt: new Date().toLocaleDateString()
        });
        state.activeNoteId = 'n_1';
        persistAppData('notes', state.notes);
    } else {
        state.activeNoteId = state.notes[0].id;
    }
}