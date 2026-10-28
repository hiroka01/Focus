let focusServiceWorkerRegistration = null;
let reminderCheckInterval = null;
let notificationPreferenceSaveQueue = Promise.resolve();
let timerNotificationQueue = Promise.resolve();
let pendingNotificationAction = null;

function notificationPreferenceValue(key) {
    return localStorage.getItem(key) !== 'false';
}

function scheduleTimerPushNotification(mode, endsAt) {
    timerNotificationQueue = timerNotificationQueue.catch(() => {}).then(async () => {
        if (localStorage.getItem('focus_notifications_enabled') !== 'true'
            || localStorage.getItem('focus_push_enabled') !== 'true'
            || !notificationPreferenceValue('focus_timer_alerts')) return;
        try {
            const response = await fetchAppData('/api/notifications/timer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode, endsAt: new Date(endsAt).toISOString() })
            });
            assertSyncResponse(response, 'Could not schedule a background timer notification.');
            document.getElementById('timer-notification-status').textContent =
                'Background notification scheduled for this timer.';
        } catch (error) {
            console.error('Unable to schedule a background timer notification:', error);
            document.getElementById('timer-notification-status').textContent = error instanceof Error
                ? error.message
                : 'Could not schedule a background timer notification.';
        }
    });
    return timerNotificationQueue;
}

function cancelTimerPushNotification() {
    timerNotificationQueue = timerNotificationQueue.catch(() => {}).then(async () => {
        if (localStorage.getItem('focus_push_enabled') !== 'true') return;
        try {
            const response = await fetchAppData('/api/notifications/timer', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            assertSyncResponse(response, 'Could not cancel the background timer notification.');
            document.getElementById('timer-notification-status').textContent = '';
        } catch (error) {
            console.error('Unable to cancel a background timer notification:', error);
            document.getElementById('timer-notification-status').textContent = error instanceof Error
                ? error.message
                : 'Could not cancel a background timer notification.';
        }
    });
    return timerNotificationQueue;
}

async function loadNotificationPreferences() {
    const eventReminders = document.getElementById('event-reminders-setting');
    const timerAlerts = document.getElementById('timer-alerts-setting');
    eventReminders.checked = notificationPreferenceValue('focus_event_reminders');
    timerAlerts.checked = notificationPreferenceValue('focus_timer_alerts');
    try {
        const response = await fetchAppData('/api/notifications/preferences');
        assertSyncResponse(response, 'Could not load notification preferences.');
        const preferences = await response.json();
        eventReminders.checked = preferences.eventReminders;
        timerAlerts.checked = preferences.timerAlerts;
        localStorage.setItem('focus_event_reminders', String(preferences.eventReminders));
        localStorage.setItem('focus_timer_alerts', String(preferences.timerAlerts));
        if (!preferences.timerAlerts) void cancelTimerPushNotification();
    } catch (error) {
        console.error('Unable to load Focus notification preferences:', error);
        document.getElementById('notification-status').textContent =
            'Notification preferences could not sync; saved device settings are still applied.';
    }
}

function saveNotificationPreferences() {
    const preferences = {
        eventReminders: document.getElementById('event-reminders-setting').checked,
        timerAlerts: document.getElementById('timer-alerts-setting').checked
    };
    localStorage.setItem('focus_event_reminders', String(preferences.eventReminders));
    localStorage.setItem('focus_timer_alerts', String(preferences.timerAlerts));
    notificationPreferenceSaveQueue = notificationPreferenceSaveQueue.catch(() => {}).then(async () => {
        const response = await fetchAppData('/api/notifications/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(preferences)
        });
        assertSyncResponse(response, 'Could not save notification preferences.');
    }).catch(error => {
        console.error('Unable to save Focus notification preferences:', error);
        document.getElementById('notification-status').textContent =
            'Notification preferences could not sync. They remain saved on this device.';
    });
}

function registerFocusServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
            focusServiceWorkerRegistration = registration;
            if (!reminderCheckInterval) {
                reminderCheckInterval = window.setInterval(checkLocalEventReminders, 30_000);
            }
            updateNotificationSettings();
        })
        .catch(error => {
            console.error('Unable to register the Focus service worker:', error);
        });
}

function updateNotificationSettings() {
    const status = document.getElementById('notification-status');
    const button = document.getElementById('notification-toggle');
    if (!status || !button) return;

    const enabled = localStorage.getItem('focus_notifications_enabled') === 'true'
        && localStorage.getItem('focus_push_enabled') === 'true';
    button.textContent = enabled ? 'Disable notifications' : 'Enable notifications';
    button.className = enabled
        ? 'px-4 py-2 border border-red-500/60 text-red-600 dark:text-red-400 rounded-lg text-xs font-semibold hover:bg-red-500/10'
        : 'px-4 py-2 bg-mono-900 dark:bg-mono-100 text-white dark:text-mono-900 rounded-lg text-xs font-semibold hover:opacity-90';

    if (!('Notification' in window)) {
        status.textContent = 'Notifications are not supported by this browser.';
        button.disabled = true;
        return;
    }

    if (Notification.permission === 'granted') {
        status.textContent = enabled
            ? 'Push notifications are enabled on this device.'
            : 'Notifications are allowed but turned off for Focus.';
        button.disabled = false;
        return;
    }

    status.textContent = Notification.permission === 'denied'
        ? 'Notifications are blocked. Allow them in your browser or device settings.'
        : 'Notifications are not enabled.';
    button.disabled = false;
}

function requestNotificationToggle() {
    const enabled = localStorage.getItem('focus_notifications_enabled') === 'true'
        && localStorage.getItem('focus_push_enabled') === 'true';
    pendingNotificationAction = enabled ? 'disable' : 'enable';
    document.getElementById('notification-confirm-title').textContent = enabled
        ? 'Disable notifications?'
        : 'Enable notifications?';
    document.getElementById('notification-confirm-description').textContent = enabled
        ? 'Focus will stop sending push notifications to this device.'
        : 'Allow Focus to send event reminders and timer alerts to this device, including when the app is closed.';
    document.getElementById('notification-confirm-yes').className = enabled
        ? 'rounded-lg border border-red-500/60 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400'
        : 'rounded-lg bg-mono-900 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 dark:bg-mono-100 dark:text-mono-900';
    document.getElementById('notification-confirm-modal').classList.remove('hidden');
}

function closeNotificationConfirm() {
    pendingNotificationAction = null;
    document.getElementById('notification-confirm-modal').classList.add('hidden');
}

async function confirmNotificationToggle() {
    const action = pendingNotificationAction;
    closeNotificationConfirm();
    if (action === 'enable') {
        await enableNotifications();
    } else if (action === 'disable') {
        await disableNotifications();
    }
}

async function enableNotifications() {
    const status = document.getElementById('notification-status');
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        status.textContent = 'Notifications require a browser that supports service workers.';
        return;
    }

    try {
        if (Notification.permission === 'denied') {
            status.textContent = 'Notifications are blocked by your browser. Allow them in your browser or device settings, then try again.';
            return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            updateNotificationSettings();
            if (permission === 'denied') {
                status.textContent = 'Notifications were blocked. Allow them in your browser or device settings, then try again.';
            }
            return;
        }

        const configResponse = await fetchAppData('/api/notifications/config');
        assertSyncResponse(configResponse, 'Could not check push notification setup.');
        const config = await configResponse.json();
        if (!config.pushConfigured || !config.publicKey) {
            status.textContent = 'Push notifications are not configured on the server yet. Ask the app administrator to configure VAPID keys.';
            return;
        }
        if (!('PushManager' in window)) {
            status.textContent = 'Push notifications are not supported by this browser.';
            return;
        }

        focusServiceWorkerRegistration = await navigator.serviceWorker.ready;
        let subscription = await focusServiceWorkerRegistration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await focusServiceWorkerRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: decodeNotificationKey(config.publicKey)
            });
        }
        const saveResponse = await fetchAppData('/api/notifications/subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: subscription.toJSON() })
        });
        assertSyncResponse(saveResponse, 'Could not save your device push subscription.');
        localStorage.setItem('focus_push_endpoint', subscription.endpoint);
        localStorage.setItem('focus_notifications_enabled', 'true');
        localStorage.setItem('focus_push_enabled', 'true');
        updateNotificationSettings();
        await focusServiceWorkerRegistration.showNotification('Focus notifications enabled', {
            body: 'Scheduled event reminders will arrive on this device, even when Focus is closed.',
            icon: '/icon.svg',
            tag: 'focus-notifications-enabled'
        });
    } catch (error) {
        console.error('Unable to enable Focus notifications:', error);
        status.textContent = error instanceof Error
            ? error.message
            : 'Notifications could not be enabled. Please try again.';
    }
}

function decodeNotificationKey(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function disableNotifications() {
    try {
        const registration = focusServiceWorkerRegistration || await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        const endpoint = subscription?.endpoint || localStorage.getItem('focus_push_endpoint');
        if (endpoint) {
            const response = await fetchAppData('/api/notifications/subscriptions', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint })
            });
            assertSyncResponse(response, 'Could not remove the device push subscription.');
        }
        if (subscription) {
            await subscription.unsubscribe();
        }
        await cancelTimerPushNotification();
        localStorage.setItem('focus_notifications_enabled', 'false');
        localStorage.setItem('focus_push_enabled', 'false');
        localStorage.removeItem('focus_push_endpoint');
        updateNotificationSettings();
        document.getElementById('notification-status').textContent = 'Push notifications are disabled on this device.';
    } catch (error) {
        console.error('Unable to disable Focus notifications:', error);
        document.getElementById('notification-status').textContent = error instanceof Error
            ? error.message
            : 'Notifications could not be disabled on the server. Please try again.';
    }
}

async function showFocusNotification(title, body, tag) {
    if (Notification.permission !== 'granted'
        || localStorage.getItem('focus_notifications_enabled') !== 'true') return;

    const registration = focusServiceWorkerRegistration || await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
        body,
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag,
        data: { url: '/index.html' }
    });
}

async function notifyTimerFinished(mode) {
    if (!notificationPreferenceValue('focus_timer_alerts')) return;
    if (localStorage.getItem('focus_push_enabled') === 'true') return;
    if (mode === 'focus') {
        await showFocusNotification('Focus session complete', 'Your focus session is complete. Take a break.', 'focus-timer');
    } else {
        await showFocusNotification('Break complete', 'Your break is over. Ready to focus?', 'focus-timer');
    }
}

function checkLocalEventReminders() {
    if (Notification.permission !== 'granted'
        || localStorage.getItem('focus_notifications_enabled') !== 'true'
        || localStorage.getItem('focus_push_enabled') === 'true'
        || !notificationPreferenceValue('focus_event_reminders')) return;

    const now = Date.now();
    let firedReminders;
    try {
        const savedReminders = JSON.parse(localStorage.getItem('focus_fired_reminders') || '[]');
        firedReminders = Array.isArray(savedReminders) ? savedReminders : [];
    } catch (error) {
        console.error('Unable to read sent Focus reminders:', error);
        firedReminders = [];
    }
    const fired = new Set(firedReminders);
    state.calendar.forEach(event => {
        const reminderTime = Date.parse(event.reminderAt || '');
        if (!Number.isFinite(reminderTime) || reminderTime > now || fired.has(event.id)) return;
        fired.add(event.id);
        void showFocusNotification(
            `Upcoming: ${event.title}`,
            `${event.title}${event.time ? ` · ${event.time}` : ''}${event.location ? ` · ${event.location}` : ''}`,
            `event-${event.id}`
        ).catch(error => console.error('Unable to show event reminder:', error));
    });
    localStorage.setItem('focus_fired_reminders', JSON.stringify([...fired]));
}
