function getLocalDataSummary() {
    const dataKeys = [
        ['focus_calendar', 'events'],
        ['focus_tasks', 'tasks'],
        ['focus_notes', 'notes'],
        ['focus_journals', 'journal entries'],
        ['focus_books', 'books'],
        ['focus_study', 'study plans'],
        ['focus_timetable', 'timetable entries'],
        ['focus_results', 'results'],
        ['focus_pomo_stats', 'timer statistics'],
        ['focus_theme_preference', 'theme preference']
    ];

    return dataKeys.map(([key, label]) => {
        const rawData = localStorage.getItem(key);
        if (!rawData) return `0 ${label}`;
        if (key === 'focus_theme_preference') return `${rawData} theme preference`;

        try {
            const data = JSON.parse(rawData);
            const count = Array.isArray(data)
                ? data.length
                : data && typeof data === 'object'
                    ? Object.keys(data).length
                    : 0;
            return `${count} ${label}`;
        } catch {
            return `${label}: unavailable`;
        }
    }).join(' · ');
}

async function renderSettings() {
    if (typeof updateNotificationSettings === 'function') updateNotificationSettings();
    if (typeof loadNotificationPreferences === 'function') void loadNotificationPreferences();
    const accountStatus = document.getElementById('settings-account-status');
    const token = localStorage.getItem('focus_auth_token');
    document.getElementById('settings-local-data').textContent = getLocalDataSummary();

    if (!token) {
        logout();
        return;
    }

    accountStatus.textContent = 'Loading account details...';
    document.getElementById('settings-account-name').textContent = 'Loading...';
    document.getElementById('settings-account-email').textContent = 'Loading...';
    document.getElementById('settings-account-created').textContent = 'Loading...';
    let timeoutId;
    try {
        const requestTimeout = new Promise((resolve, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error('Account request timed out.')), 10000);
        });
        const response = await Promise.race([fetch(appApiUrl('/api/account/me'), {
            headers: { Authorization: `Bearer ${token}` }
        }), requestTimeout]);
        if (response.status === 401) {
            logout();
            return;
        }
        if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
            throw new Error('Could not load account details. Please try again.');
        }
        const data = await Promise.race([response.json(), requestTimeout]);
        if (!response.ok) {
            throw new Error(response.status >= 500
                ? 'Account details are temporarily unavailable. Please try again later.'
                : 'Could not load account details. Please try again.');
        }

        document.getElementById('settings-account-name').textContent = data.name;
        document.getElementById('settings-account-email').textContent = data.email;
        document.getElementById('settings-account-created').textContent =
            new Date(data.createdAt).toLocaleDateString();
        accountStatus.textContent = '';

        document.getElementById('settings-delete-account').disabled = false;
        document.getElementById('settings-deletion-status').textContent = '';
    } catch (error) {
        document.getElementById('settings-account-name').textContent = 'Unavailable';
        document.getElementById('settings-account-email').textContent = 'Unavailable';
        document.getElementById('settings-account-created').textContent = 'Unavailable';
        accountStatus.textContent = error instanceof TypeError
            ? 'Could not connect to the account service. Check that the backend is running and try again.'
            : error instanceof Error && error.message === 'Account request timed out.'
                ? 'Loading account details timed out. Check your connection and try again.'
                : 'Could not load account details. Please try again.';
    } finally {
        window.clearTimeout(timeoutId);
    }
}

async function deleteAccountPermanently() {
    const status = document.getElementById('settings-deletion-status');
    if (!window.confirm('Permanently delete your Focus account, all synced data, and uploaded book files? This cannot be undone.')) {
        return;
    }

    const button = document.getElementById('settings-delete-account');
    button.disabled = true;
    status.textContent = 'Deleting your account and data...';
    try {
        await prepareAccountDeletion();
        const response = await fetch(appApiUrl('/api/account/me'), {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${localStorage.getItem('focus_auth_token')}` }
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Could not delete the account. Please try again later.');
        }
        for (const key of [
            'focus_calendar', 'focus_tasks', 'focus_notes', 'focus_journals', 'focus_books',
            'focus_study', 'focus_timetable', 'focus_results', 'focus_pomo_stats',
            'focus_theme_preference', 'focus_pending_sync_sections'
        ]) {
            localStorage.removeItem(key);
        }
        try {
            await clearLocalBookFiles();
        } catch {
            window.alert('Your account was deleted, but local book files could not be cleared. Close other Focus tabs and clear this site’s data to remove them.');
        }
        localStorage.removeItem('focus_auth_token');
        window.location.assign(new URL('./', window.location.href));
    } catch (error) {
        button.disabled = false;
        status.textContent = error instanceof TypeError
            ? 'Could not connect to the account service. Your account has not been deleted.'
            : error instanceof Error
                ? error.message
                : 'Could not delete the account. Please try again later.';
    }
}

function logout() {
    localStorage.removeItem('focus_auth_token');
    window.location.assign(new URL('./', window.location.href));
}
