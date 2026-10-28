let currentCalendarDate = new Date();
let selectedCalendarDate = localDateString(new Date());
let lastLocationSearchAt = 0;
let calendarListenersInitialized = false;

function localDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function escapeCalendarHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function validTagColor(color) {
    return typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? color : '#71717a';
}

function tagTextColor(color) {
    const hex = validTagColor(color).slice(1);
    const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return luminance > 0.179 ? '#18181b' : '#ffffff';
}

function initializeCalendarControls() {
    if (calendarListenersInitialized) return;
    calendarListenersInitialized = true;

    const dateInput = document.getElementById('event-date');
    dateInput.value = selectedCalendarDate;
    dateInput.addEventListener('change', () => {
        if (!dateInput.value) return;
        const [year, month, day] = dateInput.value.split('-').map(Number);
        selectedCalendarDate = dateInput.value;
        currentCalendarDate = new Date(year, month - 1, 1);
        renderCalendar();
    });

    const tagSelect = document.getElementById('event-tag');
    tagSelect.addEventListener('change', updateCustomTagFields);
    document.getElementById('event-reminder').addEventListener('change', toggleCustomReminder);

    document.getElementById('event-location').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchEventLocation();
        }
    });
}

function updateCustomTagFields() {
    const isCustomTag = document.getElementById('event-tag').value === '__custom__';
    const fields = document.getElementById('custom-tag-fields');
    fields.classList.toggle('hidden', !isCustomTag);
    fields.classList.toggle('grid', isCustomTag);
}

function toggleCustomReminder() {
    const isCustomReminder = document.getElementById('event-reminder').value === 'custom';
    const fields = document.getElementById('custom-reminder-fields');
    fields.classList.toggle('hidden', !isCustomReminder);
    fields.classList.toggle('flex', isCustomReminder);
}

function renderCalendar() {
    initializeCalendarControls();

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    document.getElementById('calendar-month-year').textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const grid = document.getElementById('calendar-days-grid');
    const today = localDateString(new Date());
    const dayCells = [];

    for (let index = 0; index < firstDay; index++) {
        dayCells.push('<div class="h-10 border border-transparent" aria-hidden="true"></div>');
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasEvents = state.calendar.some(event => event.date === dateString);
        const isToday = dateString === today;
        const isSelected = dateString === selectedCalendarDate;
        const classes = isToday
            ? 'bg-mono-900 text-white dark:bg-mono-100 dark:text-mono-900 font-bold'
            : 'hover:bg-mono-100 dark:hover:bg-mono-900';
        const selectionClasses = isSelected
            ? `ring-2 ring-mono-400 ring-inset ${isToday ? '' : 'bg-white/40 dark:bg-white/10'}`
            : '';
        const eventDot = hasEvents
            ? `<span class="w-1 h-1 rounded-full ${isToday ? 'bg-white dark:bg-mono-900' : 'bg-mono-900 dark:bg-mono-100'}"></span>`
            : '<span class="w-1 h-1"></span>';

        dayCells.push(`
            <button type="button" aria-label="${monthNames[month]} ${day}, ${year}" aria-pressed="${isSelected}"
                onclick="selectCalendarDate('${dateString}')"
                class="h-10 w-full border border-mono-100 dark:border-mono-900 rounded-lg p-1 flex flex-col items-center justify-between text-xs font-mono relative ${classes} ${selectionClasses}">
                <span>${day}</span>${eventDot}
            </button>
        `);
    }

    grid.innerHTML = dayCells.join('');
    renderTagOptions();
    renderEventsList();
}

function selectCalendarDate(dateString) {
    selectedCalendarDate = dateString;
    const [year, month] = dateString.split('-').map(Number);
    currentCalendarDate = new Date(year, month - 1, 1);
    document.getElementById('event-date').value = dateString;
    renderCalendar();
}

function changeMonth(delta) {
    currentCalendarDate = new Date(
        currentCalendarDate.getFullYear(),
        currentCalendarDate.getMonth() + delta,
        1
    );
    renderCalendar();
}

function renderTagOptions() {
    const select = document.getElementById('event-tag');
    const selectedValue = select.value;
    const uniqueTags = new Map();
    state.calendar.forEach(event => {
        if (typeof event.tag === 'string' && event.tag.trim()) {
            uniqueTags.set(event.tag, validTagColor(event.tagColor));
        }
    });

    select.innerHTML = '<option value="">No tag</option>';
    uniqueTags.forEach((color, tag) => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        option.dataset.color = color;
        select.append(option);
    });
    select.insertAdjacentHTML('beforeend', '<option value="__custom__">Create custom tag...</option>');
    if ([...select.options].some(option => option.value === selectedValue)) {
        select.value = selectedValue;
    }
    updateCustomTagFields();
}

function handleAddEvent(event) {
    event.preventDefault();
    const title = document.getElementById('event-title').value.trim();
    const date = document.getElementById('event-date').value;
    const time = document.getElementById('event-time').value;
    const tagChoice = document.getElementById('event-tag').value;
    const reminderChoice = document.getElementById('event-reminder').value;
    const customTagName = document.getElementById('event-tag-name').value.trim();
    const selectedTagOption = document.getElementById('event-tag').selectedOptions[0];
    const tag = tagChoice === '__custom__' ? customTagName : tagChoice;
    const tagColor = tagChoice === '__custom__'
        ? document.getElementById('event-tag-color').value
        : selectedTagOption?.dataset.color || '';

    if (!title || !date) return;
    if (tagChoice === '__custom__' && !customTagName) {
        document.getElementById('event-tag-name').focus();
        return;
    }
    let reminderMinutes = 0;
    if (reminderChoice === 'custom') {
        const amount = Number(document.getElementById('event-reminder-value').value);
        const unit = document.getElementById('event-reminder-unit').value;
        const multiplier = { minutes: 1, hours: 60, days: 1440 }[unit];
        if (!Number.isInteger(amount) || amount < 1 || amount > 365 || !multiplier) return;
        reminderMinutes = amount * multiplier;
    } else if (reminderChoice) {
        reminderMinutes = Number(reminderChoice);
    }

    let reminderAt;
    if (reminderMinutes) {
        if (!time) {
            document.getElementById('event-reminder-status').textContent = 'Add an event time to schedule its reminder.';
            document.getElementById('event-time').focus();
            return;
        }
        const [year, month, day] = date.split('-').map(Number);
        const [hour, minute] = time.split(':').map(Number);
        reminderAt = new Date(year, month - 1, day, hour, minute).getTime() - reminderMinutes * 60_000;
        if (reminderAt <= Date.now()) {
            document.getElementById('event-reminder-status').textContent = 'Choose a reminder time in the future.';
            return;
        }
    }

    state.calendar.push({
        id: `e_${Date.now()}`,
        title,
        date,
        time,
        ...(reminderMinutes ? { reminderMinutes, reminderAt: new Date(reminderAt).toISOString() } : {}),
        ...(tag ? { tag, tagColor: validTagColor(tagColor) } : {}),
        ...(document.getElementById('event-location').value.trim()
            ? { location: document.getElementById('event-location').value.trim() }
            : {})
    });
    selectedCalendarDate = date;
    const [year, month] = date.split('-').map(Number);
    currentCalendarDate = new Date(year, month - 1, 1);
    persistAppData('calendar', state.calendar);
    event.target.reset();
    document.getElementById('event-date').value = selectedCalendarDate;
    document.getElementById('event-location-status').textContent = '';
    document.getElementById('event-reminder-status').textContent = '';
    document.getElementById('event-location-results').replaceChildren();
    document.getElementById('event-location-results').classList.add('hidden');
    toggleCustomReminder();
    renderCalendar();
}

function formatEventDate(dateString) {
    const date = new Date(`${dateString}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? dateString
        : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderEventsList() {
    const container = document.getElementById('calendar-events-list');
    if (state.calendar.length === 0) {
        container.innerHTML = '<p class="text-xs text-mono-400 font-mono">No events recorded.</p>';
        return;
    }

    const events = [...state.calendar].sort((first, second) =>
        first.date.localeCompare(second.date) || (first.time || '').localeCompare(second.time || '')
    );
    container.innerHTML = events.map(event => {
        const tagColor = validTagColor(event.tagColor);
        const tag = typeof event.tag === 'string' && event.tag.trim()
            ? `<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style="background-color:${tagColor};color:${tagTextColor(tagColor)}">${escapeCalendarHtml(event.tag)}</span>`
            : '';
        const details = [
            formatEventDate(event.date),
            event.time ? escapeCalendarHtml(event.time) : '',
            event.location ? escapeCalendarHtml(event.location) : '',
            event.reminderMinutes ? `Reminder ${event.reminderMinutes >= 1440
                ? `${event.reminderMinutes / 1440}d`
                : event.reminderMinutes >= 60
                    ? `${event.reminderMinutes / 60}h`
                    : `${event.reminderMinutes}m`} before` : ''
        ].filter(Boolean).join(' · ');
        return `
            <div class="flex items-start justify-between gap-2 p-2 border border-mono-200 dark:border-mono-800 rounded-lg text-xs font-mono">
                <div class="min-w-0 space-y-1">
                    <div class="break-words font-bold">${escapeCalendarHtml(event.title)}</div>
                    <div class="break-words text-[10px] text-mono-400">${details}</div>
                    ${tag}
                </div>
                <button type="button" data-event-id="${escapeCalendarHtml(event.id)}" aria-label="Delete ${escapeCalendarHtml(event.title)}" class="shrink-0 text-mono-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `;
    }).join('');

    container.querySelectorAll('[data-event-id]').forEach(button => {
        button.addEventListener('click', () => deleteEvent(button.dataset.eventId));
    });
}

async function searchEventLocation() {
    const input = document.getElementById('event-location');
    const status = document.getElementById('event-location-status');
    const resultsContainer = document.getElementById('event-location-results');
    const searchButton = document.getElementById('search-event-location');
    const query = input.value.trim();

    resultsContainer.replaceChildren();
    resultsContainer.classList.add('hidden');
    if (!query) {
        status.textContent = 'Enter a place or address to search.';
        input.focus();
        return;
    }

    const elapsed = Date.now() - lastLocationSearchAt;
    if (elapsed < 1000) {
        status.textContent = 'Please wait a moment before searching again.';
        return;
    }

    lastLocationSearchAt = Date.now();
    searchButton.disabled = true;
    status.textContent = 'Searching locations...';
    try {
        const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5' });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`Location search failed (${response.status}).`);

        const places = await response.json();
        if (!Array.isArray(places)) throw new Error('Location search returned an invalid response.');
        if (places.length === 0) {
            status.textContent = 'No matching locations found. You can still enter a location manually.';
            return;
        }

        places.forEach(place => {
            if (typeof place.display_name !== 'string') return;
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'block w-full rounded-md p-2 text-left text-[10px] hover:bg-mono-100 dark:hover:bg-mono-900';
            option.textContent = place.display_name;
            option.addEventListener('click', () => {
                input.value = place.display_name;
                status.textContent = 'Location selected.';
                resultsContainer.replaceChildren();
                resultsContainer.classList.add('hidden');
            });
            resultsContainer.append(option);
        });

        if (resultsContainer.childElementCount) {
            resultsContainer.classList.remove('hidden');
            status.textContent = 'Choose a result, or keep your typed location.';
        } else {
            status.textContent = 'No usable location results found. You can enter a location manually.';
        }
    } catch (error) {
        console.error('Unable to search event locations:', error);
        status.textContent = 'Location search is unavailable. You can still enter a location manually.';
    } finally {
        searchButton.disabled = false;
    }
}

function deleteEvent(id) {
    state.calendar = state.calendar.filter(event => event.id !== id);
    persistAppData('calendar', state.calendar);
    renderCalendar();
}
