function openResultModal() { document.getElementById('result-modal').classList.remove('hidden'); }
function closeResultModal() { document.getElementById('result-modal').classList.add('hidden'); }

function handleSaveResult(e) {
    e.preventDefault();
    const subject = document.getElementById('result-subject').value.trim();
    const target = parseFloat(document.getElementById('result-target').value) || 0;
    const actual = parseFloat(document.getElementById('result-actual').value) || 0;

    state.results.unshift({ id: 'r_' + Date.now(), subject, target, actual });
    persistAppData('results', state.results);
    renderResults();
    closeResultModal();
    e.target.reset();
}

function renderResults() {
    const container = document.getElementById('results-container');
    const totalCourses = state.results.length;
    renderResultsAnalysis();

    if (totalCourses === 0) {
        document.getElementById('result-gpa-stat').textContent = '0.0%';
        document.getElementById('result-total-courses').textContent = '0 courses recorded';
        container.innerHTML = `<p class="text-xs text-mono-400 font-mono text-center py-6">No results recorded.</p>`;
        return;
    }

    const avg = (state.results.reduce((acc, curr) => acc + curr.actual, 0) / totalCourses).toFixed(1);
    document.getElementById('result-gpa-stat').textContent = `${avg}%`;
    document.getElementById('result-total-courses').textContent = `${totalCourses} courses recorded`;

    container.innerHTML = state.results.map(r => `
        <div class="p-3 border border-mono-200 dark:border-mono-800 rounded-xl font-mono text-xs space-y-2">
            <div class="flex justify-between font-bold">
                <span>${r.subject}</span>
                <span>${r.actual}%</span>
            </div>
            <div class="space-y-1">
                <div class="flex justify-between text-[10px] text-mono-400">
                    <span>Target: ${r.target}%</span>
                    <span>Actual: ${r.actual}%</span>
                </div>
                <div class="w-full bg-mono-100 dark:bg-mono-900 h-1.5 rounded-full overflow-hidden">
                    <div class="bg-mono-900 dark:bg-mono-100 h-full" style="width: ${Math.min(100, r.actual)}%"></div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderResultsAnalysis() {
    const chart = document.getElementById('results-analysis-chart');
    if (!state.results.length) {
        chart.innerHTML = '<p class="text-xs text-mono-400 font-mono py-6 text-center">Add course results to see your performance analysis.</p>';
        return;
    }

    const rowHeight = 58;
    const top = 10;
    const barX = 105;
    const barWidth = 500;
    const chartHeight = top + rowHeight * state.results.length;
    const rows = state.results.map((result, index) => {
        const y = top + index * rowHeight;
        const target = Math.max(0, Math.min(100, Number(result.target) || 0));
        const actual = Math.max(0, Math.min(100, Number(result.actual) || 0));
        const subject = escapeResultText(result.subject);
        return `
            <g>
                <text x="8" y="${y + 13}" class="chart-subject">${subject}</text>
                <text x="8" y="${y + 31}" class="chart-label">Target</text>
                <rect x="${barX}" y="${y + 23}" width="${barWidth}" height="8" rx="4" class="chart-track"></rect>
                <rect x="${barX}" y="${y + 23}" width="${barWidth * target / 100}" height="8" rx="4" class="chart-target"></rect>
                <text x="8" y="${y + 48}" class="chart-label">Actual</text>
                <rect x="${barX}" y="${y + 40}" width="${barWidth}" height="8" rx="4" class="chart-track"></rect>
                <rect x="${barX}" y="${y + 40}" width="${barWidth * actual / 100}" height="8" rx="4" class="chart-actual"></rect>
                <text x="615" y="${y + 31}" class="chart-value">${target.toFixed(1)}%</text>
                <text x="615" y="${y + 48}" class="chart-value">${actual.toFixed(1)}%</text>
            </g>
        `;
    }).join('');

    chart.innerHTML = `
        <svg class="results-chart" viewBox="0 0 690 ${chartHeight}" role="img" aria-labelledby="results-chart-title results-chart-description">
            <title id="results-chart-title">Course target and actual grades</title>
            <desc id="results-chart-description">Horizontal bars compare target and actual percentages for each recorded course.</desc>
            ${rows}
        </svg>
    `;
}

function escapeResultText(value) {
    const element = document.createElement('span');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}