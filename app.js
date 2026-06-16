/* ReadWrite — app.js */

const RESULTS_KEY  = 'rw_results';
const IMAGES_KEY   = 'rw_images';
const LIGHTBOX_KEY = 'rw_lightbox';
const SCAN_URL = '/api/scan';
const IMAGES_SIZE_LIMIT = 4 * 1024 * 1024; // 4 MB

/* ── Utilities ── */

function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) el.textContent = msg;
}

function clearError() {
  const el = document.getElementById('error-msg');
  if (el) el.textContent = '';
}

/* ── Thumbnail helper ── */

function resizeImage(file, maxPx, quality) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
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
      const [thumbs, lightboxImgs] = await Promise.all([
        Promise.all(selectedFiles.map(f => resizeImage(f, 150, 0.5))),
        Promise.all(selectedFiles.map(f => resizeImage(f, 1500, 0.85))),
      ]);
      const thumbsJson    = JSON.stringify(thumbs.filter(Boolean));
      const lightboxJson  = JSON.stringify(lightboxImgs.filter(Boolean));
      const totalSize = thumbsJson.length + lightboxJson.length;
      if (totalSize < IMAGES_SIZE_LIMIT) {
        sessionStorage.setItem(IMAGES_KEY, thumbsJson);
        sessionStorage.setItem(LIGHTBOX_KEY, lightboxJson);
      } else {
        sessionStorage.removeItem(IMAGES_KEY);
        sessionStorage.removeItem(LIGHTBOX_KEY);
      }

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

  const imagesRaw   = sessionStorage.getItem(IMAGES_KEY);
  const lightboxRaw = sessionStorage.getItem(LIGHTBOX_KEY);
  if (imagesRaw) {
    try {
      const thumbs     = JSON.parse(imagesRaw);
      const fullImages = lightboxRaw ? JSON.parse(lightboxRaw) : thumbs;
      const strip = document.getElementById('image-strip');
      if (strip && thumbs.length) {
        thumbs.forEach((src, i) => {
          const img = document.createElement('img');
          img.src = src;
          img.className = 'thumb';
          img.alt = `Image ${i + 1}`;
          img.addEventListener('click', () => openLightbox(fullImages[i] || src));
          strip.appendChild(img);
        });
        document.getElementById('images-section').hidden = false;
      }
    } catch (_) {}
  }

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.hidden = false;
  }
  if (lightbox) {
    lightbox.addEventListener('click', () => { lightbox.hidden = true; lightboxImg.src = ''; });
  }

  const copiedMsg = document.getElementById('copied-msg');

  // Show "include images" checkbox only when file sharing is supported and images exist
  const includeImagesLabel = document.getElementById('include-images-label');
  const includeImagesCb    = document.getElementById('include-images-cb');
  const lightboxRawShare   = sessionStorage.getItem(LIGHTBOX_KEY);
  if (includeImagesLabel && lightboxRawShare && navigator.share) {
    const testFiles = [new File([], 'test.jpg', { type: 'image/jpeg' })];
    if (navigator.canShare && navigator.canShare({ files: testFiles })) {
      includeImagesLabel.hidden = false;
    }
  }

  function getShareFiles() {
    if (!includeImagesCb || !includeImagesCb.checked || !lightboxRawShare) return [];
    try {
      return JSON.parse(lightboxRawShare).map((dataUrl, i) => {
        const [header, b64] = dataUrl.split(',');
        const mime = header.match(/:(.*?);/)[1];
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new File([bytes], `image-${i + 1}.jpg`, { type: mime });
      });
    } catch (_) { return []; }
  }

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
    const files = getShareFiles();
    if (navigator.share) {
      try {
        const payload = files.length ? { text, files } : { text };
        await navigator.share(payload);
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
