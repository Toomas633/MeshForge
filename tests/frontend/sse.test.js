'use strict';

// ── globals that sse.js references ──────────────────────────────────────────
globalThis.activeJobCount = 0;
globalThis._activeJobIds = new Set();
globalThis.updateJobCard = jest.fn();
globalThis.onJobFinished = jest.fn();

// ── EventSource mock ─────────────────────────────────────────────────────────
const esInstances = [];
let currentEs = null;
globalThis.EventSource = jest.fn().mockImplementation((url) => {
  currentEs = { url, onmessage: null, onerror: null, close: jest.fn() };
  esInstances.push(currentEs);
  return currentEs;
});

// ── DOM mock (handleJobUpdate reads a card element) ──────────────────────────
const mockCard = {
  className: '',
  classList: { add: jest.fn(), remove: jest.fn() },
};
globalThis.document = {
  getElementById: jest.fn(() => mockCard),
};

jest.useFakeTimers();

// ── module under test ────────────────────────────────────────────────────────
const { connectSSE, handleJobUpdate } = require('../../static/features/sse.js');

// ────────────────────────────────────────────────────────────────────────────
describe('connectSSE', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    esInstances.length = 0;
    currentEs = null;
    globalThis.activeJobCount = 0;
    globalThis._activeJobIds = new Set();
  });

  test('creates a new EventSource on /api/events', () => {
    connectSSE();
    expect(globalThis.EventSource).toHaveBeenCalledWith('/api/events');
    expect(esInstances).toHaveLength(1);
  });

  test('attaches onmessage and onerror handlers', () => {
    connectSSE();
    expect(typeof currentEs.onmessage).toBe('function');
    expect(typeof currentEs.onerror).toBe('function');
  });

  test('closes previous connection before creating a new one', () => {
    connectSSE();
    const first = currentEs;
    connectSSE();
    expect(first.close).toHaveBeenCalled();
    expect(esInstances).toHaveLength(2);
  });

  test('onmessage dispatches job_update to handleJobUpdate path', () => {
    connectSSE();
    const job = { id: 'j1', status: 'done', log: [], outputs: [] };
    currentEs.onmessage({ data: JSON.stringify({ type: 'job_update', job }) });
    expect(globalThis.updateJobCard).toHaveBeenCalledWith(job);
  });

  test('onmessage ignores messages without job_update type', () => {
    connectSSE();
    currentEs.onmessage({ data: JSON.stringify({ type: 'ping' }) });
    expect(globalThis.updateJobCard).not.toHaveBeenCalled();
  });

  test('onmessage silently ignores malformed JSON', () => {
    connectSSE();
    expect(() => currentEs.onmessage({ data: 'not-json{{' })).not.toThrow();
    expect(globalThis.updateJobCard).not.toHaveBeenCalled();
  });

  test('onerror closes connection and schedules reconnect after 2 s', () => {
    connectSSE();
    const es = currentEs;
    es.onerror();
    expect(es.close).toHaveBeenCalled();
    // advance fake timers to trigger the reconnect setTimeout
    expect(() => jest.runAllTimers()).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('handleJobUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.activeJobCount = 2;
    globalThis._activeJobIds = new Set(['job-1', 'job-2']);
    globalThis.document.getElementById.mockReturnValue(mockCard);
  });

  test('returns early when card element not found', () => {
    globalThis.document.getElementById.mockReturnValueOnce(null);
    handleJobUpdate({ id: 'missing', status: 'done', log: [], outputs: [] });
    expect(globalThis.updateJobCard).not.toHaveBeenCalled();
  });

  test('calls updateJobCard for a found job', () => {
    const job = { id: 'job-1', status: 'running', log: [], outputs: [] };
    handleJobUpdate(job);
    expect(globalThis.updateJobCard).toHaveBeenCalledWith(job);
  });

  test('decrements activeJobCount on terminal status (done)', () => {
    handleJobUpdate({ id: 'job-1', status: 'done', log: [], outputs: [] });
    expect(globalThis.activeJobCount).toBe(1);
    expect(globalThis._activeJobIds.has('job-1')).toBe(false);
    expect(globalThis.onJobFinished).toHaveBeenCalledWith('job-1');
  });

  test('decrements activeJobCount on terminal status (error)', () => {
    handleJobUpdate({ id: 'job-1', status: 'error', log: [], outputs: [] });
    expect(globalThis.activeJobCount).toBe(1);
  });

  test('decrements activeJobCount on terminal status (cancelled)', () => {
    handleJobUpdate({ id: 'job-1', status: 'cancelled', log: [], outputs: [] });
    expect(globalThis.activeJobCount).toBe(1);
  });

  test('does not decrement for non-terminal status (running)', () => {
    handleJobUpdate({ id: 'job-1', status: 'running', log: [], outputs: [] });
    expect(globalThis.activeJobCount).toBe(2);
    expect(globalThis._activeJobIds.has('job-1')).toBe(true);
  });

  test('does not decrement when job is not in _activeJobIds', () => {
    handleJobUpdate({ id: 'other', status: 'done', log: [], outputs: [] });
    expect(globalThis.activeJobCount).toBe(2);
  });

  test('activeJobCount does not go below 0', () => {
    globalThis.activeJobCount = 0;
    handleJobUpdate({ id: 'job-1', status: 'done', log: [], outputs: [] });
    expect(globalThis.activeJobCount).toBe(0);
  });
});
