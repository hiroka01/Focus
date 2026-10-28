function renderTimetable() {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hours = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];
    const grid = document.getElementById('timetable-slots-grid');

    grid.innerHTML = hours.map(h => `
        <div class="grid grid-cols-8 gap-2 py-2 text-center items-center text-xs font-mono">
            <span class="text-mono-400 text-[10px]">${h}</span>
            ${days.map(d => {
                const key = `${d}_${h}`;
                const val = state.timetable[key] || '';
                return `
                    <input type="text" value="${val}" onchange="saveTimetableSlot('${key}', this.value)" placeholder="--" class="bg-transparent border border-mono-200 dark:border-mono-800 rounded p-1 text-center text-[10px] focus:outline-none focus:border-mono-900 dark:focus:border-mono-100 truncate">
                `;
            }).join('')}
        </div>
    `).join('');
}

function saveTimetableSlot(key, val) {
    state.timetable[key] = val;
    persistAppData('timetable', state.timetable);
}