/* ReadWrite — app.js */

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

async function initIndex() {
  await waitForClerk();
  await window.Clerk.load();

  const signInWall = document.getElementById('sign-in-wall');
  const appEl      = document.getElementById('app');

  function showApp() {
    signInWall.hidden = true;
    appEl.hidden = false;
    const email = window.Clerk.user?.primaryEmailAddress?.emailAddress || '';
    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = email;
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

  document.getElementById('btn-signout')?.addEventListener('click', async () => {
    await window.Clerk.signOut();
    // addListener above handles the UI transition
  });

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
    // (Save POSTs to /api/notes behind require_user).
    await waitForClerk();
    await window.Clerk.load();
  }

  setMd(document.getElementById('summary-text'), data.summary || '');
  setMd(document.getElementById('transcription-text'), data.transcription || '');
  if (data.additional_notes) {
    setMd(document.getElementById('additional-notes-text'), data.additional_notes);
    document.getElementById('additional-notes-section').hidden = false;
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

  // ── Image strip + lightbox ──
  const strip = document.getElementById('image-strip');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  function openLightbox(src) { lightboxImg.src = src; lightbox.hidden = false; }
  if (lightbox) {
    lightbox.addEventListener('click', () => { lightbox.hidden = true; lightboxImg.src = ''; });
  }

  const shareFiles = [];  // File objects offered to the share sheet when "Image(s)" is checked

  function addImageTile(thumbSrc, fullSrc, i, exif) {
    const figure = document.createElement('figure');
    figure.className = 'thumb-figure';

    const img = document.createElement('img');
    img.src = thumbSrc;
    img.className = 'thumb';
    img.alt = `Image ${i + 1}`;
    img.addEventListener('click', () => openLightbox(fullSrc || thumbSrc));
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

      const taken = exif.DateTimeOriginal || exif.DateTime;
      if (taken) addExifRow('Taken', taken);
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
        const span = document.createElement('span');
        span.appendChild(a);
        span.appendChild(document.createTextNode(' (private)'));
        addExifRow('Location', span);
      }

      details.appendChild(dl);
      figure.appendChild(details);
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

  function getEditEl(section) {
    return INLINE_SECTIONS.includes(section)
      ? document.getElementById(section)
      : document.getElementById(`${section}-text`);
  }

  function getText(section) {
    const el = getEditEl(section);
    if (!el) return '';
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
        const restored = document.createElement(isInline ? (section === 'note-title' ? 'h1' : 'div') : 'div');
        restored.className = isInline ? el.dataset.origClass || '' : 'result-text';
        restored.id = section === 'note-title' ? 'note-title' : section === 'note-date' ? 'note-date' : `${section}-text`;
        if (section === 'note-title') restored.className = 'note-title';
        if (section === 'note-date') restored.className = 'note-date';
        if (isInline) {
          restored.textContent = el.value;
        } else {
          setMd(restored, el.value);
        }
        el.replaceWith(restored);
        btn.textContent = 'Edit';
      } else {
        const input = document.createElement(isInline ? 'input' : 'textarea');
        input.className = isInline ? 'note-inline-input' : 'result-textarea';
        input.id = el.id;
        if (isInline) {
          input.type = 'text';
          input.value = el.textContent;
        } else {
          input.value = el.dataset.rawMd ?? el.textContent;
        }
        el.replaceWith(input);
        input.focus();
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
        const addNotes = getText('additional-notes');
        const additionalText = addNotes ? `\n\nAdditional Notes:\n${addNotes}` : '';
        parts.push(`Summary:\n${getText('summary')}${additionalText}`);
      }
      if (document.getElementById('share-transcription').checked) {
        parts.push(`Transcription:\n${getText('transcription')}`);
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
    };
  }

  // ── Save (fresh scan) vs Update/Delete (saved note) ──
  const saveBtn   = document.getElementById('save-btn');
  const updateBtn = document.getElementById('update-btn');
  const deleteBtn = document.getElementById('delete-btn');

  // ── Publish / unpublish ──
  const publishBtn    = document.getElementById('publish-btn');
  const unpublishBtn  = document.getElementById('unpublish-btn');
  const shareLinkRow  = document.getElementById('share-link-row');
  const shareLinkInput = document.getElementById('share-link-input');
  const copyLinkBtn   = document.getElementById('copy-link-btn');

  let currentNoteId = savedId;  // set after fresh save

  function showShareLink(token) {
    const url = `${window.location.origin}/share/${token}`;
    if (shareLinkInput) shareLinkInput.value = url;
    if (shareLinkRow) shareLinkRow.hidden = false;
    if (publishBtn) publishBtn.hidden = true;
    if (unpublishBtn) unpublishBtn.hidden = false;
  }

  function hideShareLink() {
    if (shareLinkRow) shareLinkRow.hidden = true;
    if (unpublishBtn) unpublishBtn.hidden = true;
    if (publishBtn) publishBtn.hidden = false;
  }

  // Initial publish state in saved mode
  if (mode === 'saved') {
    if (data.share_token) {
      showShareLink(data.share_token);
    } else if (publishBtn) {
      publishBtn.hidden = false;
    }
  }

  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      if (!currentNoteId) return;
      publishBtn.disabled = true;
      copiedMsg.textContent = 'Publishing…';
      try {
        const token = await getToken();
        const resp = await fetch(`${NOTES_URL}/${currentNoteId}/publish`, {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (!resp.ok) throw new Error('Publish failed');
        const { share_token } = await resp.json();
        showShareLink(share_token);
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
        hideShareLink();
        copiedMsg.textContent = 'Page unpublished.';
        setTimeout(() => { copiedMsg.textContent = ''; }, 2500);
      } catch (e) {
        copiedMsg.textContent = e.message || 'Unpublish failed';
      } finally {
        unpublishBtn.disabled = false;
      }
    });
  }

  if (copyLinkBtn && shareLinkInput) {
    copyLinkBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareLinkInput.value);
        copiedMsg.textContent = 'Link copied!';
        setTimeout(() => { copiedMsg.textContent = ''; }, 2500);
      } catch (_) {
        shareLinkInput.select();
        copiedMsg.textContent = 'Select and copy the link above.';
      }
    });
  }

  if (mode === 'fresh' && saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      copiedMsg.textContent = 'Saving…';
      try {
        const scanId = sessionStorage.getItem(SCAN_ID_KEY);
        const persist = scanId ? (await idbGet(scanId)) || [] : [];
        const exifList = data.file_exif || [];
        const fd = new FormData();
        fd.append('note', JSON.stringify({ ...currentTextFields(), scanned_at: data.scanned_at || '' }));
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
        if (publishBtn) publishBtn.hidden = false;
      } catch (e) {
        saveBtn.disabled = false;
        copiedMsg.textContent = e.message || 'Save failed';
      }
    });
  } else if (saveBtn) {
    saveBtn.hidden = true;
  }

  if (mode === 'saved') {
    if (updateBtn) {
      updateBtn.hidden = false;
      updateBtn.addEventListener('click', async () => {
        updateBtn.disabled = true;
        copiedMsg.textContent = 'Updating…';
        try {
          const token = await getToken();
          const resp = await fetch(`${NOTES_URL}/${savedId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
            body: JSON.stringify(currentTextFields()),
          });
          if (!resp.ok) throw new Error('Update failed');
          copiedMsg.textContent = 'Updated!';
          setTimeout(() => { copiedMsg.textContent = ''; }, 2500);
        } catch (e) {
          copiedMsg.textContent = e.message || 'Update failed';
        } finally {
          updateBtn.disabled = false;
        }
      });
    }
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

  const listEl   = document.getElementById('notes-list');
  const emptyEl  = document.getElementById('notes-empty');
  const searchEl = document.getElementById('notes-search');

  async function load(q) {
    const token = await getToken();
    let notes = [];
    try {
      const resp = await fetch(`${NOTES_URL}?q=${encodeURIComponent(q || '')}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (resp.ok) notes = await resp.json();
    } catch (_) {}

    listEl.innerHTML = '';
    emptyEl.hidden = notes.length > 0;
    notes.forEach(n => {
      const row = document.createElement('a');
      row.className = 'note-row';
      row.href = `results.html?id=${encodeURIComponent(n.id)}`;
      row.innerHTML = `
        <div class="note-row-title">${escapeHtml(n.title || 'Untitled')}</div>
        <div class="note-row-date">${escapeHtml(friendlyDate(n.scanned_at || n.created_at))}</div>
        <div class="note-row-snippet">${escapeHtml(n.summary_snippet || '')}</div>`;
      listEl.appendChild(row);
    });
  }

  let t;
  searchEl.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => load(searchEl.value.trim()), 250);
  });

  load('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let listType = null;
  function closeList() { if (listType) { out.push(`</${listType}>`); listType = null; } }
  function inlineFormat(s) {
    return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
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
  // Token is the last path segment: /share/{token}
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

  try {
    const resp = await fetch(`/api/share/${encodeURIComponent(token)}`);
    if (!resp.ok) throw new Error('not found');
    const data = await resp.json();

    if (loadingEl) loadingEl.hidden = true;

    const titleEl = document.getElementById('share-title');
    const dateEl  = document.getElementById('share-date');
    const metaEl  = document.getElementById('share-note-meta');

    if (data.title && titleEl) {
      titleEl.textContent = data.title;
      document.title = `${data.title} — ReadWrite`;
    }
    const dateStr = friendlyDate(data.scanned_at);
    if (dateStr && dateEl) dateEl.textContent = dateStr;
    if ((data.title || dateStr) && metaEl) metaEl.hidden = false;

    const summaryCard = document.getElementById('share-summary-card');
    const summaryText = document.getElementById('share-summary-text');
    if (data.summary && summaryText) {
      setMd(summaryText, data.summary);
      if (summaryCard) summaryCard.hidden = false;
    }

    const transcriptionCard = document.getElementById('share-transcription-card');
    const transcriptionText = document.getElementById('share-transcription-text');
    if (data.transcription && transcriptionText) {
      setMd(transcriptionText, data.transcription);
      if (transcriptionCard) transcriptionCard.hidden = false;
    }

    if (data.additional_notes) {
      const addlCard = document.getElementById('share-additional-card');
      const addlText = document.getElementById('share-additional-text');
      if (addlText) {
        setMd(addlText, data.additional_notes);
        if (addlCard) addlCard.hidden = false;
      }
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
} else if (document.getElementById('share-view')) {
  initShare().catch(console.error);
} else if (document.getElementById('summary-text')) {
  initResults().catch(console.error);
}
