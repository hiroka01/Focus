const savedFocusDuration = Number.parseInt(localStorage.getItem('focus_focus_duration'), 10);
const initialFocusDuration = Number.isInteger(savedFocusDuration) && savedFocusDuration >= 1 && savedFocusDuration <= 180
    ? savedFocusDuration
    : 25;

let timerConfig = {
    mode: 'focus', // focus, short, long
    durations: { focus: initialFocusDuration * 60, short: 5 * 60, long: 15 * 60 },
    timeLeft: initialFocusDuration * 60,
    deadline: null,
    isRunning: false,
    interval: null
};

function adjustFocusDuration(minutes) {
    if (timerConfig.mode !== 'focus' || timerConfig.isRunning) return;
    const updatedMinutes = Math.min(180, Math.max(1, timerConfig.durations.focus / 60 + minutes));
    timerConfig.durations.focus = updatedMinutes * 60;
    timerConfig.timeLeft = timerConfig.durations.focus;
    localStorage.setItem('focus_focus_duration', String(updatedMinutes));
    updateTimerDisplay();
}

function setTimerMode(mode) {
    if (!Object.hasOwn(timerConfig.durations, mode)) return;
    timerConfig.mode = mode;
    timerConfig.timeLeft = timerConfig.durations[mode];
    timerConfig.deadline = null;
    if (timerConfig.isRunning) {
        clearInterval(timerConfig.interval);
        timerConfig.isRunning = false;
        document.getElementById('timer-toggle-btn').textContent = 'START';
        if (typeof cancelTimerPushNotification === 'function') void cancelTimerPushNotification();
    }

    document.querySelectorAll('#mod-timer button[id^="timer-mode-"]').forEach(btn => {
        btn.className = 'flex-1 py-1.5 rounded-lg text-mono-500';
    });
    document.getElementById(`timer-mode-${mode}`).className = 'flex-1 py-1.5 rounded-lg bg-white dark:bg-mono-950 font-bold shadow-sm';
    document.getElementById('focus-duration-controls').classList.toggle('hidden', mode !== 'focus');

    updateTimerDisplay();
}

function toggleTimer() {
    if (timerConfig.isRunning) {
        timerConfig.timeLeft = Math.max(0, Math.ceil((timerConfig.deadline - Date.now()) / 1000));
        clearInterval(timerConfig.interval);
        timerConfig.isRunning = false;
        timerConfig.deadline = null;
        document.getElementById('timer-toggle-btn').textContent = 'START';
    } else {
        timerConfig.isRunning = true;
        timerConfig.deadline = Date.now() + timerConfig.timeLeft * 1000;
        document.getElementById('timer-toggle-btn').textContent = 'PAUSE';
        if (typeof scheduleTimerPushNotification === 'function') {
            void scheduleTimerPushNotification(timerConfig.mode, timerConfig.deadline);
        }
        timerConfig.interval = setInterval(() => {
            timerConfig.timeLeft = Math.max(0, Math.ceil((timerConfig.deadline - Date.now()) / 1000));
            if (timerConfig.timeLeft > 0) {
                updateTimerDisplay();
            } else {
                clearInterval(timerConfig.interval);
                timerConfig.isRunning = false;
                timerConfig.deadline = null;
                document.getElementById('timer-toggle-btn').textContent = 'START';
                if (typeof cancelTimerPushNotification === 'function') void cancelTimerPushNotification();
                playBell();

                if (timerConfig.mode === 'focus') {
                    state.pomoStats.sessions += 1;
                    state.pomoStats.totalMinutes += timerConfig.durations.focus / 60;
                    persistAppData('pomoStats', state.pomoStats);
                }
                if (typeof notifyTimerFinished === 'function') {
                    void notifyTimerFinished(timerConfig.mode)
                        .catch(error => console.error('Unable to show timer notification:', error));
                }
                setTimerMode('focus');
            }
        }, 1000);
    }
}

function resetTimer() {
    if (timerConfig.isRunning) {
        clearInterval(timerConfig.interval);
        timerConfig.isRunning = false;
        timerConfig.deadline = null;
        document.getElementById('timer-toggle-btn').textContent = 'START';
        if (typeof cancelTimerPushNotification === 'function') void cancelTimerPushNotification();
    }
    timerConfig.timeLeft = timerConfig.durations[timerConfig.mode];
    updateTimerDisplay();
}

function updateTimerDisplay() {
    if (timerConfig.isRunning && timerConfig.deadline) {
        timerConfig.timeLeft = Math.max(0, Math.ceil((timerConfig.deadline - Date.now()) / 1000));
    }
    const mins = Math.floor(timerConfig.timeLeft / 60);
    const secs = timerConfig.timeLeft % 60;
    const str = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    document.getElementById('timer-display').textContent = str;
    const focusDurationLabel = document.getElementById('focus-duration-value');
    if (focusDurationLabel) focusDurationLabel.textContent = `${timerConfig.durations.focus / 60} min`;

    const total = timerConfig.durations[timerConfig.mode];
    const progress = (total - timerConfig.timeLeft) / total;
    const circle = document.getElementById('timer-progress-ring');
    const circumference = 276.46;
    circle.style.strokeDashoffset = circumference - (progress * circumference);

    document.getElementById('timer-session-count').textContent = state.pomoStats.sessions;
    document.getElementById('timer-total-mins').textContent = `${state.pomoStats.totalMinutes}m`;
}