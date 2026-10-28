const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function initTheme() {
    applyTheme();
    mediaQuery.addEventListener('change', () => {
        if (state.theme === 'system') {
            applyTheme();
        }
    });
}

function applyTheme() {
    const isDark = state.theme === 'system' 
        ? mediaQuery.matches 
        : state.theme === 'dark';

    if (isDark) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
    updateThemeUI();
}

function openThemeModal() {
    renderThemeModalOptions();
    document.getElementById('theme-modal').classList.remove('hidden');
}

function closeThemeModal() {
    document.getElementById('theme-modal').classList.add('hidden');
}

function selectTheme(mode) {
    state.theme = mode;
    persistAppData('preferences', { theme: mode });
    applyTheme();
    closeThemeModal();
}

function renderThemeModalOptions() {
    const options = [
        { id: 'light', name: 'Light' },
        { id: 'dark', name: 'Dark' },
        { id: 'system', name: 'System Default' }
    ];

    const container = document.getElementById('theme-options-container');
    container.innerHTML = options.map(opt => {
        const isSelected = state.theme === opt.id;
        return `
            <button onclick="selectTheme('${opt.id}')" class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-mono transition ${
                isSelected 
                    ? 'bg-mono-900 text-white dark:bg-mono-100 dark:text-mono-900 font-bold' 
                    : 'text-mono-700 dark:text-mono-300 hover:bg-mono-100 dark:hover:bg-mono-900'
            }">
                <span>${opt.name}</span>
                ${isSelected ? '<span class="text-xs">✓</span>' : ''}
            </button>
        `;
    }).join('');
}

function updateThemeUI() {
    let iconClass = 'fa-solid fa-circle-half-stroke';
    if (state.theme === 'dark') {
        iconClass = 'fa-solid fa-moon';
    } else if (state.theme === 'light') {
        iconClass = 'fa-solid fa-sun';
    }

    document.getElementById('theme-icon').className = `${iconClass} text-sm`;
    document.getElementById('mobile-theme-icon').className = `${iconClass} text-sm`;
}