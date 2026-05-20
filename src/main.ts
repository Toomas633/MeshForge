let selectedFiles: File[] = [];

const dropZone = document.getElementById('dropZone') as HTMLDivElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const browseLink = document.getElementById('browseLink');
const fileList = document.getElementById('fileList') as HTMLUListElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const addBtn = document.getElementById('addBtn') as HTMLButtonElement;
const addModal = document.getElementById('addModal') as HTMLDivElement;
const modalClose = document.getElementById('modalClose') as HTMLButtonElement;
const themeToggle = document.getElementById('themeToggle');

themeToggle?.addEventListener('click', () => {
  const isLight = document.documentElement.dataset.theme === 'light';
  if (isLight) {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem('theme');
  } else {
    document.documentElement.dataset.theme = 'light';
    localStorage.setItem('theme', 'light');
  }
});

browseLink?.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', (e) => {
  if (e.target !== browseLink) fileInput.click();
});

fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files ?? []));
  fileInput.value = '';
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  addFiles(Array.from(e.dataTransfer?.files ?? []));
});

addBtn.addEventListener('click', openAddModal);
modalClose.addEventListener('click', closeAddModal);
addModal.addEventListener('click', (e) => {
  if (e.target === addModal) closeAddModal();
});
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') closeAddModal();
});

window.addEventListener('beforeunload', () => {
  navigator.sendBeacon('/api/jobs/cancel');
});

startBtn.addEventListener('click', startConversion);

function openAddModal(): void {
  addModal.classList.add('open');
}

function closeAddModal(): void {
  addModal.classList.remove('open');
}

function addFiles(files: File[]): void {
  const allowed = new Set(['.stl', '.obj']);
  const toAdd: File[] = [];
  files.forEach((f) => {
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!allowed.has(ext)) return;
    if (selectedFiles.some((x) => x.name === f.name && x.size === f.size)) return;
    toAdd.push(f);
  });
  if (toAdd.length === 0) return;

  selectedFiles.push(...toAdd);
  renderFileList();

  if (activeJobCount > 0 && !addModal.classList.contains('open')) {
    startConversion();
  }
}

function removeFile(index: number): void {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList(): void {
  fileList.innerHTML = selectedFiles
    .map(
      (f, i) => `
      <li class="file-item">
        <span class="file-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </span>
        <span class="file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
        <span class="file-size">${fmtSize(f.size)}</span>
        <button class="remove-btn" onclick="removeFile(${i})" title="Remove">✕</button>
      </li>`
    )
    .join('');

  startBtn.disabled = selectedFiles.length === 0;
}

async function startConversion(): Promise<void> {
  if (selectedFiles.length === 0) return;
  const files = selectedFiles.slice();
  selectedFiles = [];
  renderFileList();
  closeAddModal();
  const ok = await submitFiles(files);
  if (!ok) {
    selectedFiles.unshift(...files);
    renderFileList();
    openAddModal();
  }
}

async function submitFiles(files: File[]): Promise<boolean> {
  const formData = new FormData();
  const jobIds = files.map(() => crypto.randomUUID());
  files.forEach((f) => formData.append('files', f));
  jobIds.forEach((id) => formData.append('job_ids', id));

  jobIds.forEach((jobId, i) => {
    activeJobCount++;
    _activeJobIds.add(jobId);
    createJobCard(jobId, files[i]);
  });
  if (jobIds.length > 1) createBatchCard(jobIds, files.length);

  let data: { error?: string };
  try {
    const res = await fetch('/api/convert', { method: 'POST', body: formData });
    data = (await res.json()) as { error?: string };
    if (!res.ok) {
      jobIds.forEach((id) => {
        document.getElementById(`job-${id}`)?.remove();
        _activeJobIds.delete(id);
        activeJobCount = Math.max(0, activeJobCount - 1);
      });
      alert(data.error ?? 'Failed to start conversion.');
      return false;
    }
  } catch (err) {
    jobIds.forEach((id) => {
      document.getElementById(`job-${id}`)?.remove();
      _activeJobIds.delete(id);
      activeJobCount = Math.max(0, activeJobCount - 1);
    });
    alert('Network error: ' + (err instanceof Error ? err.message : String(err)));
    return false;
  }

  return true;
}

connectSSE();
