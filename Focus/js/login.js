document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('container');
    const registerBtn = document.getElementById('register');
    const loginBtn = document.getElementById('login');

    if (registerBtn && loginBtn && container) {
        registerBtn.addEventListener('click', () => container.classList.add('active'));
        loginBtn.addEventListener('click', () => container.classList.remove('active'));
    }

    document.querySelectorAll('#auth-screen input[type="email"]').forEach(input => {
        input.addEventListener('input', () => {
            input.setCustomValidity(input.validity.typeMismatch
                ? 'Enter a valid email address, such as name@example.com.'
                : '');
        });
    });
});

async function submitCredentials(endpoint, credentials, form, pendingLabel) {
    const errorMessage = form.querySelector('.auth-error');
    const submitButton = form.querySelector('button[type="submit"]');
    errorMessage.hidden = true;
    errorMessage.textContent = '';

    if (!form.reportValidity()) return;

    if (window.location.protocol === 'file:') {
        errorMessage.textContent = 'Open Focus from its website to use your account.';
        errorMessage.hidden = false;
        return;
    }

    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = pendingLabel;

    try {
        const response = await fetch(appApiUrl(`/api/auth/${endpoint}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials)
        });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('application/json')) {
            throw new Error('Could not reach the account service. Check your connection and try again.');
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Authentication failed.');
        if (!data.token) throw new Error('The server did not return an authentication token.');

        localStorage.setItem('focus_auth_token', data.token);
        window.location.assign(new URL('./', window.location.href));
    } catch (error) {
        errorMessage.textContent = error instanceof TypeError
            ? 'Could not connect to the server. Check that the app backend is running and try again.'
            : error instanceof Error
                ? error.message
                : 'Authentication failed. Please try again.';
        errorMessage.hidden = false;
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
    }
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    await submitCredentials('login', { email, password }, form, 'Signing in...');
}

async function handleRegisterSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    await submitCredentials('signup', { name, email, password }, form, 'Creating account...');
}
