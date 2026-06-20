/* ReadWrite — app.js */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

const RESULTS_KEY  = 'rw_results';
const IMAGES_KEY   = 'rw_images';
const LIGHTBOX_KEY = 'rw_lightbox';
const SCAN_ID_KEY  = 'rw_scan_id';
const SCAN_URL = '/api/scan';
const NOTES_URL = '/api/notes';
const IMAGES_SIZE_LIMIT = 4 * 1024 * 1024; // 4 MB

/* ── IndexedDB staging (carries save-blobs from scan page to results page) ── */

const IDB_NAME = 'readwrite';
const IDB_STORE = 'pending';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const dbi = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const dbi = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbDelete(key) {
  const dbi = await idbOpen();
  return new Promise((resolve) => {
    const tx = dbi.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function dataURLtoBlob(dataURL) {
  const [header, b64] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

/* ── Friendly date ── */

function friendlyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function slugify(s) {
  return s.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'note';
}

/* ── Clerk auth ── */

async function waitForClerk() {
  return new Promise(resolve => {
    if (window.Clerk) { resolve(); return; }
    const t = setInterval(() => { if (window.Clerk) { clearInterval(t); resolve(); } }, 50);
  });
}

async function getToken() {
  if (!window.Clerk || !window.Clerk.session) return null;
  return window.Clerk.session.getToken();
}

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

function initHamburger() {
  const btn  = document.getElementById('hamburger-btn');
  const menu = document.getElementById('nav-menu');
  if (!btn || !menu) return;
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });
  document.getElementById('btn-signout')?.addEventListener('click', async () => {
    try { await window.Clerk.signOut(); } catch (_) {}
    window.location.href = 'index.html';
  });
}

async function initIndex() {
  await waitForClerk();
  await window.Clerk.load();

  const signInWall = document.getElementById('sign-in-wall');
  const appEl      = document.getElementById('app');

  let hamburgerInited = false;
  function showApp() {
    signInWall.hidden = true;
    appEl.hidden = false;
    const siteNav = document.getElementById('site-nav');
    if (siteNav) siteNav.hidden = false;
    const headerRight = document.getElementById('header-right');
    if (headerRight) headerRight.hidden = false;
    if (!hamburgerInited) { initHamburger(); hamburgerInited = true; }
  }

  function showSignIn() {
    appEl.hidden = true;
    signInWall.hidden = false;
    window.Clerk.mountSignIn(document.getElementById('clerk-sign-in'));
  }

  // React to auth state changes (covers initial load, sign-in after sign-out, session expiry)
  window.Clerk.addListener(({ user }) => {
    if (user) showApp();
    else showSignIn();
  });

  if (window.Clerk.user) {
    showApp();
  } else {
    showSignIn();
  }

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const cameraInput = document.getElementById('camera-input');
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
      if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        selectedFiles.push(file);
      }
    }
    renderThumbs();
    updateScanBtn();
  }

  function renderThumbs() {
    const count = selectedFiles.length;
    if (count === 0) { document.getElementById('file-count').textContent = ''; return; }
    const imgs = selectedFiles.filter(f => f.type.startsWith('image/')).length;
    const pdfs = selectedFiles.filter(f => f.type === 'application/pdf').length;
    const parts = [];
    if (imgs) parts.push(`${imgs} image${imgs > 1 ? 's' : ''}`);
    if (pdfs) parts.push(`${pdfs} PDF${pdfs > 1 ? 's' : ''}`);
    document.getElementById('file-count').textContent = parts.join(', ') + ' selected';
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
        Promise.all(selectedFiles.map(f => f.type === 'application/pdf' ? null : resizeImage(f, 150, 0.5))),
        Promise.all(selectedFiles.map(f => f.type === 'application/pdf' ? null : resizeImage(f, 1500, 0.85))),
      ]);
      // Store per-file metadata for the strip (null = PDF placeholder)
      const stripMeta = selectedFiles.map((f, i) =>
        f.type === 'application/pdf' ? { pdf: true, name: f.name } : (thumbs[i] || null)
      );
      const thumbsJson    = JSON.stringify(stripMeta);
      const lightboxJson  = JSON.stringify(lightboxImgs);
      const totalSize = thumbsJson.length + lightboxJson.length;
      if (totalSize < IMAGES_SIZE_LIMIT) {
        sessionStorage.setItem(IMAGES_KEY, thumbsJson);
        sessionStorage.setItem(LIGHTBOX_KEY, lightboxJson);
      } else {
        sessionStorage.removeItem(IMAGES_KEY);
        sessionStorage.removeItem(LIGHTBOX_KEY);
      }

      // Stash the to-be-saved artifacts in IndexedDB: 1500px JPEGs for images,
      // original files for PDFs. Read back by the Save button on results.html.
      const scanId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
      const persistFiles = selectedFiles.map((f, i) => f.type === 'application/pdf'
        ? { kind: 'pdf', position: i, blob: f, original_name: f.name }
        : { kind: 'image', position: i, blob: lightboxImgs[i] ? dataURLtoBlob(lightboxImgs[i]) : null, original_name: null }
      ).filter(e => e.blob);
      try {
        await idbPut(scanId, persistFiles);
        sessionStorage.setItem(SCAN_ID_KEY, scanId);
      } catch (_) { sessionStorage.removeItem(SCAN_ID_KEY); }

      const formData = new FormData();
      selectedFiles.forEach(file => formData.append('files', file));
      const instructions = document.getElementById('instructions')?.value.trim();
      if (instructions) formData.append('instructions', instructions);

      const token = await getToken();
      const response = await fetch(SCAN_URL, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
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

async function initResults() {
  const params = new URLSearchParams(location.search);
  const savedId = params.get('id');
  const mode = savedId ? 'saved' : 'fresh';

  let data;
  if (mode === 'saved') {
    await waitForClerk();
    await window.Clerk.load();
    if (!window.Clerk.user) { window.location.href = 'index.html'; return; }
    try {
      const token = await getToken();
      const resp = await fetch(`${NOTES_URL}/${savedId}`, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
      if (!resp.ok) throw new Error('not found');
      data = await resp.json();
    } catch (_) {
      document.querySelector('.container').innerHTML =
        '<a href="notes.html" class="back-btn">← Back</a><p style="margin-top:24px;color:var(--text-muted)">Note not found.</p>';
      return;
    }
  } else {
    const raw = sessionStorage.getItem(RESULTS_KEY);
    if (!raw) {
      document.querySelector('.container').innerHTML =
        '<a href="index.html" class="back-btn">← Back</a><p style="margin-top:24px;color:var(--text-muted)">No results found. Please scan some notes first.</p>';
      return;
    }
    data = JSON.parse(raw);
    // Load Clerk so a session/token is available when Save is clicked
    await waitForClerk();
    await window.Clerk.load();
  }

  initHamburger();

  setMd(document.getElementById('summary-text'), data.summary || '');
  setMd(document.getElementById('transcription-text'), data.transcription || '');
  const addCard = document.getElementById('additional-notes-card');
  if (addCard) addCard.hidden = false;
  if (data.additional_notes) {
    setMd(document.getElementById('additional-notes-text'), data.additional_notes);
  }

  // Title + friendly date header
  const noteMeta  = document.getElementById('note-meta');
  const titleEl   = document.getElementById('note-title');
  const dateEl    = document.getElementById('note-date');
  const dateStr = friendlyDate(data.scanned_at);
  if (data.title) titleEl.textContent = data.title;
  else titleEl.hidden = true;
  if (dateStr) dateEl.textContent = dateStr;
  else dateEl.hidden = true;
  if (data.title || dateStr) noteMeta.hidden = false;

  // ── Image strip + lightbox carousel ──
  const strip = document.getElementById('image-strip');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lbPrevBtn = lightbox?.querySelector('.lb-prev');
  const lbNextBtn = lightbox?.querySelector('.lb-next');
  const lbCloseBtn = lightbox?.querySelector('.lb-close');

  const lightboxSrcs = [];
  let lightboxIndex = 0;

  function updateLbNav() {
    const multi = lightboxSrcs.length > 1;
    if (lbPrevBtn) lbPrevBtn.style.visibility = multi ? 'visible' : 'hidden';
    if (lbNextBtn) lbNextBtn.style.visibility = multi ? 'visible' : 'hidden';
  }

  function openLightbox(index) {
    lightboxIndex = index;
    if (lightboxImg) lightboxImg.src = lightboxSrcs[index];
    if (lightbox) lightbox.hidden = false;
    updateLbNav();
  }

  function closeLightbox() {
    if (lightbox) lightbox.hidden = true;
    if (lightboxImg) lightboxImg.src = '';
  }

  if (lightbox) {
    lightbox.addEventListener('click', e => {
      if (e.target === lightbox || e.target === lightboxImg) closeLightbox();
    });
  }
  if (lbCloseBtn) lbCloseBtn.addEventListener('click', closeLightbox);
  if (lbPrevBtn) lbPrevBtn.addEventListener('click', e => {
    e.stopPropagation();
    lightboxIndex = (lightboxIndex - 1 + lightboxSrcs.length) % lightboxSrcs.length;
    if (lightboxImg) lightboxImg.src = lightboxSrcs[lightboxIndex];
  });
  if (lbNextBtn) lbNextBtn.addEventListener('click', e => {
    e.stopPropagation();
    lightboxIndex = (lightboxIndex + 1) % lightboxSrcs.length;
    if (lightboxImg) lightboxImg.src = lightboxSrcs[lightboxIndex];
  });

  document.addEventListener('keydown', e => {
    if (!lightbox || lightbox.hidden) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbPrevBtn?.click(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lbNextBtn?.click(); }
    else if (e.key === 'Escape') closeLightbox();
  });

  const shareFiles = [];  // File objects offered to the share sheet when "Image(s)" is checked

  const excludedImages = new Set(); // positions excluded from publishing

  function addImageTile(thumbSrc, fullSrc, i, exif) {
    const figure = document.createElement('figure');
    figure.className = 'thumb-figure';
    figure.dataset.position = i;

    const img = document.createElement('img');
    img.src = thumbSrc;
    img.className = 'thumb';
    img.alt = `Image ${i + 1}`;
    const lbIndex = lightboxSrcs.length;
    lightboxSrcs.push(fullSrc || thumbSrc);
    img.addEventListener('click', () => openLightbox(lbIndex));
    figure.appendChild(img);

    if (exif) {
      const details = document.createElement('details');
      details.className = 'exif-details';
      const sumEl = document.createElement('summary');
      sumEl.textContent = 'Image info';
      details.appendChild(sumEl);

      const dl = document.createElement('dl');
      dl.className = 'exif-dl';

      function addExifRow(label, valueNode) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        if (typeof valueNode === 'string') dd.textContent = valueNode;
        else dd.appendChild(valueNode);
        dl.appendChild(dt);
        dl.appendChild(dd);
      }

      const taken = exif.DateTimeOriginal || exif.DateTimeDigitized || exif.DateTime;
      if (taken) {
        // EXIF date format: "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DD HH:MM"
        const fmt = taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').slice(0, 16);
        addExifRow('Taken', fmt);
      }
      const camera = [exif.Make, exif.Model].filter(Boolean).join(' ');
      if (camera) addExifRow('Camera', camera);
      if (exif.LensModel) addExifRow('Lens', exif.LensModel);
      if (exif.ISOSpeedRatings) addExifRow('ISO', String(exif.ISOSpeedRatings));
      if (exif.FNumber) addExifRow('Aperture', `f/${exif.FNumber}`);
      if (exif.ExposureTime) addExifRow('Shutter', exif.ExposureTime);
      if (exif.GPS) {
        const { lat, lon } = exif.GPS;
        const a = document.createElement('a');
        a.href = `https://maps.google.com/?q=${lat},${lon}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        addExifRow('Location', a);
      }
      details.appendChild(dl);
      figure.appendChild(details);
    }

    const excludeBtn = document.createElement('button');
    excludeBtn.type = 'button';
    excludeBtn.className = 'pub-exclude-btn';
    excludeBtn.textContent = 'Exclude';
    excludeBtn.title = 'Exclude this image from published page';
    excludeBtn.addEventListener('click', () => {
      if (excludedImages.has(i)) {
        excludedImages.delete(i);
        excludeBtn.textContent = 'Exclude';
        excludeBtn.classList.remove('excluded');
      } else {
        excludedImages.add(i);
        excludeBtn.textContent = 'Excluded';
        excludeBtn.classList.add('excluded');
      }
      savePublishOptions();
    });
    figure.appendChild(excludeBtn);

    if (mode === 'saved') {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'thumb-delete-btn';
      delBtn.textContent = '×';
      delBtn.title = 'Delete this image';
      delBtn.addEventListener('click', async () => {
        if (!confirm('Delete this image? This cannot be undone.')) return;
        delBtn.disabled = true;
        try {
          const authToken = await getToken();
          const resp = await fetch(`${NOTES_URL}/${savedId}/files/${i}`, {
            method: 'DELETE',
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
          });
          if (!resp.ok) throw new Error();
          figure.remove();
        } catch (_) {
          delBtn.disabled = false;
        }
      });
      figure.appendChild(delBtn);
    }

    strip.appendChild(figure);
  }
  function addPdfTile(name, href) {
    const tile = document.createElement(href ? 'a' : 'div');
    tile.className = 'thumb pdf-thumb';
    tile.title = name || 'PDF';
    if (href) { tile.href = href; tile.target = '_blank'; tile.rel = 'noopener'; }
    tile.innerHTML = `<span class="pdf-icon"><svg class="icon" style="width:24px;height:24px"><use href="#icon-file-text"/></svg></span><span class="pdf-name">${name || 'PDF'}</span>`;
    strip.appendChild(tile);
  }

  if (mode === 'fresh') {
    const imagesRaw   = sessionStorage.getItem(IMAGES_KEY);
    const lightboxRaw = sessionStorage.getItem(LIGHTBOX_KEY);
    if (imagesRaw && strip) {
      try {
        const stripMeta  = JSON.parse(imagesRaw);
        const fullImages = lightboxRaw ? JSON.parse(lightboxRaw) : [];
        const exifList = data.file_exif || [];
        stripMeta.forEach((meta, i) => {
          if (meta && meta.pdf) addPdfTile(meta.name, null);
          else if (meta) addImageTile(meta, fullImages[i], i, exifList[i] || null);
        });
        (fullImages || []).forEach((dataUrl, i) => {
          if (dataUrl) shareFiles.push(new File([dataURLtoBlob(dataUrl)], `image-${i + 1}.jpg`, { type: 'image/jpeg' }));
        });
        if (stripMeta.length) document.getElementById('images-section').hidden = false;
      } catch (_) {}
    }
  } else {
    const files = data.files || [];
    if (files.length && strip) {
      const token = await getToken();
      for (const f of files) {
        try {
          const resp = await fetch(`${NOTES_URL}/${savedId}/files/${f.position}`, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          if (f.kind === 'pdf') {
            addPdfTile(f.original_name, url);
          } else {
            addImageTile(url, url, f.position, f.exif || null);
            shareFiles.push(new File([blob], `image-${f.position + 1}.jpg`, { type: blob.type || 'image/jpeg' }));
          }
        } catch (_) {}
      }
      document.getElementById('images-section').hidden = false;
    }

    // Show add-images UI in saved mode
    enableAddImages(savedId);
  }

  const copiedMsg = document.getElementById('copied-msg');

  // Show "Image(s)" share checkbox only when file sharing is supported and images exist
  const shareImageLabel = document.getElementById('share-image-label');
  const shareImageCb     = document.getElementById('share-image');
  if (shareImageLabel && shareFiles.length && navigator.share) {
    const testFiles = [new File([], 'test.jpg', { type: 'image/jpeg' })];
    if (navigator.canShare && navigator.canShare({ files: testFiles })) {
      shareImageLabel.hidden = false;
    }
  }

  function getShareFiles() {
    if (!shareImageCb || !shareImageCb.checked) return [];
    return shareFiles;
  }

  // note-title and note-date are edited directly by id; others use the id+'-text' convention
  const INLINE_SECTIONS = ['note-title', 'note-date'];
  const editors = new Map(); // section → EasyMDE instance (non-inline sections only)

  function getEditEl(section) {
    return INLINE_SECTIONS.includes(section)
      ? document.getElementById(section)
      : document.getElementById(`${section}-text`);
  }

  function getText(section) {
    const el = getEditEl(section);
    if (!el) return '';
    if (editors.has(section)) return editors.get(section).value();
    return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : (el.dataset.rawMd ?? el.textContent);
  }

  // Edit toggle
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      const el = getEditEl(section);
      const isInline = INLINE_SECTIONS.includes(section);
      const isEditing = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';

      if (isEditing) {
        const rawValue = (!isInline && editors.has(section))
          ? editors.get(section).value()
          : el.value;
        if (editors.has(section)) {
          editors.get(section).toTextArea();
          editors.delete(section);
        }
        const restored = document.createElement(isInline ? (section === 'note-title' ? 'h1' : 'div') : 'div');
        restored.className = isInline ? el.dataset.origClass || '' : 'result-text';
        restored.id = section === 'note-title' ? 'note-title' : section === 'note-date' ? 'note-date' : `${section}-text`;
        if (section === 'note-title') {
          restored.className = 'note-title';
          data.title = el.value;
          restored.textContent = el.value;
        } else if (section === 'note-date') {
          restored.className = 'note-date';
          if (el.value) data.scanned_at = new Date(el.value).toISOString();
          restored.textContent = friendlyDate(data.scanned_at);
        } else {
          setMd(restored, rawValue);
        }
        el.replaceWith(restored);
        btn.textContent = 'Edit';
        if (currentNoteId) autoSave();
      } else {
        const input = document.createElement(isInline ? 'input' : 'textarea');
        input.className = isInline ? 'note-inline-input' : 'result-textarea';
        input.id = el.id;
        if (isInline) {
          if (section === 'note-date') {
            input.type = 'datetime-local';
            if (data.scanned_at) {
              const d = new Date(data.scanned_at);
              if (!isNaN(d)) input.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            }
          } else {
            input.type = 'text';
            input.value = el.textContent;
          }
        } else {
          input.value = el.dataset.rawMd ?? el.textContent;
        }
        el.replaceWith(input);
        if (!isInline) {
          const mde = new EasyMDE({
            element: input,
            toolbar: ['bold', 'italic', 'heading-2', 'heading-3', '|',
                      'unordered-list', 'ordered-list', '|', 'preview'],
            spellChecker: false,
            autofocus: true,
            minHeight: '140px',
            status: false,
            renderingConfig: { singleLineBreaks: false },
          });
          editors.set(section, mde);
        } else {
          input.focus();
        }
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

  // Hide share checkboxes for sections that have no content
  if (!data.title) document.getElementById('share-title-label').hidden = true;
  if (!dateStr) document.getElementById('share-date-label').hidden = true;

  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const parts = [];
      if (document.getElementById('share-title').checked && data.title) {
        parts.push(getText('note-title'));
      }
      if (document.getElementById('share-date').checked && dateStr) {
        parts.push(getText('note-date'));
      }
      if (document.getElementById('share-summary').checked) {
        parts.push(`Summary:\n${markdownToPlainText(getText('summary'))}`);
      }
      if (document.getElementById('share-transcription').checked) {
        parts.push(`Transcription:\n${markdownToPlainText(getText('transcription'))}`);
      }
      if (document.getElementById('share-additional').checked) {
        const addNotes = getText('additional-notes');
        if (addNotes) parts.push(`Additional Notes:\n${markdownToPlainText(addNotes)}`);
      }
      share(parts.join('\n\n'));
    });
  }

  function currentTextFields() {
    return {
      title: getText('note-title') || data.title || '',
      summary: getText('summary'),
      transcription: getText('transcription'),
      additional_notes: getText('additional-notes') || '',
      scanned_at: data.scanned_at || '',
    };
  }

  async function autoSave() {
    if (!currentNoteId) return;
    try {
      const token = await getToken();
      await fetch(`${NOTES_URL}/${currentNoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify(currentTextFields()),
      });
      copiedMsg.textContent = 'Saved ✓';
      setTimeout(() => { copiedMsg.textContent = ''; }, 1500);
    } catch (_) {}
  }

  // ── Publish panel ──
  const publishCard   = document.getElementById('publish-card');
  const publishBtn    = document.getElementById('publish-btn');
  const unpublishBtn  = document.getElementById('unpublish-btn');
  const shareLinkRow  = document.getElementById('share-link-row');
  const shareLinkA    = document.getElementById('share-link-a');

  let currentNoteId = savedId;
  let currentShareToken = null;
  let currentSlug = null;

  function getPublishOptions() {
    return {
      showImages:        document.getElementById('pub-images')?.checked ?? true,
      showSectionTitles: document.getElementById('pub-section-titles')?.checked ?? true,
      showSummary:       document.getElementById('pub-summary')?.checked ?? true,
      showTranscription: document.getElementById('pub-transcription')?.checked ?? true,
      showAdditional:    document.getElementById('pub-additional')?.checked ?? true,
      includeInList:     document.getElementById('pub-in-list')?.checked ?? true,
      imagePosition:     document.querySelector('input[name="pub-img-pos"]:checked')?.value ?? 'top',
      excludedImages:    [...excludedImages],
    };
  }

  function restorePublishOptions(opts, visibility, slug) {
    if (opts) {
      const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val !== false; };
      const setRadio = (name, val) => {
        if (!val) return;
        const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
        if (el) el.checked = true;
      };
      setCheck('pub-images', opts.showImages);
      setCheck('pub-section-titles', opts.showSectionTitles);
      setCheck('pub-summary', opts.showSummary);
      setCheck('pub-transcription', opts.showTranscription);
      setCheck('pub-additional', opts.showAdditional);
      setCheck('pub-in-list', opts.includeInList);
      setRadio('pub-img-pos', opts.imagePosition);
      excludedImages.clear();
      (opts.excludedImages || []).forEach(p => excludedImages.add(Number(p)));
      document.querySelectorAll('#image-strip .thumb-figure').forEach(fig => {
        const pos = Number(fig.dataset.position);
        const btn = fig.querySelector('.pub-exclude-btn');
        if (!btn) return;
        const ex = excludedImages.has(pos);
        btn.textContent = ex ? 'Excluded' : 'Exclude';
        btn.classList.toggle('excluded', ex);
      });
    }
    const visEl = document.getElementById('pub-visibility');
    if (visEl) visEl.value = visibility || 'public';
    const slugInput = document.getElementById('pub-slug');
    if (slugInput && slug) slugInput.value = slug;
  }

  const pubOptionsEl     = document.getElementById('pub-options');
  const pubEditBtn       = document.getElementById('pub-edit-options-btn');
  const pubSaveOptsBtn   = document.getElementById('pub-save-options-btn');
  const republishBtn     = document.getElementById('republish-btn');

  function lockPublishOptions() {
    if (pubOptionsEl) pubOptionsEl.classList.add('pub-options-locked');
    pubOptionsEl?.querySelectorAll('input, select').forEach(el => { el.disabled = true; });
    if (pubEditBtn) pubEditBtn.hidden = false;
    if (pubSaveOptsBtn) pubSaveOptsBtn.hidden = true;
    if (republishBtn) republishBtn.hidden = true;
  }

  function unlockPublishOptions() {
    if (pubOptionsEl) pubOptionsEl.classList.remove('pub-options-locked');
    pubOptionsEl?.querySelectorAll('input, select').forEach(el => { el.disabled = false; });
    if (pubEditBtn) pubEditBtn.hidden = true;
    if (pubSaveOptsBtn) pubSaveOptsBtn.hidden = false;
    if (republishBtn) republishBtn.hidden = false;
  }

  // Slug preview helper
  function updateSlugPreview(displaySlug) {
    const preview = document.getElementById('pub-slug-preview');
    if (preview) preview.textContent = displaySlug ? `${window.location.origin}/share/${displaySlug}` : '';
  }

  // Wire slug input: live preview + debounced auto-save
  const slugInput = document.getElementById('pub-slug');
  if (slugInput) {
    slugInput.addEventListener('input', () => {
      const val = slugInput.value.trim();
      const derived = val ? slugify(val) : slugify(document.getElementById('note-title')?.value?.trim() || 'note');
      updateSlugPreview(derived);
      clearTimeout(optionsSaveTimer);
      optionsSaveTimer = setTimeout(savePublishOptions, 800);
    });
  }

  if (pubEditBtn) pubEditBtn.addEventListener('click', unlockPublishOptions);

  if (pubSaveOptsBtn) {
    pubSaveOptsBtn.addEventListener('click', async () => {
      pubSaveOptsBtn.disabled = true;
      await savePublishOptions();
      lockPublishOptions();
      copiedMsg.textContent = 'Options saved.';
      setTimeout(() => { copiedMsg.textContent = ''; }, 2000);
      pubSaveOptsBtn.disabled = false;
    });
  }

  if (republishBtn) {
    republishBtn.addEventListener('click', async () => {
      if (!currentNoteId) return;
      republishBtn.disabled = true;
      copiedMsg.textContent = 'Republishing…';
      try {
        await savePublishOptions();
        const token = await getToken();
        const resp = await fetch(`${NOTES_URL}/${currentNoteId}/publish`, {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (!resp.ok) throw new Error('Republish failed');
        const { share_token, slug } = await resp.json();
        showShareLink(share_token, slug);
        copiedMsg.textContent = '';
      } catch (e) {
        copiedMsg.textContent = e.message || 'Republish failed';
      } finally {
        republishBtn.disabled = false;
      }
    });
  }

  async function savePublishOptions() {
    if (!currentNoteId) return;
    try {
      const token = await getToken();
      const visibility = document.getElementById('pub-visibility')?.value ?? 'public';
      const slugVal = document.getElementById('pub-slug')?.value?.trim() || '';
      const payload = { ...currentTextFields(), publish_options: getPublishOptions(), visibility };
      if (slugVal) payload.slug = slugVal;
      await fetch(`${NOTES_URL}/${currentNoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
    } catch (_) {}
  }

  // Debounced auto-save of options when any control changes
  let optionsSaveTimer;
  publishCard?.querySelectorAll('input, select').forEach(inp => {
    inp.addEventListener('change', () => {
      clearTimeout(optionsSaveTimer);
      optionsSaveTimer = setTimeout(savePublishOptions, 800);
    });
  });

  function showShareLink(token, slug) {
    currentShareToken = token;
    currentSlug = slug || null;
    const display = slug || token;
    const url = `${window.location.origin}/share/${encodeURIComponent(display)}`;
    if (shareLinkA) { shareLinkA.href = url; shareLinkA.textContent = url; shareLinkA.classList.remove('share-link-unpublished'); }
    updateSlugPreview(display);
    const unpubLabel = document.getElementById('share-unpublished-label');
    if (unpubLabel) unpubLabel.hidden = true;
    if (shareLinkRow) shareLinkRow.hidden = false;
    if (publishBtn) publishBtn.hidden = true;
    if (unpublishBtn) unpublishBtn.hidden = false;
    if (republishBtn) republishBtn.hidden = true;
    lockPublishOptions();
  }

  function showUnpublishedLink(token, slug) {
    currentShareToken = token;
    currentSlug = slug || null;
    const display = slug || token;
    const url = `${window.location.origin}/share/${encodeURIComponent(display)}`;
    if (shareLinkA) { shareLinkA.href = url; shareLinkA.textContent = url; shareLinkA.classList.add('share-link-unpublished'); }
    updateSlugPreview(display);
    if (shareLinkRow) shareLinkRow.hidden = false;
    const unpubLabel = document.getElementById('share-unpublished-label');
    if (unpubLabel) unpubLabel.hidden = false;
    if (publishBtn) publishBtn.hidden = true;
    if (unpublishBtn) unpublishBtn.hidden = true;
    if (pubOptionsEl) pubOptionsEl.classList.remove('pub-options-locked');
    pubOptionsEl?.querySelectorAll('input, select').forEach(el => { el.disabled = false; });
    if (pubEditBtn) pubEditBtn.hidden = true;
    if (pubSaveOptsBtn) pubSaveOptsBtn.hidden = true;
    if (republishBtn) republishBtn.hidden = false;
  }

  function hideShareLink() {
    currentShareToken = null;
    if (shareLinkRow) shareLinkRow.hidden = true;
    const unpubLabel = document.getElementById('share-unpublished-label');
    if (unpubLabel) unpubLabel.hidden = true;
    if (unpublishBtn) unpublishBtn.hidden = true;
    if (publishBtn) publishBtn.hidden = false;
    unlockPublishOptions();
    if (pubEditBtn) pubEditBtn.hidden = true;
    if (pubSaveOptsBtn) pubSaveOptsBtn.hidden = true;
    if (republishBtn) republishBtn.hidden = true;
  }

  // Initial publish state in saved mode
  if (mode === 'saved') {
    if (publishCard) publishCard.hidden = false;
    restorePublishOptions(data.publish_options, data.visibility, data.slug);
    if (data.share_token) {
      if (data.is_published) {
        showShareLink(data.share_token, data.slug);
      } else {
        showUnpublishedLink(data.share_token, data.slug);
      }
    }
  }

  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      if (!currentNoteId) return;
      publishBtn.disabled = true;
      copiedMsg.textContent = 'Publishing…';
      try {
        await savePublishOptions();
        const token = await getToken();
        const resp = await fetch(`${NOTES_URL}/${currentNoteId}/publish`, {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (!resp.ok) throw new Error('Publish failed');
        const { share_token, slug } = await resp.json();
        showShareLink(share_token, slug);
        copiedMsg.textContent = '';
      } catch (e) {
        copiedMsg.textContent = e.message || 'Publish failed';
      } finally {
        publishBtn.disabled = false;
      }
    });
  }

  if (unpublishBtn) {
    unpublishBtn.addEventListener('click', async () => {
      if (!currentNoteId) return;
      unpublishBtn.disabled = true;
      copiedMsg.textContent = 'Unpublishing…';
      try {
        const token = await getToken();
        const resp = await fetch(`${NOTES_URL}/${currentNoteId}/publish`, {
          method: 'DELETE',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (!resp.ok) throw new Error('Unpublish failed');
        showUnpublishedLink(currentShareToken, currentSlug);
        copiedMsg.textContent = 'Page unpublished.';
        setTimeout(() => { copiedMsg.textContent = ''; }, 2500);
      } catch (e) {
        copiedMsg.textContent = e.message || 'Unpublish failed';
      } finally {
        unpublishBtn.disabled = false;
      }
    });
  }

  // ── Add images to a saved note ──
  function enableAddImages(noteId) {
    const addImagesRow    = document.getElementById('add-images-row');
    const addImagesInput  = document.getElementById('add-images-input');
    const addImagesStatus = document.getElementById('add-images-status');
    if (addImagesRow) {
      addImagesRow.hidden = false;
      document.getElementById('images-section').hidden = false;
    }
    if (addImagesInput && !addImagesInput.dataset.wired) {
      addImagesInput.dataset.wired = '1';
      addImagesInput.addEventListener('change', async () => {
        const chosen = [...addImagesInput.files];
        if (!chosen.length) return;
        if (addImagesStatus) addImagesStatus.textContent = 'Uploading…';
        const authToken = await getToken();
        const fd = new FormData();
        chosen.forEach(f => fd.append('files', f));
        try {
          const resp = await fetch(`${NOTES_URL}/${noteId}/files`, {
            method: 'POST',
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
            body: fd,
          });
          if (!resp.ok) throw new Error();
          const result = await resp.json();
          for (const entry of result.files) {
            if (entry.kind === 'pdf') {
              addPdfTile(entry.original_name, null);
            } else {
              const r = await fetch(`${NOTES_URL}/${noteId}/files/${entry.position}`, {
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
              });
              if (r.ok) {
                const blobUrl = URL.createObjectURL(await r.blob());
                addImageTile(blobUrl, blobUrl, entry.position, entry.exif || null);
              }
            }
          }
          if (addImagesStatus) {
            addImagesStatus.textContent = `${result.added} image${result.added !== 1 ? 's' : ''} added.`;
            setTimeout(() => { if (addImagesStatus) addImagesStatus.textContent = ''; }, 3000);
          }
        } catch (_) {
          if (addImagesStatus) addImagesStatus.textContent = 'Upload failed.';
        }
        addImagesInput.value = '';
      });
    }
  }

  // ── Save (fresh scan) vs Update/Delete (saved note) ──
  const saveBtn   = document.getElementById('save-btn');
  const updateBtn = document.getElementById('update-btn');
  const deleteBtn = document.getElementById('delete-btn');

  if (mode === 'fresh' && saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      copiedMsg.textContent = 'Saving…';
      try {
        const scanId = sessionStorage.getItem(SCAN_ID_KEY);
        const persist = scanId ? (await idbGet(scanId)) || [] : [];
        const exifList = data.file_exif || [];
        const fd = new FormData();
        fd.append('note', JSON.stringify(currentTextFields()));
        fd.append('files_meta', JSON.stringify(persist.map(e => ({
          position: e.position, kind: e.kind, original_name: e.original_name || null,
          exif: exifList[e.position] || null,
        }))));
        persist.forEach(e => {
          fd.append('files', e.blob, `${e.position}${e.kind === 'pdf' ? '.pdf' : '.jpg'}`);
        });
        const token = await getToken();
        const resp = await fetch(NOTES_URL, {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          body: fd,
        });
        const respJson = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(respJson.detail || 'Save failed');
        currentNoteId = respJson.id;
        if (scanId) await idbDelete(scanId);
        saveBtn.textContent = 'Saved ✓';
        saveBtn.disabled = true;
        copiedMsg.textContent = 'Note saved!';
        setTimeout(() => { copiedMsg.textContent = ''; }, 2500);
        if (publishCard) publishCard.hidden = false;
        enableAddImages(currentNoteId);
      } catch (e) {
        saveBtn.disabled = false;
        copiedMsg.textContent = e.message || 'Save failed';
      }
    });
  } else if (saveBtn) {
    saveBtn.hidden = true;
  }

  if (mode === 'saved') {
    if (deleteBtn) {
      deleteBtn.hidden = false;
      deleteBtn.addEventListener('click', async () => {
        if (!confirm('Delete this note? This cannot be undone.')) return;
        deleteBtn.disabled = true;
        try {
          const token = await getToken();
          const resp = await fetch(`${NOTES_URL}/${savedId}`, {
            method: 'DELETE',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          });
          if (!resp.ok) throw new Error('Delete failed');
          window.location.href = 'notes.html';
        } catch (e) {
          deleteBtn.disabled = false;
          copiedMsg.textContent = e.message || 'Delete failed';
        }
      });
    }
  }
}

/* ── My Notes page logic ── */

async function loadNoteThumbnail(imgEl, noteId, position, token) {
  try {
    const resp = await fetch(`${NOTES_URL}/${noteId}/files/${position}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (resp.ok) {
      const blob = await resp.blob();
      imgEl.src = URL.createObjectURL(blob);
    } else {
      imgEl.remove();
    }
  } catch (_) {
    imgEl.remove();
  }
}

async function initNotes() {
  await waitForClerk();
  await window.Clerk.load();

  const signInWall = document.getElementById('sign-in-wall');
  const notesApp   = document.getElementById('notes-app');

  if (!window.Clerk.user) {
    notesApp.hidden = true;
    signInWall.hidden = false;
    window.Clerk.mountSignIn(document.getElementById('clerk-sign-in'));
    return;
  }
  signInWall.hidden = true;
  notesApp.hidden = false;

  initHamburger();

  const token = await getToken();

  // Show published-list link if user has a list token
  try {
    const sResp = await fetch('/api/settings', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (sResp.ok) {
      const s = await sResp.json();
      if (s.list_token) {
        const btn = document.getElementById('pub-list-btn');
        if (btn) { btn.href = `/published/${s.list_token}`; btn.hidden = false; }
      }
    }
  } catch (_) {}

  const listEl   = document.getElementById('notes-list');
  const emptyEl  = document.getElementById('notes-empty');
  const searchEl = document.getElementById('notes-search');
  const filterEl = document.getElementById('notes-vis-filter');

  const unlockSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
  const personSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const eyeSvg    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const visSvgs   = { public: unlockSvg, logged_in: personSvg, me: eyeSvg };
  const visLabels = { public: 'Public', logged_in: 'Members only', me: 'Private' };
  const editSvg   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

  let notes = [];
  let activeVis = '';

  function renderNotes(items) {
    listEl.innerHTML = '';
    emptyEl.hidden = items.length > 0;
    items.forEach(n => {
      const hasThumb = n.first_image_position !== null && n.first_image_position !== undefined;

      const card = document.createElement('div');
      card.className = 'pub-card';
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        window.location.href = `results.html?id=${encodeURIComponent(n.id)}`;
      });

      if (hasThumb) {
        const hero = document.createElement('img');
        hero.className = 'pub-card-hero';
        hero.alt = '';
        card.appendChild(hero);
      }

      const body = document.createElement('div');
      body.className = 'pub-card-body';
      const vis = n.share_token ? (n.visibility || 'public') : null;
      const visHtml = vis ? `<span class="pub-card-vis" title="${visLabels[vis] || 'Public'}">${visSvgs[vis] || unlockSvg}</span>` : '';
      body.innerHTML = `
        <div class="pub-card-title-row">
          <div class="pub-card-title">${escapeHtml(n.title || 'Untitled')}</div>
          ${visHtml}
        </div>
        <div class="pub-card-date">${escapeHtml(friendlyDate(n.scanned_at || n.created_at))}</div>
        <div class="pub-card-snippet">${escapeHtml(n.summary_snippet || '')}</div>
      `;

      const actions = document.createElement('div');
      actions.className = 'note-card-actions';
      actions.innerHTML = `
        <a href="results.html?id=${encodeURIComponent(n.id)}" class="note-card-action" onclick="event.stopPropagation()">${editSvg} Edit</a>
        ${n.share_token ? `<a href="/share/${encodeURIComponent(n.share_token)}" class="note-card-action note-card-action-pub" onclick="event.stopPropagation()">Published ↗</a>` : ''}
      `;
      body.appendChild(actions);
      card.appendChild(body);
      listEl.appendChild(card);

      if (hasThumb) {
        loadNoteThumbnail(card.querySelector('.pub-card-hero'), n.id, n.first_image_position, token);
      }
    });
  }

  function filteredNotes() {
    const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
    return notes.filter(n => {
      if (activeVis !== '') {
        if (!n.share_token) return false;
        if ((n.visibility || 'public') !== activeVis) return false;
      }
      return !q || (n.title || '').toLowerCase().includes(q) || (n.summary_snippet || '').toLowerCase().includes(q);
    });
  }

  async function loadAll() {
    try {
      const resp = await fetch(NOTES_URL, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (resp.ok) notes = await resp.json();
    } catch (_) {}
    renderNotes(filteredNotes());
  }

  if (searchEl) {
    searchEl.addEventListener('input', () => renderNotes(filteredNotes()));
  }
  if (filterEl) {
    filterEl.addEventListener('click', e => {
      const btn = e.target.closest('.pub-vis-btn');
      if (!btn) return;
      filterEl.querySelectorAll('.pub-vis-btn').forEach(b => b.classList.remove('pub-vis-active'));
      btn.classList.add('pub-vis-active');
      activeVis = btn.dataset.vis;
      renderNotes(filteredNotes());
    });
  }

  loadAll();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function markdownToPlainText(text) {
  if (!text) return '';
  return text
    .replace(/^### (.+)$/gm, '$1')
    .replace(/^## (.+)$/gm, '$1')
    .replace(/^[-*] (.+)$/gm, '• $1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let listType = null;
  function closeList() { if (listType) { out.push(`</${listType}>`); listType = null; } }
  function inlineFormat(s) {
    // Split on URLs so they can be linked without double-escaping
    return s.split(/(https?:\/\/[^\s]+)/g).map((part, idx) => {
      if (idx % 2 === 1) {
        // URL — trim trailing punctuation that's likely not part of it
        const url = part.replace(/[.,;:!?)'"\]]+$/, '');
        const tail = part.slice(url.length);
        const esc = escapeHtml(url);
        return `<a href="${esc}" target="_blank" rel="noopener">${esc}</a>${escapeHtml(tail)}`;
      }
      return escapeHtml(part).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }).join('');
  }
  for (const line of lines) {
    const t = line.trim();
    if (t === '') { closeList(); continue; }
    if (/^### (.+)/.test(t)) { closeList(); out.push(`<h3>${inlineFormat(t.slice(4))}</h3>`); }
    else if (/^## (.+)/.test(t)) { closeList(); out.push(`<h2>${inlineFormat(t.slice(3))}</h2>`); }
    else if (/^[-*] (.+)/.test(t)) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inlineFormat(t.slice(2))}</li>`);
    } else if (/^\d+\. (.+)/.test(t)) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inlineFormat(t.replace(/^\d+\. /, ''))}</li>`);
    } else { closeList(); out.push(`<p>${inlineFormat(t)}</p>`); }
  }
  closeList();
  return out.join('\n');
}

function setMd(el, text) {
  el.innerHTML = renderMarkdown(text);
  el.dataset.rawMd = text;
}

/* ── Share page logic ── */

async function initShare() {
  const pathParts = location.pathname.split('/').filter(Boolean);
  const token = pathParts[pathParts.length - 1] || null;
  const loadingEl = document.getElementById('share-loading');
  const contentEl = document.getElementById('share-content');
  const errorEl   = document.getElementById('share-error');

  if (!token) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = false;
    return;
  }

  // Share page lightbox
  const shareLb = document.getElementById('share-lightbox');
  const shareLbImg = document.getElementById('share-lightbox-img');
  let shareLbSrcs = [];
  let shareLbIndex = 0;
  let shareClerkToken = null; // set when auth is required to load the share page

  function updateShareLbNav() {
    const multi = shareLbSrcs.length > 1;
    shareLb?.querySelector('.lb-prev') && (shareLb.querySelector('.lb-prev').style.visibility = multi ? 'visible' : 'hidden');
    shareLb?.querySelector('.lb-next') && (shareLb.querySelector('.lb-next').style.visibility = multi ? 'visible' : 'hidden');
  }

  function openShareLightbox(srcs, index) {
    shareLbSrcs = srcs;
    shareLbIndex = index;
    if (shareLbImg) shareLbImg.src = srcs[index];
    if (shareLb) shareLb.hidden = false;
    updateShareLbNav();
  }

  function closeShareLightbox() {
    if (shareLb) shareLb.hidden = true;
    if (shareLbImg) shareLbImg.src = '';
  }

  if (shareLb) {
    shareLb.addEventListener('click', e => {
      if (e.target === shareLb || e.target === shareLbImg) closeShareLightbox();
    });
    shareLb.querySelector('.lb-close')?.addEventListener('click', closeShareLightbox);
    shareLb.querySelector('.lb-prev')?.addEventListener('click', e => {
      e.stopPropagation();
      shareLbIndex = (shareLbIndex - 1 + shareLbSrcs.length) % shareLbSrcs.length;
      if (shareLbImg) shareLbImg.src = shareLbSrcs[shareLbIndex];
    });
    shareLb.querySelector('.lb-next')?.addEventListener('click', e => {
      e.stopPropagation();
      shareLbIndex = (shareLbIndex + 1) % shareLbSrcs.length;
      if (shareLbImg) shareLbImg.src = shareLbSrcs[shareLbIndex];
    });
  }

  document.addEventListener('keydown', e => {
    if (!shareLb || shareLb.hidden) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); shareLb.querySelector('.lb-prev')?.click(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); shareLb.querySelector('.lb-next')?.click(); }
    else if (e.key === 'Escape') closeShareLightbox();
  });

  const authWallEl = document.getElementById('share-auth-wall');

  async function fetchShareData(authHeader) {
    const headers = authHeader ? { 'Authorization': authHeader } : {};
    return fetch(`/api/share/${encodeURIComponent(token)}`, { headers });
  }

  try {
    let resp = await fetchShareData(null);

    if (resp.status === 401) {
      const body = await resp.json().catch(() => ({}));
      if (loadingEl) loadingEl.hidden = true;
      if (authWallEl) authWallEl.hidden = false;
      await waitForClerk();
      await window.Clerk.load();
      if (!window.Clerk.user) {
        window.Clerk.mountSignIn(document.getElementById('clerk-share-sign-in'));
        await new Promise(resolve => {
          window.Clerk.addListener(({ user }) => { if (user) resolve(); });
        });
      }
      if (authWallEl) authWallEl.hidden = true;
      if (loadingEl) { loadingEl.hidden = false; }
      const clerkToken = await window.Clerk.session.getToken();
      shareClerkToken = clerkToken;
      resp = await fetchShareData(`Bearer ${clerkToken}`);
    }

    if (resp.status === 403) {
      if (loadingEl) loadingEl.hidden = true;
      if (errorEl) { errorEl.textContent = 'This note is private.'; errorEl.hidden = false; }
      return;
    }

    if (!resp.ok) throw new Error('not found');
    const data = await resp.json();

    if (loadingEl) loadingEl.hidden = true;

    // Apply publish options (with defaults)
    const opts = data.publish_options || {};
    const showImages        = opts.showImages !== false;
    const showSectionTitles = opts.showSectionTitles !== false;
    const showSummary       = opts.showSummary !== false;
    const showTranscription = opts.showTranscription !== false;
    const showAdditional    = opts.showAdditional !== false;
    const imagePosition     = opts.imagePosition || 'top';

    // Template and logo come from owner settings (data.template / data.logo_on / data.list_token)
    const template  = data.template || 'minimal';
    const logoOn    = data.logo_on === true;
    const listToken = data.list_token || null;
    const listUrl   = listToken ? `/published/${listToken}` : null;

    document.body.dataset.template = template;

    // Logo
    const logoTop    = document.getElementById('sp-logo-top');
    const logoBottom = document.getElementById('sp-logo-bottom');
    const logoTopA   = document.getElementById('sp-logo-top-a');
    const logoBottomA = document.getElementById('sp-logo-bottom-a');
    if (logoOn) {
      if (listUrl) {
        if (logoTopA) logoTopA.href = listUrl;
        if (logoBottomA) logoBottomA.href = listUrl;
      }
      if (logoTop) logoTop.hidden = false;
    }

    // Home link
    const homeLink = document.getElementById('share-home-link');
    if (homeLink && listUrl) {
      homeLink.href = listUrl;
      homeLink.hidden = false;
    }

    // Title + date
    const titleEl = document.getElementById('share-title');
    const dateEl  = document.getElementById('share-date');
    if (data.title && titleEl) {
      titleEl.textContent = data.title;
      document.title = `${data.title} — ReadWrite`;
    }
    const dateStr = friendlyDate(data.scanned_at);
    if (dateStr && dateEl) {
      dateEl.textContent = dateStr;
      dateEl.hidden = false;
    }

    // Summary
    if (showSummary && data.summary) {
      const section  = document.getElementById('share-summary-section');
      const textEl   = document.getElementById('share-summary-text');
      const heading  = document.getElementById('share-summary-heading');
      if (textEl) setMd(textEl, data.summary);
      if (heading) heading.hidden = !showSectionTitles;
      if (section) section.hidden = false;
    }

    // Transcription
    if (showTranscription && data.transcription) {
      const section  = document.getElementById('share-transcription-section');
      const textEl   = document.getElementById('share-transcription-text');
      const heading  = document.getElementById('share-transcription-heading');
      if (textEl) setMd(textEl, data.transcription);
      if (heading) heading.hidden = !showSectionTitles;
      if (section) section.hidden = false;
    }

    // Additional notes
    if (showAdditional && data.additional_notes) {
      const section  = document.getElementById('share-additional-section');
      const textEl   = document.getElementById('share-additional-text');
      const heading  = document.getElementById('share-additional-heading');
      if (textEl) setMd(textEl, data.additional_notes);
      if (heading) heading.hidden = !showSectionTitles;
      if (section) section.hidden = false;
    }

    // Images
    if (showImages) {
      const containerMap = {
        'top':                  document.getElementById('share-images-top'),
        'after-summary':        document.getElementById('share-images-after-summary'),
        'after-transcription':  document.getElementById('share-images-after-transcription'),
        'bottom':               document.getElementById('share-images-bottom'),
      };
      const imgContainer = containerMap[imagePosition] || containerMap['top'];
      const excludedSet = new Set((opts.excludedImages || []).map(Number));
      const imageFiles = (data.files || []).filter(f => f.kind === 'image' && !excludedSet.has(Number(f.position)));

      if (imageFiles.length && imgContainer) {
        imgContainer.hidden = false;
        const needsAuth = shareClerkToken && (data.visibility === 'logged_in' || data.visibility === 'me');
        const srcs = needsAuth
          ? await Promise.all(imageFiles.map(async f => {
              const r = await fetch(`/api/share/${encodeURIComponent(token)}/images/${f.position}`, {
                headers: { 'Authorization': `Bearer ${shareClerkToken}` },
              });
              if (!r.ok) return '';
              return URL.createObjectURL(await r.blob());
            }))
          : imageFiles.map(f => `/api/share/${encodeURIComponent(token)}/images/${f.position}`);
        if (imageFiles.length === 1) {
          const img = document.createElement('img');
          img.src = srcs[0];
          img.className = 'sp-image-hero';
          img.alt = '';
          img.loading = 'lazy';
          img.addEventListener('click', () => openShareLightbox(srcs, 0));
          imgContainer.appendChild(img);
        } else {
          const heroImg = document.createElement('img');
          heroImg.src = srcs[0];
          heroImg.className = 'sp-image-hero';
          heroImg.alt = '';
          heroImg.loading = 'lazy';
          heroImg.addEventListener('click', () => openShareLightbox(srcs, 0));
          imgContainer.appendChild(heroImg);
          const thumbsDiv = document.createElement('div');
          thumbsDiv.className = 'sp-image-thumbs';
          imageFiles.slice(1).forEach((f, i) => {
            const img = document.createElement('img');
            img.src = srcs[i + 1];
            img.className = 'sp-image-thumb';
            img.alt = '';
            img.loading = 'lazy';
            img.addEventListener('click', () => openShareLightbox(srcs, i + 1));
            thumbsDiv.appendChild(img);
          });
          imgContainer.appendChild(thumbsDiv);
        }
      }
    }

    // Prev/Next navigation (only when list is public, same condition as Home link)
    if (listUrl && (data.prev_token || data.next_token)) {
      const footer = document.querySelector('.sp-footer');
      if (footer) {
        if (data.prev_token) {
          const prev = document.createElement('a');
          prev.href = `/share/${encodeURIComponent(data.prev_token)}`;
          prev.className = 'sp-nav-link sp-nav-prev';
          prev.setAttribute('aria-label', 'Previous note');
          prev.textContent = '←';
          footer.insertBefore(prev, footer.firstChild);
        }
        if (data.next_token) {
          const next = document.createElement('a');
          next.href = `/share/${encodeURIComponent(data.next_token)}`;
          next.className = 'sp-nav-link sp-nav-next';
          next.setAttribute('aria-label', 'Next note');
          next.textContent = '→';
          footer.appendChild(next);
        }
      }
    }

    if (contentEl) contentEl.hidden = false;

    // Share button — visible to all visitors
    const shareBtn = document.getElementById('sp-share-btn');
    if (shareBtn) {
      shareBtn.hidden = false;
      shareBtn.addEventListener('click', async () => {
        const url = window.location.href;
        const title = document.title;
        if (navigator.share) {
          try { await navigator.share({ title, url }); } catch (_) {}
        } else {
          try {
            await navigator.clipboard.writeText(url);
            shareBtn.setAttribute('aria-label', 'Copied!');
            setTimeout(() => shareBtn.setAttribute('aria-label', 'Share'), 1800);
          } catch (_) {}
        }
      });
    }

    // Show edit button + visibility icon if the viewer owns this note
    function showEditBtn(noteId) {
      const editBtn = document.getElementById('sp-edit-btn');
      if (editBtn) { editBtn.href = `/results.html?id=${encodeURIComponent(noteId)}`; editBtn.hidden = false; }

      // Globe = published list link (shown when owner has a public list)
      if (data.list_token) {
        const listBtn = document.getElementById('sp-list-btn');
        if (listBtn) { listBtn.href = `/published/${encodeURIComponent(data.list_token)}`; listBtn.hidden = false; }
      }

      // Visibility status — top-left badge for owner
      const visStatus = document.getElementById('sp-vis-status');
      if (visStatus) {
        const vis = data.visibility || 'public';
        const unlock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
        const person = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        const eye    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
        const svgs   = { public: unlock, logged_in: person, me: eye };
        const labels = { public: 'Public', logged_in: 'Members only', me: 'Private' };
        visStatus.innerHTML = svgs[vis] || unlock;
        visStatus.title = labels[vis] || 'Public';
        visStatus.hidden = false;
      }
    }
    if (data.is_owner) {
      showEditBtn(data.id);
      const homeBtn = document.getElementById('sp-home-btn');
      if (homeBtn) homeBtn.hidden = false;
    } else {
      (async () => {
        try {
          await waitForClerk();
          await window.Clerk.load();
          if (!window.Clerk.user) return;
          const homeBtn = document.getElementById('sp-home-btn');
          if (homeBtn) homeBtn.hidden = false;
          const clerkTok = await window.Clerk.session.getToken();
          const ownerResp = await fetchShareData(`Bearer ${clerkTok}`);
          if (!ownerResp.ok) return;
          const ownerData = await ownerResp.json();
          if (ownerData.is_owner) showEditBtn(ownerData.id);
        } catch (_) {}
      })();
    }
  } catch (_) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = false;
  }
}

/* ── Settings page logic ── */

async function initSettings() {
  await waitForClerk();
  await window.Clerk.load();

  const signInWall  = document.getElementById('sign-in-wall');
  const settingsApp = document.getElementById('settings-app');

  if (!window.Clerk.user) {
    if (settingsApp) settingsApp.hidden = true;
    if (signInWall) signInWall.hidden = false;
    window.Clerk.mountSignIn(document.getElementById('clerk-sign-in'));
    return;
  }
  if (signInWall) signInWall.hidden = true;
  if (settingsApp) settingsApp.hidden = false;

  initHamburger();

  const token = await getToken();
  const statusEl = document.getElementById('settings-status');
  const listUrlRow = document.getElementById('setting-list-url-row');
  const listUrlA   = document.getElementById('setting-list-url-a');

  let current = {};
  try {
    const resp = await fetch('/api/settings', { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
    if (resp.ok) current = await resp.json();
  } catch (_) {}

  function applySettings(s) {
    const titleEl  = document.getElementById('setting-list-title');
    const logoEl   = document.getElementById('setting-logo-on');
    const pubEl    = document.getElementById('setting-list-public');
    if (titleEl)  titleEl.value   = s.story_list_title || '';
    if (logoEl)   logoEl.checked  = s.logo_on === 'true';
    if (pubEl)    pubEl.checked   = s.list_public === 'true';
    const tplEl = document.querySelector(`input[name="setting-template"][value="${s.template || 'minimal'}"]`);
    if (tplEl) tplEl.checked = true;
    if (s.list_token && s.list_public === 'true') {
      const url = `${location.origin}/published/${s.list_token}`;
      if (listUrlA) { listUrlA.href = url; listUrlA.textContent = url; }
      if (listUrlRow) listUrlRow.hidden = false;
    } else {
      if (listUrlRow) listUrlRow.hidden = true;
    }
  }

  applySettings(current);

  let saveTimer;
  async function saveSettings() {
    const titleEl = document.getElementById('setting-list-title');
    const logoEl  = document.getElementById('setting-logo-on');
    const pubEl   = document.getElementById('setting-list-public');
    const tplEl   = document.querySelector('input[name="setting-template"]:checked');
    const payload = {
      story_list_title: titleEl?.value || '',
      template:         tplEl?.value || 'minimal',
      logo_on:          logoEl?.checked ? 'true' : 'false',
      list_public:      pubEl?.checked  ? 'true' : 'false',
    };
    try {
      const resp = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        current = await resp.json();
        applySettings(current);
        if (statusEl) {
          statusEl.textContent = 'Settings saved';
          setTimeout(() => { statusEl.textContent = ''; }, 2000);
        }
      }
    } catch (_) {}
  }

  const saveBtn = document.getElementById('settings-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      await saveSettings();
      saveBtn.disabled = false;
    });
  }
}

/* ── Published list page logic ── */

async function initPublished() {
  const pathParts  = location.pathname.split('/').filter(Boolean);
  const listToken  = pathParts[pathParts.length - 1] || null;
  const loadingEl  = document.getElementById('pub-loading');
  const contentEl  = document.getElementById('pub-content');
  const errorEl    = document.getElementById('pub-error');

  if (!listToken) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = false;
    return;
  }

  const VIS_SVG = {
    public:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
    logged_in: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    me:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  };
  const VIS_LABEL = { public: 'Public', logged_in: 'Members only', me: 'Private' };

  try {
    const resp = await fetch(`/api/published/${encodeURIComponent(listToken)}`);
    if (!resp.ok) throw new Error('not found or private');
    let { settings, notes } = await resp.json();

    // Owner detection — non-blocking; Clerk may or may not be present
    let pubClerkToken = null;
    try {
      await waitForClerk();
      await window.Clerk.load();
      if (window.Clerk.user) {
        const navBtns = document.getElementById('pub-nav-btns');
        if (navBtns) navBtns.hidden = false;
        pubClerkToken = await window.Clerk.session.getToken();
        const ownerResp = await fetch(`/api/published/${encodeURIComponent(listToken)}`, {
          headers: { 'Authorization': `Bearer ${pubClerkToken}` },
        });
        if (ownerResp.ok) {
          const ownerData = await ownerResp.json();
          if (ownerData.settings.isOwner) { settings = ownerData.settings; notes = ownerData.notes; }
        }
      }
    } catch (_) {}

    if (loadingEl) loadingEl.hidden = true;

    document.body.dataset.template = settings.template || 'minimal';
    document.title = (settings.storyListTitle || 'Published Notes') + ' — ReadWrite';

    const titleEl = document.getElementById('pub-list-title');
    if (titleEl) titleEl.textContent = settings.storyListTitle || 'Published Notes';

    const listUrl = `/published/${listToken}`;
    const logoTopEl    = document.getElementById('pub-logo-top');
    const logoBottomEl = document.getElementById('pub-logo-bottom');
    const logoTopA     = document.getElementById('pub-logo-top-a');
    const logoBottomA  = document.getElementById('pub-logo-bottom-a');
    if (settings.logoOn) {
      if (logoTopA)    logoTopA.href    = listUrl;
      if (logoBottomA) logoBottomA.href = listUrl;
      if (logoTopEl)   logoTopEl.hidden = false;
    }

    const listEl   = document.getElementById('pub-notes-list');
    const emptyEl  = document.getElementById('pub-notes-empty');
    const searchEl = document.getElementById('pub-search');
    const filterEl = document.getElementById('pub-vis-filter');

    const needsAuth = vis => pubClerkToken && (vis === 'logged_in' || vis === 'me');

    function renderNotes(items) {
      if (!listEl) return;
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = items.length > 0;
      items.forEach(n => {
        const positions = n.image_positions || [];
        const heroPos = positions.length > 0 ? positions[0] : null;
        const extraPositions = positions.slice(1);
        const vis = n.visibility || 'public';
        const card = document.createElement('a');
        card.className = 'pub-card';
        card.href = `/share/${n.share_token}`;

        const visIconHtml = settings.isOwner
          ? `<span class="pub-card-vis" title="${VIS_LABEL[vis] || 'Public'}">${VIS_SVG[vis] || VIS_SVG.public}</span>`
          : '';

        // Placeholder img elements (src set below, possibly via auth fetch)
        const heroId    = heroPos !== null ? `pub-hero-${n.id}` : null;
        const heroHtml  = heroPos !== null
          ? `<img id="${heroId}" class="pub-card-hero" src="" alt="" loading="lazy">`
          : '';
        const thumbIds  = extraPositions.map((p, i) => `pub-thumb-${n.id}-${i}`);
        const thumbsHtml = extraPositions.length
          ? `<div class="pub-card-thumbs">${extraPositions.map((p, i) =>
              `<img id="${thumbIds[i]}" class="pub-card-thumb" src="" alt="" loading="lazy">`
            ).join('')}</div>`
          : '';

        card.innerHTML = `
          ${heroHtml}
          <div class="pub-card-body">
            <div class="pub-card-title-row">
              <div class="pub-card-title">${escapeHtml(n.title || 'Untitled')}</div>
              ${visIconHtml}
            </div>
            <div class="pub-card-date">${escapeHtml(friendlyDate(n.scanned_at || n.created_at))}</div>
            <div class="pub-card-snippet">${renderMarkdown(n.summary_snippet || '')}</div>
            ${thumbsHtml}
          </div>`;
        listEl.appendChild(card);

        // Populate image srcs — auth-fetch for restricted notes, direct URL for public
        function setImgSrc(imgId, position) {
          const img = document.getElementById(imgId);
          if (!img) return;
          const url = `/api/share/${encodeURIComponent(n.share_token)}/images/${position}`;
          if (needsAuth(vis)) {
            fetch(url, { headers: { 'Authorization': `Bearer ${pubClerkToken}` } })
              .then(r => r.ok ? r.blob() : null)
              .then(blob => { if (blob && img) img.src = URL.createObjectURL(blob); })
              .catch(() => {});
          } else {
            img.src = url;
          }
        }
        if (heroId !== null) setImgSrc(heroId, heroPos);
        extraPositions.forEach((p, i) => setImgSrc(thumbIds[i], p));
      });
    }

    let activeVis = '';
    function filteredNotes() {
      const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
      return notes.filter(n =>
        (activeVis === '' || (n.visibility || 'public') === activeVis) &&
        (!q || (n.title || '').toLowerCase().includes(q) || (n.summary_snippet || '').toLowerCase().includes(q))
      );
    }

    renderNotes(notes);

    if (searchEl) {
      searchEl.addEventListener('input', () => renderNotes(filteredNotes()));
    }

    // Visibility filter — owner only
    if (settings.isOwner && filterEl) {
      filterEl.hidden = false;
      filterEl.addEventListener('click', e => {
        const btn = e.target.closest('.pub-vis-btn');
        if (!btn) return;
        filterEl.querySelectorAll('.pub-vis-btn').forEach(b => b.classList.remove('pub-vis-active'));
        btn.classList.add('pub-vis-active');
        activeVis = btn.dataset.vis;
        renderNotes(filteredNotes());
      });
    }

    if (contentEl) contentEl.hidden = false;
  } catch (_) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = false;
  }
}

/* ── Router ── */

if (document.getElementById('scan-btn')) {
  initIndex().catch(console.error);
} else if (document.getElementById('notes-list')) {
  initNotes().catch(console.error);
} else if (document.getElementById('settings-app')) {
  initSettings().catch(console.error);
} else if (document.getElementById('published-view')) {
  initPublished().catch(console.error);
} else if (document.getElementById('share-view')) {
  initShare().catch(console.error);
} else if (document.getElementById('summary-text')) {
  initResults().catch(console.error);
}
