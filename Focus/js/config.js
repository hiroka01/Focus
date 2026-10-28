window.FOCUS_API_BASE_URL = '';

function appApiUrl(path) {
    return new URL(path, window.FOCUS_API_BASE_URL || window.location.origin).toString();
}
