import { HttpError, json, readJson } from './http.js';
import { pushIsConfigured, sendWebPush } from './push.js';

const MAX_SUBSCRIPTIONS_PER_USER = 20;
const PUSH_ENDPOINT_HOSTS = [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'push.services.mozilla.com',
    'web.push.apple.com'
];

function isAllowedPushEndpoint(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        return url.protocol === 'https:'
            && (PUSH_ENDPOINT_HOSTS.includes(host)
                || host.endsWith('.notify.windows.com'));
    } catch {
        return false;
    }
}

export async function handleNotifications(request, env, userId, pathname) {
    if (pathname === '/api/notifications/config') {
        if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' }, { Allow: 'GET' });
        return json(200, {
            pushConfigured: pushIsConfigured(env),
            publicKey: env.PUSH_VAPID_PUBLIC_KEY || ''
        });
    }

    if (pathname === '/api/notifications/preferences') {
        if (request.method === 'GET') {
            const preferences = await env.DB.prepare(`
                SELECT event_reminders, timer_alerts FROM notification_preferences WHERE user_id = ?1`
            ).bind(userId).first();
            return json(200, {
                eventReminders: preferences ? preferences.event_reminders === 1 : true,
                timerAlerts: preferences ? preferences.timer_alerts === 1 : true
            });
        }
        if (request.method !== 'PUT') return json(405, { error: 'Method not allowed.' }, { Allow: 'GET, PUT' });
        const body = await readJson(request, 32_000);
        if (typeof body.eventReminders !== 'boolean' || typeof body.timerAlerts !== 'boolean') {
            throw new HttpError(400, 'Notification preferences must be boolean values.');
        }
        await env.DB.prepare(`
            INSERT INTO notification_preferences (user_id, event_reminders, timer_alerts)
            VALUES (?1, ?2, ?3)
            ON CONFLICT (user_id) DO UPDATE SET event_reminders = excluded.event_reminders,
                timer_alerts = excluded.timer_alerts`)
            .bind(userId, body.eventReminders ? 1 : 0, body.timerAlerts ? 1 : 0).run();
        return json(200, { saved: true });
    }

    if (pathname === '/api/notifications/timer') {
        if (request.method === 'DELETE') {
            await env.DB.prepare('DELETE FROM timer_notifications WHERE user_id = ?1').bind(userId).run();
            return json(200, { removed: true });
        }
        if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, { Allow: 'POST, DELETE' });
        const body = await readJson(request, 32_000);
        if (typeof body.endsAt !== 'string' || !['focus', 'short', 'long'].includes(body.mode)) {
            throw new HttpError(400, 'The scheduled timer end time is invalid.');
        }
        const endsAt = Date.parse(body.endsAt);
        if (!Number.isFinite(endsAt)
            || endsAt <= Date.now()
            || endsAt > Date.now() + 3 * 60 * 60 * 1000) {
            throw new HttpError(400, 'The scheduled timer end time is invalid.');
        }
        await env.DB.prepare(`
            INSERT INTO timer_notifications (user_id, ends_at, mode, claimed_at, sent_at)
            VALUES (?1, ?2, ?3, NULL, NULL)
            ON CONFLICT (user_id) DO UPDATE SET ends_at = excluded.ends_at,
                mode = excluded.mode, claimed_at = NULL, sent_at = NULL`)
            .bind(userId, new Date(endsAt).toISOString(), body.mode).run();
        return json(200, { saved: true });
    }

    if (pathname !== '/api/notifications/subscriptions') {
        throw new HttpError(404, 'Not found.');
    }

    if (request.method === 'GET') {
        const result = await env.DB.prepare(
            'SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?1'
        ).bind(userId).first();
        return json(200, { count: result.count });
    }

    if (!['POST', 'DELETE'].includes(request.method)) {
        return json(405, { error: 'Method not allowed.' }, { Allow: 'GET, POST, DELETE' });
    }

    const body = await readJson(request, 32_000);
    if (request.method === 'DELETE') {
        if (typeof body.endpoint !== 'string' || !isAllowedPushEndpoint(body.endpoint)) {
            throw new HttpError(400, 'A valid push subscription endpoint is required.');
        }
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1 AND user_id = ?2')
            .bind(body.endpoint, userId).run();
        return json(200, { removed: true });
    }

    if (!pushIsConfigured(env)) {
        throw new HttpError(503, 'Web Push is not configured on this server yet.');
    }
    const subscription = body.subscription;
    if (!subscription || typeof subscription !== 'object'
        || typeof subscription.endpoint !== 'string'
        || !isAllowedPushEndpoint(subscription.endpoint)
        || typeof subscription.keys?.p256dh !== 'string'
        || typeof subscription.keys?.auth !== 'string'
        || subscription.keys.p256dh.length > 200
        || subscription.keys.auth.length > 100) {
        throw new HttpError(400, 'The browser push subscription is invalid.');
    }

    const existing = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?1'
    ).bind(userId).first();
    const belongsToUser = await env.DB.prepare(
        'SELECT 1 FROM push_subscriptions WHERE endpoint = ?1 AND user_id = ?2'
    ).bind(subscription.endpoint, userId).first();
    const endpointOwner = await env.DB.prepare(
        'SELECT user_id FROM push_subscriptions WHERE endpoint = ?1'
    ).bind(subscription.endpoint).first();
    if (endpointOwner && endpointOwner.user_id !== userId) {
        throw new HttpError(409, 'This push subscription belongs to another account.');
    }
    if (existing.count >= MAX_SUBSCRIPTIONS_PER_USER && !belongsToUser) {
        throw new HttpError(409, 'This account has reached its device notification limit.');
    }

    await env.DB.prepare(`
        INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth_secret)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id,
            p256dh = excluded.p256dh, auth_secret = excluded.auth_secret,
            created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
        .bind(subscription.endpoint, userId, subscription.keys.p256dh, subscription.keys.auth).run();

    return json(201, { saved: true });
}

export async function deliverDueReminders(env) {
    const now = new Date().toISOString();
    if (!pushIsConfigured(env)) {
        const dueReminder = await env.DB.prepare(`
            SELECT 1 FROM event_reminders
            WHERE sent_at IS NULL AND remind_at <= ?1 AND remind_at >= ?2 LIMIT 1`)
            .bind(now, new Date(Date.now() - 60 * 60 * 1000).toISOString()).first();
        if (dueReminder) {
            console.error('Event reminders are due, but Web Push is not configured on this Worker.');
        }
        return;
    }

    const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await env.DB.prepare(`
        UPDATE event_reminders SET sent_at = ?1, claimed_at = NULL
        WHERE sent_at IS NULL AND remind_at < ?2`)
        .bind(now, staleBefore).run();

    const claimExpiredBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const due = await env.DB.prepare(`
        SELECT user_id, event_id, remind_at, title, event_date, event_time, location
        FROM event_reminders
        WHERE sent_at IS NULL AND remind_at <= ?1
            AND (claimed_at IS NULL OR claimed_at <= ?2)
        ORDER BY remind_at LIMIT 100`)
        .bind(now, claimExpiredBefore).all();

    for (const reminder of due.results) {
        const claimedAt = new Date().toISOString();
        const claim = await env.DB.prepare(`
            UPDATE event_reminders SET claimed_at = ?1
            WHERE user_id = ?2 AND event_id = ?3 AND sent_at IS NULL
                AND (claimed_at IS NULL OR claimed_at <= ?4)`)
            .bind(claimedAt, reminder.user_id, reminder.event_id, claimExpiredBefore).run();
        if (!claim.meta.changes) continue;

        try {
            const preferences = await env.DB.prepare(
                'SELECT event_reminders FROM notification_preferences WHERE user_id = ?1'
            ).bind(reminder.user_id).first();
            if (preferences && preferences.event_reminders === 0) {
                await env.DB.prepare(`
                    UPDATE event_reminders SET sent_at = ?1, claimed_at = NULL
                    WHERE user_id = ?2 AND event_id = ?3`)
                    .bind(new Date().toISOString(), reminder.user_id, reminder.event_id).run();
                continue;
            }

            const subscriptions = await env.DB.prepare(
                'SELECT endpoint, p256dh, auth_secret FROM push_subscriptions WHERE user_id = ?1'
            ).bind(reminder.user_id).all();
            if (!subscriptions.results.length) {
                await env.DB.prepare(
                    'UPDATE event_reminders SET claimed_at = NULL WHERE user_id = ?1 AND event_id = ?2'
                ).bind(reminder.user_id, reminder.event_id).run();
                continue;
            }

            const message = {
                title: `Upcoming: ${reminder.title}`,
                body: `${reminder.event_date}${reminder.event_time ? ` · ${reminder.event_time}` : ''}${reminder.location ? ` · ${reminder.location}` : ''}`,
                tag: `event-${reminder.event_id}`,
                url: '/index.html'
            };
            for (const subscription of subscriptions.results) {
                try {
                    await sendWebPush({
                        endpoint: subscription.endpoint,
                        p256dh: subscription.p256dh,
                        auth: subscription.auth_secret
                    }, message, env);
                } catch (error) {
                    if (error.status === 404 || error.status === 410) {
                        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1')
                            .bind(subscription.endpoint).run();
                        continue;
                    }
                    throw error;
                }
            }
            await env.DB.prepare(`
                UPDATE event_reminders SET sent_at = ?1, claimed_at = NULL
                WHERE user_id = ?2 AND event_id = ?3`)
                .bind(new Date().toISOString(), reminder.user_id, reminder.event_id).run();
        } catch (error) {
            console.error(`Unable to deliver reminder for event ${reminder.event_id}:`, error);
            await env.DB.prepare(`
                UPDATE event_reminders SET claimed_at = NULL
                WHERE user_id = ?1 AND event_id = ?2 AND sent_at IS NULL`)
                .bind(reminder.user_id, reminder.event_id).run();
        }
    }

    await deliverDueTimerNotifications(env, now, claimExpiredBefore);
}

async function deliverDueTimerNotifications(env, now, claimExpiredBefore) {
    const due = await env.DB.prepare(`
        SELECT user_id, ends_at, mode FROM timer_notifications
        WHERE sent_at IS NULL AND ends_at <= ?1
            AND (claimed_at IS NULL OR claimed_at <= ?2)
        ORDER BY ends_at LIMIT 100`)
        .bind(now, claimExpiredBefore).all();

    for (const timer of due.results) {
        const claim = await env.DB.prepare(`
            UPDATE timer_notifications SET claimed_at = ?1
            WHERE user_id = ?2 AND sent_at IS NULL
                AND (claimed_at IS NULL OR claimed_at <= ?3)`)
            .bind(new Date().toISOString(), timer.user_id, claimExpiredBefore).run();
        if (!claim.meta.changes) continue;

        try {
            const preferences = await env.DB.prepare(
                'SELECT timer_alerts FROM notification_preferences WHERE user_id = ?1'
            ).bind(timer.user_id).first();
            if (preferences && preferences.timer_alerts === 0) {
                await env.DB.prepare('DELETE FROM timer_notifications WHERE user_id = ?1')
                    .bind(timer.user_id).run();
                continue;
            }
            const subscriptions = await env.DB.prepare(
                'SELECT endpoint, p256dh, auth_secret FROM push_subscriptions WHERE user_id = ?1'
            ).bind(timer.user_id).all();
            if (!subscriptions.results.length) {
                await env.DB.prepare('UPDATE timer_notifications SET claimed_at = NULL WHERE user_id = ?1')
                    .bind(timer.user_id).run();
                continue;
            }

            const message = timer.mode === 'focus'
                ? { title: 'Focus session complete', body: 'Your focus session is complete. Take a break.', tag: 'focus-timer', url: '/index.html' }
                : { title: 'Break complete', body: 'Your break is over. Ready to focus?', tag: 'focus-timer', url: '/index.html' };
            for (const subscription of subscriptions.results) {
                try {
                    await sendWebPush({
                        endpoint: subscription.endpoint,
                        p256dh: subscription.p256dh,
                        auth: subscription.auth_secret
                    }, message, env);
                } catch (error) {
                    if (error.status === 404 || error.status === 410) {
                        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1')
                            .bind(subscription.endpoint).run();
                        continue;
                    }
                    throw error;
                }
            }
            await env.DB.prepare('DELETE FROM timer_notifications WHERE user_id = ?1')
                .bind(timer.user_id).run();
        } catch (error) {
            console.error(`Unable to deliver timer notification for user ${timer.user_id}:`, error);
            await env.DB.prepare('UPDATE timer_notifications SET claimed_at = NULL WHERE user_id = ?1 AND sent_at IS NULL')
                .bind(timer.user_id).run();
        }
    }
}
