/* ReadWrite — app.js */

const RESULTS_KEY = 'rw_results';
const SCAN_URL = 'https://ra-match-scanner.up.railway.app/api/scan';

/* ── Utilities ── */

function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) el.textContent = msg;
}

function clearError() {
  const el = document.getElementById('error-msg');
  if (el) el.textContent = '';
}

/* ── Index page logic ── */

function initIndex() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const cameraInput = document.getElementById('camera-input');
  const thumbGrid = document.getElementById('thumb-grid');
  const scanBtn = document.getElementById('scan-btn');
  const loading = document.getElementById('loading');

  let selectedFiles = [];

  // File picker
  document.getElementById('btn-files').addEventListener('click', () => fileInput.click());
  document.getElementById('btn-camera').addEventListener('click', () => cameraInput.click());

  fileInput.addEventListener('change', () => addFiles(fileInput.files));
  cameraInput.addEventListener('change', () => addFiles(cameraInput.files));

  // Drag and drop
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    addFiles(e.dataTransfer.files);
  });

  function addFiles(files) {
    for (const file of files) {
      if (file.type.startsWith('image/')) selectedFiles.push(file);
    }
    renderThumbs();
    updateScanBtn();
  }

  function renderThumbs() {
    const count = selectedFiles.length;
    document.getElementById('file-count').textContent =
      count === 0 ? '' : `${count} image${count > 1 ? 's' : ''} selected`;
  }

  function updateScanBtn() {
    scanBtn.disabled = selectedFiles.length === 0;
  }

  updateScanBtn();

  // Scan
  scanBtn.addEventListener('click', async () => {
    clearError();
    if (selectedFiles.length === 0) return;

    scanBtn.disabled = true;
    loading.style.display = 'block';

    try {
      const formData = new FormData();
      selectedFiles.forEach(file => formData.append('files', file));

      const response = await fetch(SCAN_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${response.status}`);
      }

      const results = await response.json();
      sessionStorage.setItem(RESULTS_KEY, JSON.stringify(results));
      window.location.href = 'results.html';
    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
      scanBtn.disabled = false;
    } finally {
      loading.style.display = 'none';
    }
  });
}

/* ── Results page logic ── */

function initResults() {
  const raw = sessionStorage.getItem(RESULTS_KEY);
  if (!raw) {
    document.querySelector('.container').innerHTML =
      '<a href="index.html" class="back-btn">← Back</a><p style="margin-top:24px;color:var(--text-muted)">No results found. Please scan some notes first.</p>';
    return;
  }

  const data = JSON.parse(raw);
  document.getElementById('summary-text').textContent = data.summary || '';
  document.getElementById('transcription-text').textContent = data.transcription || '';

  const copiedMsg = document.getElementById('copied-msg');

  function getText(section) {
    const el = document.getElementById(`${section}-text`);
    return el.tagName === 'TEXTAREA' ? el.value : el.textContent;
  }

  // Edit toggle
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      const el = document.getElementById(`${section}-text`);
      const isEditing = el.tagName === 'TEXTAREA';

      if (isEditing) {
        const div = document.createElement('div');
        div.className = 'result-text';
        div.id = `${section}-text`;
        div.textContent = el.value;
        el.replaceWith(div);
        btn.textContent = 'Edit';
      } else {
        const textarea = document.createElement('textarea');
        textarea.className = 'result-textarea';
        textarea.id = `${section}-text`;
        textarea.value = el.textContent;
        el.replaceWith(textarea);
        textarea.focus();
        btn.textContent = 'Done';
      }
    });
  });

  async function share(text) {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (_) { /* user cancelled or not supported */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      copiedMsg.textContent = 'Copied to clipboard!';
      setTimeout(() => { copiedMsg.textContent = ''; }, 2500);
    } catch (_) {
      copiedMsg.textContent = 'Could not copy. Please select and copy manually.';
    }
  }

  document.querySelectorAll('.btn-share').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target === 'summary') share(getText('summary'));
      else if (target === 'transcription') share(getText('transcription'));
      else share(`Summary:\n${getText('summary')}\n\nTranscription:\n${getText('transcription')}`);
    });
  });
}

/* ── Router ── */

if (document.getElementById('scan-btn')) {
  initIndex();
} else if (document.getElementById('summary-text')) {
  initResults();
}
