function openStudyModal() { document.getElementById('study-modal').classList.remove('hidden'); }
function closeStudyModal() { document.getElementById('study-modal').classList.add('hidden'); }

function handleSaveStudyPlan(e) {
    e.preventDefault();
    const subject = document.getElementById('study-subject').value.trim();
    const topic = document.getElementById('study-topic').value.trim();
    const target = parseFloat(document.getElementById('study-target-hours').value) || 0;
    const deadline = document.getElementById('study-deadline').value;

    state.studyPlans.unshift({ id: 'sp_' + Date.now(), subject, topic, target, completed: 0, deadline });
    persistAppData('study', state.studyPlans);
    renderStudyPlans();
    closeStudyModal();
    e.target.reset();
}

function logStudyHour(id) {
    const plan = state.studyPlans.find(s => s.id === id);
    if (plan) {
        plan.completed = Math.min(plan.target, plan.completed + 1);
        persistAppData('study', state.studyPlans);
        renderStudyPlans();
    }
}

function renderStudyPlans() {
    const container = document.getElementById('study-plans-container');
    if (state.studyPlans.length === 0) {
        container.innerHTML = `<p class="text-xs text-mono-400 font-mono text-center py-6">No study sessions planned.</p>`;
        return;
    }

    container.innerHTML = state.studyPlans.map(s => {
        const pct = Math.min(100, Math.round((s.completed / s.target) * 100));
        return `
            <div class="p-4 border border-mono-200 dark:border-mono-800 rounded-xl bg-white dark:bg-mono-950 font-mono text-xs space-y-2">
                <div class="flex justify-between items-start">
                    <div>
                        <h4 class="font-bold">${s.subject}</h4>
                        <p class="text-[10px] text-mono-400">${s.topic} • Deadline: ${s.deadline}</p>
                    </div>
                    <button onclick="logStudyHour('${s.id}')" class="px-2 py-1 border border-mono-200 dark:border-mono-800 rounded text-[10px] hover:bg-mono-100 dark:hover:bg-mono-900">+1 Hr</button>
                </div>
                <div class="space-y-1">
                    <div class="flex justify-between text-[10px] text-mono-400">
                        <span>Target: ${s.target} hrs</span>
                        <span>${s.completed} hrs completed (${pct}%)</span>
                    </div>
                    <div class="w-full bg-mono-100 dark:bg-mono-900 h-1.5 rounded-full overflow-hidden">
                        <div class="bg-mono-900 dark:bg-mono-100 h-full" style="width: ${pct}%"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}