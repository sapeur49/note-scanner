/* ReadWrite — app.js */

const STORAGE_KEY = 'rw_api_key';
const RESULTS_KEY = 'rw_results';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const SCAN_PROMPT = `You are processing scanned note images. For each image provided:
1. Transcribe ALL visible text exactly as written, preserving structure, lists, and formatting.
2. After transcribing, produce a concise summary highlighting key points and any action items.

Respond with ONLY valid JSON in this exact shape:
{
  "summary": "concise summary with key points and action items",
  "transcription": "full verbatim transcription of all text across all images"
}`;

/* ── Utilities ── */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) el.textContent = msg;
}

function clearError() {
  const el = document.getElementById('error-msg');
  if (el) el.textContent = '';
}

/* ── Index page logic ── */

async function initIndex() {
  const apiKeyInput = document.getElementById('api-key');
  const toggleBtn = document.getElementById('toggle-key');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const cameraInput = document.getElementById('camera-input');
  const thumbGrid = document.getElementById('thumb-grid');
  const scanBtn = document.getElementById('scan-btn');
  const loading = document.getElementById('loading');

  let selectedFiles = [];

  // Restore saved key
  const savedKey = localStorage.getItem(STORAGE_KEY) || '';
  if (savedKey) apiKeyInput.value = savedKey;

  // Save key on change
  apiKeyInput.addEventListener('input', () => {
    const val = apiKeyInput.value.trim();
    if (val) localStorage.setItem(STORAGE_KEY, val);
    else localStorage.removeItem(STORAGE_KEY);
    updateScanBtn();
  });

  // Toggle key visibility
  toggleBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? '🙈' : '👁';
  });

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
    thumbGrid.innerHTML = '';
    selectedFiles.forEach(file => {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      thumbGrid.appendChild(img);
    });
  }

  function updateScanBtn() {
    const hasKey = apiKeyInput.value.trim().length > 0;
    const hasImages = selectedFiles.length > 0;
    scanBtn.disabled = !(hasKey && hasImages);
  }

  updateScanBtn();

  // Scan
  scanBtn.addEventListener('click', async () => {
    clearError();
    const key = apiKeyInput.value.trim();
    if (!key || selectedFiles.length === 0) return;

    scanBtn.disabled = true;
    loading.style.display = 'block';

    try {
      const imageBlocks = await Promise.all(
        selectedFiles.map(async file => ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: file.type,
            data: await fileToBase64(file),
          },
        }))
      );

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-calls': 'true',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [...imageBlocks, { type: 'text', text: SCAN_PROMPT }],
          }],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error ${response.status}`);
      }

      const data = await response.json();
      const raw = data.content?.[0]?.text || '';

      // Parse JSON from response, strip markdown fences if present
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Unexpected response format from Claude.');
      const results = JSON.parse(jsonMatch[0]);

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

  const { summary, transcription } = JSON.parse(raw);
  document.getElementById('summary-text').textContent = summary || '';
  document.getElementById('transcription-text').textContent = transcription || '';

  const copiedMsg = document.getElementById('copied-msg');

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
      if (target === 'summary') share(summary || '');
      else if (target === 'transcription') share(transcription || '');
      else share(`Summary:\n${summary}\n\nTranscription:\n${transcription}`);
    });
  });
}

/* ── Router ── */

if (document.getElementById('scan-btn')) {
  initIndex();
} else if (document.getElementById('summary-text')) {
  initResults();
}
