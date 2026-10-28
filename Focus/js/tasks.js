let taskFilter = 'all';

function handleAddTask(e) {
    e.preventDefault();
    const title = document.getElementById('task-input-title').value.trim();
    const priority = document.getElementById('task-input-priority').value;
    const category = document.getElementById('task-input-category').value;

    if (!title) return;

    state.tasks.unshift({
        id: 't_' + Date.now(),
        title,
        priority,
        category,
        completed: false
    });
    persistAppData('tasks', state.tasks);
    renderTasks();
    document.getElementById('task-input-title').value = '';
}

function toggleTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        if (task.completed) playBell();
        persistAppData('tasks', state.tasks);
        renderTasks();
    }
}

function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    persistAppData('tasks', state.tasks);
    renderTasks();
}

function setTaskFilter(filter) {
    taskFilter = filter;
    document.querySelectorAll('.task-filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === filter) {
            btn.className = 'task-filter-btn px-2.5 py-1 rounded-md bg-mono-900 text-white dark:bg-mono-100 dark:text-mono-900 font-bold';
        } else {
            btn.className = 'task-filter-btn px-2.5 py-1 rounded-md text-mono-500 hover:text-mono-900 dark:hover:text-mono-100';
        }
    });
    renderTasks();
}

function renderTasks() {
    const container = document.getElementById('tasks-container');
    let filtered = state.tasks;
    if (taskFilter === 'active') filtered = state.tasks.filter(t => !t.completed);
    if (taskFilter === 'completed') filtered = state.tasks.filter(t => t.completed);

    const activeCount = state.tasks.filter(t => !t.completed).length;
    document.getElementById('task-count').textContent = `${activeCount} tasks left`;

    if (filtered.length === 0) {
        container.innerHTML = `<p class="text-xs text-mono-400 font-mono text-center py-6">No tasks in view.</p>`;
        return;
    }

    container.innerHTML = filtered.map(t => {
        const priorityDot = { Low: '◦', Mid: '△', High: '⬟' }[t.priority];
        return `
            <div class="flex items-center justify-between p-2.5 border border-mono-200 dark:border-mono-800 rounded-xl bg-white dark:bg-mono-950 font-mono text-xs">
                <div class="flex items-center space-x-3 flex-1 min-w-0">
                    <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTask('${t.id}')" class="w-4 h-4 rounded border-mono-300 dark:border-mono-700 accent-mono-900 dark:accent-mono-100 cursor-pointer">
                    <span class="${t.completed ? 'line-through text-mono-400' : ''} truncate">${t.title}</span>
                </div>
                <div class="flex items-center space-x-2 text-[10px] text-mono-400">
                    <span class="px-1.5 py-0.5 border border-mono-200 dark:border-mono-800 rounded">${t.category}</span>
                    <span>${priorityDot}</span>
                    <button onclick="deleteTask('${t.id}')" class="hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `;
    }).join('');
}