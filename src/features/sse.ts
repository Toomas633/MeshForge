let _es: EventSource | null = null;

function connectSSE(): void {
  _es?.close();
  _es = new EventSource('/api/events');

  _es.onmessage = (e: MessageEvent<string>) => {
    try {
      const msg = JSON.parse(e.data) as SseMessage;
      if (msg.type === 'job_update' && msg.job) handleJobUpdate(msg.job);
    } catch {
      // ignore malformed messages
    }
  };

  _es.onerror = () => {
    _es?.close();
    setTimeout(connectSSE, 2000);
  };
}

function handleJobUpdate(job: Job): void {
  const card = document.getElementById(`job-${job.id}`);
  if (!card) return;
  updateJobCard(job);
  const terminal: Job['status'][] = ['done', 'error', 'cancelled'];
  if (terminal.includes(job.status) && _activeJobIds.has(job.id)) {
    _activeJobIds.delete(job.id);
    activeJobCount = Math.max(0, activeJobCount - 1);
    onJobFinished(job.id);
  }
}
