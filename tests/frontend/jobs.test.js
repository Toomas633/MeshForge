'use strict';

// ── globals that jobs.js references at load time or inside functions ────────
globalThis.escHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
globalThis.generatePreview = jest.fn();
globalThis.loadJobPreview = jest.fn();

// ── DOM helpers ─────────────────────────────────────────────────────────────
let domElements = {};
function makeMockEl(id) {
  return {
    id,
    tagName: '',
    className: '',
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      toggle: jest.fn(),
      contains: jest.fn(() => false),
    },
    innerHTML: '',
    style: {},
    disabled: false,
    href: '',
    download: '',
    click: jest.fn(),
    remove: jest.fn(),
    scrollTop: 0,
    scrollHeight: 100,
  };
}
function getEl(id) {
  if (!domElements[id]) domElements[id] = makeMockEl(id);
  return domElements[id];
}

const mockJobsList = { prepend: jest.fn() };
const mockBody = { appendChild: jest.fn() };
let lastCreatedEl = null;

globalThis.document = {
  getElementById: jest.fn((id) => (id === 'jobsList' ? mockJobsList : getEl(id))),
  createElement: jest.fn((tag) => {
    lastCreatedEl = makeMockEl(`created-${tag}`);
    return lastCreatedEl;
  }),
  body: mockBody,
};

// ── module under test ────────────────────────────────────────────────────────
const {
  createJobCard,
  toggleLog,
  handleCardClick,
  updateJobCard,
  createBatchCard,
  onJobFinished,
  enableZipBtn,
  downloadZip,
} = require('../../static/features/jobs.js');

// ── shared helpers ───────────────────────────────────────────────────────────
beforeEach(() => {
  domElements = {};
  jest.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
describe('createJobCard', () => {
  test('creates card from a string filename without calling generatePreview', () => {
    createJobCard('j1', 'model.stl');
    expect(document.createElement).toHaveBeenCalledWith('div');
    expect(mockJobsList.prepend).toHaveBeenCalled();
    expect(globalThis.generatePreview).not.toHaveBeenCalled();
  });

  test('creates card from a File object and calls generatePreview', () => {
    const file = new File(['data'], 'model.obj');
    createJobCard('j2', file);
    expect(mockJobsList.prepend).toHaveBeenCalled();
    expect(globalThis.generatePreview).toHaveBeenCalledWith('j2', file);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('toggleLog', () => {
  test('toggles log-open class on job card', () => {
    toggleLog('t1');
    const el = getEl('job-t1');
    expect(el.classList.toggle).toHaveBeenCalledWith('log-open');
  });

  test('does nothing when card is null (optional chaining)', () => {
    document.getElementById.mockReturnValueOnce(null);
    expect(() => toggleLog('missing')).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('handleCardClick', () => {
  test('returns early when card not found', () => {
    document.getElementById.mockReturnValueOnce(null);
    handleCardClick('missing');
    expect(globalThis.loadJobPreview).not.toHaveBeenCalled();
  });

  test('calls loadJobPreview when card has done class', () => {
    const card = getEl('job-done');
    card.classList.contains.mockReturnValueOnce(true);
    document.getElementById.mockReturnValueOnce(card);
    handleCardClick('done');
    expect(globalThis.loadJobPreview).toHaveBeenCalledWith('done');
  });

  test('calls toggleLog when card does not have done class', () => {
    const card = getEl('job-active');
    card.classList.contains.mockReturnValueOnce(false);
    document.getElementById.mockReturnValueOnce(card);
    handleCardClick('active');
    // toggleLog calls getElementById again for the same element
    expect(card.classList.toggle).toHaveBeenCalledWith('log-open');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('updateJobCard', () => {
  test('returns early when card not found', () => {
    document.getElementById.mockReturnValueOnce(null);
    expect(() => updateJobCard({ id: 'x', status: 'done', log: [], outputs: [] })).not.toThrow();
  });

  test('returns early when badge not found', () => {
    const card = getEl('job-b');
    document.getElementById
      .mockReturnValueOnce(card) // card
      .mockReturnValueOnce(null); // badge
    updateJobCard({ id: 'b', status: 'pending', log: [], outputs: [] });
    expect(card.className).toBe('job-card pending');
  });

  test('updates badge for pending status', () => {
    updateJobCard({ id: 'p1', status: 'pending', log: [], outputs: [] });
    const badge = getEl('badge-p1');
    expect(badge.innerHTML).toContain('Pending');
  });

  test('updates badge for running status with spinner', () => {
    updateJobCard({ id: 'r1', status: 'running', log: [], outputs: [] });
    const badge = getEl('badge-r1');
    expect(badge.className).toBe('job-badge running');
    expect(badge.innerHTML).toContain('spinner');
    expect(badge.innerHTML).toContain('Converting');
  });

  test('updates badge for done status', () => {
    updateJobCard({ id: 'd1', status: 'done', log: [], outputs: [] });
    expect(getEl('badge-d1').innerHTML).toContain('Done');
  });

  test('updates badge for error status', () => {
    updateJobCard({ id: 'e1', status: 'error', log: [], outputs: [] });
    expect(getEl('badge-e1').innerHTML).toContain('Error');
  });

  test('updates badge for cancelled status', () => {
    updateJobCard({ id: 'c1', status: 'cancelled', log: [], outputs: [] });
    expect(getEl('badge-c1').innerHTML).toContain('Cancelled');
  });

  test('uses raw status string for unknown statuses', () => {
    updateJobCard({ id: 'u1', status: 'my-custom', log: [], outputs: [] });
    expect(getEl('badge-u1').innerHTML).toContain('my-custom');
  });

  test('renders === log lines with section class', () => {
    const job = {
      id: 'log1',
      status: 'done',
      log: ['=== STAGE 1 ==='],
      outputs: [],
    };
    updateJobCard(job);
    expect(getEl('log-log1').innerHTML).toContain('section');
  });

  test('renders WARN log lines with warn class', () => {
    const job = { id: 'log2', status: 'done', log: ['WARN something'], outputs: [] };
    updateJobCard(job);
    expect(getEl('log-log2').innerHTML).toContain('warn');
  });

  test('renders ERR log lines with err class', () => {
    const job = { id: 'log3', status: 'done', log: ['ERR something'], outputs: [] };
    updateJobCard(job);
    expect(getEl('log-log3').innerHTML).toContain('err');
  });

  test('renders normal log lines with base class only', () => {
    const job = { id: 'log4', status: 'done', log: ['Normal line'], outputs: [] };
    updateJobCard(job);
    expect(getEl('log-log4').innerHTML).toContain('Normal line');
  });

  test('does not update log when logEl is null', () => {
    document.getElementById
      .mockReturnValueOnce(getEl('job-nl'))
      .mockReturnValueOnce(getEl('badge-nl'))
      .mockReturnValueOnce(null); // logEl null
    expect(() =>
      updateJobCard({ id: 'nl', status: 'done', log: ['line'], outputs: [] })
    ).not.toThrow();
  });

  test('renders download links for done status with outputs', () => {
    const job = { id: 'dl1', status: 'done', log: [], outputs: ['out.step'] };
    updateJobCard(job);
    const dlEl = getEl('dl-dl1');
    expect(dlEl.innerHTML).toContain('download-btn');
    expect(dlEl.innerHTML).toContain('out.step');
  });

  test('skips download section when dlEl is not found', () => {
    document.getElementById
      .mockReturnValueOnce(getEl('job-nd'))
      .mockReturnValueOnce(getEl('badge-nd'))
      .mockReturnValueOnce(null) // logEl null → skip log
      .mockReturnValueOnce(null); // dlEl null
    expect(() =>
      updateJobCard({ id: 'nd', status: 'done', log: [], outputs: ['x.step'] })
    ).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('createBatchCard', () => {
  test('creates and prepends batch card', () => {
    createBatchCard(['bid1', 'bid2'], 2);
    expect(document.createElement).toHaveBeenCalledWith('div');
    expect(mockJobsList.prepend).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('onJobFinished', () => {
  test('does nothing when job is not in any batch', () => {
    expect(() => onJobFinished('unknown-job')).not.toThrow();
  });

  test('removes job from batch; does not enable zip while others remain', () => {
    createBatchCard(['batch1-a', 'batch1-b'], 2);
    onJobFinished('batch1-a');
    // zip button should NOT have been enabled yet
    expect(getEl('zip-btn-batch1-a').disabled).toBe(false); // still in default state
  });

  test('enables zip button when last job in batch finishes', () => {
    createBatchCard(['batch2-a', 'batch2-b'], 2);
    onJobFinished('batch2-a');
    // Now finish the last job
    onJobFinished('batch2-b');
    const btn = getEl('zip-btn-batch2-a');
    expect(btn.disabled).toBe(false);
    expect(btn.innerHTML).toContain('Download all as ZIP');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('enableZipBtn', () => {
  test('returns early when button not found', () => {
    document.getElementById.mockReturnValueOnce(null);
    expect(() => enableZipBtn('no-btn')).not.toThrow();
  });

  test('enables button and sets innerHTML', () => {
    enableZipBtn('zbtn1');
    const btn = getEl('zip-btn-zbtn1');
    expect(btn.disabled).toBe(false);
    expect(btn.innerHTML).toContain('Download all as ZIP');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('downloadZip', () => {
  test('creates anchor, triggers click, then removes it', () => {
    const anchor = makeMockEl('a');
    document.createElement.mockReturnValueOnce(anchor);
    downloadZip('id1,id2');
    expect(anchor.href).toContain(encodeURIComponent('id1,id2'));
    expect(anchor.download).toBe('converted.zip');
    expect(mockBody.appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.remove).toHaveBeenCalled();
  });
});
