const MAX_JOURNAL_IMAGES = 3;
const MAX_JOURNAL_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_JOURNAL_IMAGE_BYTES = 220 * 1024;
const MAX_JOURNAL_IMAGE_DATA_CHARS = 850_000;
let journalImageListenersInitialized = false;

function escapeJournalHtml(value) {
    const element = document.createElement('span');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function initializeJournalImagePicker() {
    if (journalImageListenersInitialized) return;
    journalImageListenersInitialized = true;

    document.getElementById('journal-image-input').addEventListener('change', event => {
        const files = [...event.target.files];
        const status = document.getElementById('journal-image-status');
        const preview = document.getElementById('journal-image-preview');
        preview.replaceChildren();

        if (files.length > MAX_JOURNAL_IMAGES) {
            event.target.value = '';
            status.textContent = `Choose up to ${MAX_JOURNAL_IMAGES} photos per entry.`;
            return;
        }

        if (files.some(file => !file.type.startsWith('image/'))) {
            event.target.value = '';
            status.textContent = 'Only image files can be added.';
            return;
        }
        if (files.some(file => file.size > MAX_JOURNAL_SOURCE_BYTES)) {
            event.target.value = '';
            status.textContent = 'Each photo must be smaller than 15 MB.';
            return;
        }

        status.textContent = files.length
            ? `${files.length} photo${files.length === 1 ? '' : 's'} selected. Photos are resized before saving.`
            : '';
        files.forEach(file => {
            const image = document.createElement('img');
            image.src = URL.createObjectURL(file);
            image.alt = file.name;
            image.className = 'h-16 w-16 rounded-lg border border-mono-200 object-cover dark:border-mono-800';
            image.addEventListener('load', () => URL.revokeObjectURL(image.src), { once: true });
            preview.append(image);
        });
    });
}

async function resizeJournalImage(file) {
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
        let width = Math.max(1, Math.round(bitmap.width * scale));
        let height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');

        for (let attempt = 0; attempt < 6; attempt++) {
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Your browser could not prepare the selected photo.');
            context.drawImage(bitmap, 0, 0, width, height);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
            if (!blob) throw new Error('Your browser could not resize the selected photo.');
            if (blob.size <= MAX_JOURNAL_IMAGE_BYTES) {
                return await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('Your browser could not read the resized photo.'));
                    reader.readAsDataURL(blob);
                });
            }
            width = Math.round(width * 0.75);
            height = Math.round(height * 0.75);
        }
        throw new Error('A selected photo is too large to save after resizing. Choose a smaller image.');
    } finally {
        bitmap.close();
    }
}

async function saveJournalEntry() {
    const text = document.getElementById('journal-input-text').value.trim();
    const imageInput = document.getElementById('journal-image-input');
    const files = [...imageInput.files];
    const status = document.getElementById('journal-image-status');
    const saveButton = document.getElementById('save-journal-entry');
    if (!text && files.length === 0) return;

    saveButton.disabled = true;
    status.textContent = files.length ? 'Resizing photos and saving your journal...' : '';
    try {
        const images = await Promise.all(files.map(resizeJournalImage));
        const existingImageChars = state.journals.reduce((total, entry) =>
            total + (Array.isArray(entry.images)
                ? entry.images.reduce((imageTotal, image) => imageTotal + (typeof image === 'string' ? image.length : 0), 0)
                : 0), 0);
        const newImageChars = images.reduce((total, image) => total + image.length, 0);
        if (existingImageChars + newImageChars > MAX_JOURNAL_IMAGE_DATA_CHARS) {
            throw new Error('Your synced journal photo storage is full. Remove older photo entries before adding more.');
        }
        const entry = {
            id: `j_${Date.now()}`,
            text,
            date: new Date().toLocaleDateString(),
            ...(images.length ? { images } : {})
        };

        state.journals.unshift(entry);
        persistAppData('journals', state.journals);
        document.getElementById('journal-input-text').value = '';
        imageInput.value = '';
        document.getElementById('journal-image-preview').replaceChildren();
        status.textContent = '';
        renderJournal();
    } catch (error) {
        console.error('Unable to save journal photos:', error);
        status.textContent = error instanceof Error ? error.message : 'Unable to save the selected photos.';
    } finally {
        saveButton.disabled = false;
    }
}

function renderJournal() {
    initializeJournalImagePicker();
    document.getElementById('journal-date-stamp').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const container = document.getElementById('journal-history-list');

    if (state.journals.length === 0) {
        container.innerHTML = '<p class="text-xs text-mono-400 font-mono">No journal logs recorded yet.</p>';
        return;
    }

    container.innerHTML = state.journals.map(entry => {
        const images = Array.isArray(entry.images)
            ? entry.images.filter(image => typeof image === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(image))
            : [];
        return `
            <article class="p-3 border border-mono-200 dark:border-mono-800 rounded-xl space-y-2 font-mono text-xs">
                <div class="flex items-center justify-between text-mono-400 text-[10px]">
                    <span>${escapeJournalHtml(entry.date)}</span>
                    <button type="button" data-delete-journal="${escapeJournalHtml(entry.id)}" aria-label="Delete journal entry from ${escapeJournalHtml(entry.date)}" class="rounded p-1 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
                </div>
                ${entry.text ? `<p class="whitespace-pre-wrap break-words text-mono-800 dark:text-mono-200 leading-relaxed">${escapeJournalHtml(entry.text)}</p>` : ''}
                ${images.length ? `<div class="grid grid-cols-2 gap-2">${images.map((image, index) => `<img src="${escapeJournalHtml(image)}" alt="Journal memory ${index + 1}" loading="lazy" class="max-h-48 w-full rounded-lg object-cover">`).join('')}</div>` : ''}
            </article>
        `;
    }).join('');

    container.querySelectorAll('[data-delete-journal]').forEach(button => {
        button.addEventListener('click', () => deleteJournalEntry(button.dataset.deleteJournal));
    });
}

function deleteJournalEntry(id) {
    if (!window.confirm('Delete this journal entry and its photos?')) return;
    state.journals = state.journals.filter(entry => entry.id !== id);
    persistAppData('journals', state.journals);
    renderJournal();
}
