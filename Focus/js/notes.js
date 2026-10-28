function createNewNote() {
    const newNote = {
        id: 'n_' + Date.now(),
        title: 'Untitled Note',
        content: '',
        pinned: false,
        updatedAt: new Date().toLocaleDateString()
    };
    state.notes.unshift(newNote);
    state.activeNoteId = newNote.id;
    persistAppData('notes', state.notes);
    renderNotes();
}

function renderNotes() {
    const query = (document.getElementById('note-search').value || '').toLowerCase();
    const listContainer = document.getElementById('notes-list');

    let filtered = state.notes.filter(n => n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query));
    filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    listContainer.innerHTML = filtered.map(n => `
        <div onclick="setActiveNote('${n.id}')" class="p-2.5 border border-mono-200 dark:border-mono-800 rounded-xl cursor-pointer ${n.id === state.activeNoteId ? 'bg-mono-100 dark:bg-mono-900 border-mono-900 dark:border-mono-100 font-bold' : 'hover:bg-mono-50 dark:hover:bg-mono-900'}">
            <div class="flex items-center justify-between text-xs font-mono">
                <span class="truncate">${n.title || 'Untitled'}</span>
                ${n.pinned ? '<span class="text-[10px]">📌</span>' : ''}
            </div>
            <div class="text-[10px] text-mono-400 font-mono truncate mt-1">${n.content || 'Empty note...'}</div>
        </div>
    `).join('');

    const activeNote = state.notes.find(n => n.id === state.activeNoteId);
    if (activeNote) {
        document.getElementById('note-editor-title').value = activeNote.title;
        document.getElementById('note-editor-content').value = activeNote.content;
        document.getElementById('note-pin-btn').textContent = activeNote.pinned ? 'Unpin' : 'Pin';
    } else {
        document.getElementById('note-editor-title').value = '';
        document.getElementById('note-editor-content').value = '';
    }
}

function setActiveNote(id) {
    state.activeNoteId = id;
    renderNotes();
}

function saveActiveNote() {
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (!note) return;
    note.title = document.getElementById('note-editor-title').value;
    note.content = document.getElementById('note-editor-content').value;
    note.updatedAt = new Date().toLocaleDateString();
    persistAppData('notes', state.notes);
    renderNotes();
}

function togglePinActiveNote() {
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (note) {
        note.pinned = !note.pinned;
        persistAppData('notes', state.notes);
        renderNotes();
    }
}

function copyActiveNote() {
    const note = state.notes.find(n => n.id === state.activeNoteId);
    if (note) {
        navigator.clipboard.writeText(`${note.title}\n\n${note.content}`);
    }
}

function deleteActiveNote() {
    state.notes = state.notes.filter(n => n.id !== state.activeNoteId);
    state.activeNoteId = state.notes.length > 0 ? state.notes[0].id : null;
    persistAppData('notes', state.notes);
    renderNotes();
}