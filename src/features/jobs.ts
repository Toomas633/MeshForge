let activeJobCount = 0;
const _activeJobIds = new Set<string>();
const batchJobs: Record<string, Set<string>> = {};

const jobsList = document.getElementById('jobsList') as HTMLDivElement;

function createJobCard(jobId: string, file: File | string): void {
  const filename = file instanceof File ? file.name : file;
  const card = document.createElement('div');
  card.className = 'job-card pending';
  card.id = `job-${jobId}`;
  card.innerHTML = `
    <div class="job-header" onclick="handleCardClick('${jobId}')">
      <span class="job-preview" id="preview-${jobId}"></span>
      <span class="job-filename">${escHtml(filename)}</span>
      <span class="job-badge pending" id="badge-${jobId}">Pending</span>
      <span class="log-toggle" id="toggle-${jobId}" title="Toggle log"
            onclick="event.stopPropagation(); toggleLog('${jobId}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </span>
    </div>
    <div class="job-log" id="log-${jobId}"></div>
    <div class="job-downloads" id="dl-${jobId}"></div>
  `;
  jobsList.prepend(card);
  if (file instanceof File) generatePreview(jobId, file);
}

function toggleLog(jobId: string): void {
  document.getElementById(`job-${jobId}`)?.classList.toggle('log-open');
}

function handleCardClick(jobId: string): void {
  const card = document.getElementById(`job-${jobId}`);
  if (!card) return;
  if (card.classList.contains('done')) {
    loadJobPreview(jobId);
  } else {
    toggleLog(jobId);
  }
}

function updateJobCard(job: Job): void {
  const card = document.getElementById(`job-${job.id}`);
  if (!card) return;

  card.className = `job-card ${job.status}`;

  const badge = document.getElementById(`badge-${job.id}`);
  if (!badge) return;

  const labels: Record<Job['status'], string> = {
    pending: 'Pending',
    running: 'Converting…',
    done: 'Done',
    error: 'Error',
    cancelled: 'Cancelled',
  };
  const spinnerHtml = job.status === 'running' ? '<span class="spinner"></span>' : '';
  badge.className = `job-badge ${job.status}`;
  badge.innerHTML = `${spinnerHtml}${labels[job.status] ?? job.status}`;

  const logEl = document.getElementById(`log-${job.id}`);
  if (logEl && job.log.length > 0) {
    logEl.innerHTML = job.log
      .map((line) => {
        let cls = 'log-line';
        if (line.startsWith('===')) cls += ' section';
        else if (line.startsWith('WARN')) cls += ' warn';
        else if (line.startsWith('ERR')) cls += ' err';
        return `<div class="${cls}">${escHtml(line)}</div>`;
      })
      .join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  if (job.status === 'done' && job.outputs.length > 0) {
    const dlEl = document.getElementById(`dl-${job.id}`);
    if (dlEl) {
      dlEl.innerHTML = job.outputs
        .map(
          (fname) => `
        <a class="download-btn" href="/api/jobs/${job.id}/download/${encodeURIComponent(fname)}" download="${escHtml(fname)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 4v12m0 0-4-4m4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M4 18h16" stroke-linecap="round"/>
          </svg>
          ${escHtml(fname)}
        </a>`
        )
        .join('');
    }
  }
}

function createBatchCard(jobIds: string[], fileCount: number): void {
  const batchId = jobIds[0];
  batchJobs[batchId] = new Set(jobIds);

  const card = document.createElement('div');
  card.className = 'batch-card';
  card.id = `batch-${batchId}`;
  card.innerHTML = `
    <span class="batch-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M9 12h6M12 9v6"/>
      </svg>
      Batch &mdash; ${fileCount} files
    </span>
    <button class="zip-btn" id="zip-btn-${batchId}" disabled
            onclick="downloadZip('${jobIds.join(',')}')">
      <span class="spinner"></span>
      Download all as ZIP
    </button>
  `;
  jobsList.prepend(card);
}

function onJobFinished(jobId: string): void {
  for (const batchId of Object.keys(batchJobs)) {
    if (batchJobs[batchId].has(jobId)) {
      batchJobs[batchId].delete(jobId);
      if (batchJobs[batchId].size === 0) {
        enableZipBtn(batchId);
        delete batchJobs[batchId];
      }
      break;
    }
  }
}

function enableZipBtn(batchId: string): void {
  const btn = document.getElementById(`zip-btn-${batchId}`) as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M12 4v12m0 0-4-4m4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 18h16" stroke-linecap="round"/>
    </svg>
    Download all as ZIP
  `;
}

function downloadZip(jobIdsStr: string): void {
  const a = document.createElement('a');
  a.href = `/api/jobs/zip?jobs=${encodeURIComponent(jobIdsStr)}`;
  a.download = 'converted.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
