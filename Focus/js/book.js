// js/books.js - Apple Books Style & Format Validation

let db;
const request = indexedDB.open("FocusBooksDB", 1);
let resolveBooksDatabase;
let rejectBooksDatabase;
const booksDatabaseReady = new Promise((resolve, reject) => {
    resolveBooksDatabase = resolve;
    rejectBooksDatabase = reject;
});

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
    }
};

request.onsuccess = (e) => {
    db = e.target.result;
    resolveBooksDatabase(db);
    renderBooks();
};

request.onerror = () => rejectBooksDatabase(request.error || new Error('Could not open the local book library.'));

let books = JSON.parse(localStorage.getItem('focus_books')) || [];

function saveBooksState() {
    state.books = books;
    persistAppData('books', books);
    renderBooks();
}

function storeFileInDB(id, fileBlob) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Local book storage is not initialized."));
        const tx = db.transaction("files", "readwrite");
        const store = tx.objectStore("files");
        store.put({ id: id, blob: fileBlob });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
    });
}

function getFileFromDB(id) {
    return booksDatabaseReady.then(() => new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readonly");
        const store = tx.objectStore("files");
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = (e) => reject(e);
    }));
}

function deleteFileFromDB(id) {
    if (!db) return;
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(id);
}

async function clearLocalBookFiles() {
    const database = await booksDatabaseReady;
    await new Promise((resolve, reject) => {
        const transaction = database.transaction('files', 'readwrite');
        transaction.objectStore('files').clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not clear local book files.'));
        transaction.onabort = () => reject(transaction.error || new Error('Could not clear local book files.'));
    });
}

// 1. & 2. Handle Upload with Strict Validation
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    
    // Error handling for unsupported file types
    if (ext !== 'pdf' && ext !== 'epub') {
        alert("Files not supported. Please try again.");
        event.target.value = '';
        return;
    }

    const newBook = {
        id: 'book_' + Date.now(),
        title: file.name.replace(/\.[^/.]+$/, ""),
        format: ext,
        createdAt: new Date().toISOString()
    };

    try {
        await storeFileInDB(newBook.id, file);
        const contentType = ext === 'pdf' ? 'application/pdf' : 'application/epub+zip';
        try {
            const response = await fetchAppData(`/api/books/${newBook.id}/file`, {
                method: 'PUT',
                headers: { 'Content-Type': contentType },
                body: file
            }, 120000);
            assertSyncResponse(response, 'Could not sync this book file. The file is saved on this device.');
        } catch (error) {
            setAppDataSyncStatus(syncFailureMessage(
                error,
                'This book file is saved on this device but could not be synced. Try again later.'
            ), true);
        }
        books.push(newBook);
        saveBooksState();
    } catch (err) {
        console.error("Storage error:", err);
        alert("Failed to save file locally.");
    }

    event.target.value = '';
}

// 3. Apple Books Reference Library Grid Render
function renderBooks() {
    const container = document.getElementById('books-list');
    if (!container) return;

    if (books.length === 0) {
        container.innerHTML = `
            <div class="col-span-full border border-dashed border-mono-300 dark:border-mono-800 p-12 text-center rounded-lg">
                <p class="text-xs text-mono-500 font-mono">Your library is empty. Click "+ Add Book" to upload PDF or EPUB files.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = books.map(book => `
        <div class="group flex flex-col space-y-2 cursor-pointer" onclick="readBook('${book.id}')">
            <!-- Book Cover Card (Apple Books Style Aspect Ratio) -->
            <div class="relative w-full aspect-[3/4] bg-mono-100 dark:bg-mono-900 border border-mono-200 dark:border-mono-800 rounded-lg p-4 flex flex-col justify-between shadow-sm group-hover:border-mono-900 dark:group-hover:border-mono-100 transition-all">
                <div class="flex items-center justify-between">
                    <span class="text-[9px] font-mono uppercase px-1.5 py-0.5 bg-mono-200 dark:bg-mono-800 rounded text-mono-700 dark:text-mono-300">${book.format}</span>
                    <button onclick="event.stopPropagation(); deleteBook('${book.id}')" class="text-xs text-mono-400 hover:text-red-500 font-mono opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                </div>
                <div class="my-auto text-center">
                    <span class="text-3xl font-mono text-mono-300 dark:text-mono-700">📖</span>
                </div>
                <div class="text-[10px] font-mono text-mono-500 truncate">
                    ${new Date(book.createdAt).toLocaleDateString()}
                </div>
            </div>

            <!-- Title & Details -->
            <div>
                <h3 class="font-medium text-xs truncate" title="${book.title}">${book.title}</h3>
                <p class="text-[10px] text-mono-500 font-mono uppercase">${book.format} Document</p>
            </div>
        </div>
    `).join('');
}

async function deleteBook(id) {
    if (!confirm("Are you sure you want to remove this book from your library?")) return;
    books = books.filter(b => b.id !== id);
    deleteFileFromDB(id);
    saveBooksState();
    try {
        const response = await fetchAppData(`/api/books/${id}/file`, { method: 'DELETE' });
        assertSyncResponse(response, 'Could not sync the book removal. Please try again later.');
    } catch (error) {
        setAppDataSyncStatus(syncFailureMessage(
            error,
            'The book was removed from this device but could not be synced. Try again later.'
        ), true);
    }
}

async function readBook(id) {
    const book = books.find(b => b.id === id);
    if (!book) return;

    let blob = null;
    try {
        const response = await fetchAppData(`/api/books/${id}/file`);
        if (response.ok) {
            blob = await response.blob();
        } else if (response.status !== 404) {
            assertSyncResponse(response, 'Could not load this book file.');
        }
    } catch (error) {
        setAppDataSyncStatus(syncFailureMessage(
            error,
            'Could not load the online copy. Checking this device for the book file.'
        ), true);
    }
    if (!blob) blob = await getFileFromDB(id);
    if (!blob) {
        alert("File binary not found in storage. Please re-upload.");
        return;
    }

    const modal = document.getElementById('reader-modal');
    const titleEl = document.getElementById('reader-title');
    const viewer = document.getElementById('reader-viewer');

    titleEl.textContent = book.title;
    viewer.innerHTML = '';
    modal.classList.remove('hidden');

    const fileUrl = URL.createObjectURL(blob);

    if (book.format === 'pdf') {
        const iframe = document.createElement('iframe');
        iframe.src = fileUrl;
        iframe.className = "w-full h-full border-0 max-w-4xl bg-white rounded shadow-lg";
        viewer.appendChild(iframe);
    } else if (book.format === 'epub') {
        const container = document.createElement('div');
        container.id = "epub-render-area";
        container.className = "w-full max-w-3xl h-[80vh] bg-white text-black p-6 rounded shadow-lg";
        viewer.appendChild(container);

        if (window.ePub) {
            const epubBook = ePub(fileUrl);
            const rendition = epubBook.renderTo("epub-render-area", {
                width: "100%",
                height: "100%",
                spread: "always"
            });
            rendition.display();
        } else {
            viewer.innerHTML = `<p class="text-xs font-mono text-white p-4">EPUB reader library missing.</p>`;
        }
    }
}

async function migrateLegacyBookFiles() {
    await booksDatabaseReady;
    for (const book of books) {
        const localFile = await getFileFromDB(book.id);
        if (!localFile) continue;
        const contentType = book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
        const response = await fetchAppData(`/api/books/${book.id}/file`, {
            method: 'PUT',
            headers: { 'Content-Type': contentType },
            body: localFile
        }, 120000);
        assertSyncResponse(response, 'Some book files could not be synced. Try again later.');
    }
}

function closeReader() {
    const modal = document.getElementById('reader-modal');
    const viewer = document.getElementById('reader-viewer');
    modal.classList.add('hidden');
    viewer.innerHTML = '';
}

document.addEventListener('DOMContentLoaded', () => {
    renderBooks();
});