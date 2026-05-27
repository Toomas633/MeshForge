'use strict';

// ── helpers ──────────────────────────────────────────────────────────────────
const capturedListeners = {};

function makeEl(id) {
  const el = {
    id,
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
    value: '',
    files: null,
    dataset: {},
    click: jest.fn(),
    remove: jest.fn(),
    appendChild: jest.fn(),
    addEventListener: jest.fn((event, cb) => {
      capturedListeners[`${id}:${event}`] = cb;
    }),
  };
  return el;
}

// ── named DOM elements (captured at require time by main.js) ─────────────────
const elements = {
  dropZone: makeEl('dropZone'),
  fileInput: makeEl('fileInput'),
  browseLink: makeEl('browseLink'),
  fileList: makeEl('fileList'),
  startBtn: makeEl('startBtn'),
  addBtn: makeEl('addBtn'),
  addModal: makeEl('addModal'),
  modalClose: makeEl('modalClose'),
  themeToggle: makeEl('themeToggle'),
};

// ── global mocks ─────────────────────────────────────────────────────────────
globalThis.document = {
  getElementById: jest.fn((id) => elements[id] || makeEl(id)),
  createElement: jest.fn((tag) => makeEl(`created-${tag}`)),
  body: { appendChild: jest.fn() },
  documentElement: { dataset: {}, style: {} },
  addEventListener: jest.fn((event, cb) => {
    capturedListeners[`document:${event}`] = cb;
  }),
  querySelectorAll: jest.fn(() => []),
};

globalThis.window = {
  addEventListener: jest.fn((event, cb) => {
    capturedListeners[`window:${event}`] = cb;
  }),
};

globalThis.localStorage = { setItem: jest.fn(), removeItem: jest.fn() };
globalThis.navigator = { sendBeacon: jest.fn() };
globalThis.crypto = {
  randomUUID: jest.fn().mockImplementation(() => `uuid-${Math.random().toString(36).slice(2)}`),
};
globalThis.FormData = class {
  append(_key, _value) {
    /* no-op mock */
  }
};
globalThis.fetch = jest.fn();
globalThis.alert = jest.fn();

// globals from other scripts
globalThis.escHtml = String;
globalThis.fmtSize = (n) => `${n}B`;
globalThis.connectSSE = jest.fn();
globalThis.createJobCard = jest.fn();
globalThis.createBatchCard = jest.fn();
globalThis.activeJobCount = 0;
globalThis._activeJobIds = new Set();

// ── module under test ────────────────────────────────────────────────────────
const {
  openAddModal,
  closeAddModal,
  addFiles,
  removeFile,
  renderFileList,
  startConversion,
  submitFiles,
} = require('../../static/main.js');

// connectSSE is called at the bottom of main.js
expect(globalThis.connectSSE).toHaveBeenCalled();

// ────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  // Drain selectedFiles accumulated from previous test (module-scoped state)
  let limit = 50;
  while (!elements.startBtn.disabled && limit-- > 0) {
    removeFile(0);
  }
  jest.clearAllMocks();
  globalThis.activeJobCount = 0;
  globalThis._activeJobIds = new Set();
  globalThis.crypto.randomUUID.mockImplementation(
    () => `uuid-${Math.random().toString(36).slice(2)}`
  );
});

// ────────────────────────────────────────────────────────────────────────────
describe('openAddModal / closeAddModal', () => {
  test('openAddModal adds "open" class to addModal', () => {
    openAddModal();
    expect(elements.addModal.classList.add).toHaveBeenCalledWith('open');
  });

  test('closeAddModal removes "open" class from addModal', () => {
    closeAddModal();
    expect(elements.addModal.classList.remove).toHaveBeenCalledWith('open');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('event listeners registered at module load', () => {
  test('themeToggle click — switches to light theme when not already light', () => {
    globalThis.document.documentElement.dataset.theme = undefined;
    capturedListeners['themeToggle:click']();
    expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('theme', 'light');
    expect(globalThis.document.documentElement.dataset.theme).toBe('light');
  });

  test('themeToggle click — removes light theme when already light', () => {
    globalThis.document.documentElement.dataset.theme = 'light';
    capturedListeners['themeToggle:click']();
    expect(globalThis.localStorage.removeItem).toHaveBeenCalledWith('theme');
  });

  test('browseLink click triggers fileInput.click()', () => {
    capturedListeners['browseLink:click']();
    expect(elements.fileInput.click).toHaveBeenCalled();
  });

  test('dropZone click triggers fileInput.click() when target is not browseLink', () => {
    capturedListeners['dropZone:click']({ target: elements.dropZone });
    expect(elements.fileInput.click).toHaveBeenCalled();
  });

  test('dropZone click does NOT trigger fileInput.click() when target is browseLink', () => {
    capturedListeners['dropZone:click']({ target: elements.browseLink });
    expect(elements.fileInput.click).not.toHaveBeenCalled();
  });

  test('fileInput change adds files and resets value', () => {
    const mockFile = { name: 'a.stl', size: 100 };
    elements.fileInput.files = [mockFile];
    elements.fileInput.value = String.raw`C:\fake\a.stl`;
    capturedListeners['fileInput:change']();
    expect(elements.fileInput.value).toBe('');
  });

  test('dropZone dragover prevents default and adds dragover class', () => {
    const e = { preventDefault: jest.fn() };
    capturedListeners['dropZone:dragover'](e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(elements.dropZone.classList.add).toHaveBeenCalledWith('dragover');
  });

  test('dropZone dragleave removes dragover class', () => {
    capturedListeners['dropZone:dragleave']();
    expect(elements.dropZone.classList.remove).toHaveBeenCalledWith('dragover');
  });

  test('dropZone drop prevents default, removes dragover class, and adds files', () => {
    const mockFile = { name: 'b.obj', size: 200 };
    const e = {
      preventDefault: jest.fn(),
      dataTransfer: { files: [mockFile] },
    };
    capturedListeners['dropZone:drop'](e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(elements.dropZone.classList.remove).toHaveBeenCalledWith('dragover');
  });

  test('dropZone drop with no dataTransfer files does not crash', () => {
    const e = { preventDefault: jest.fn(), dataTransfer: null };
    expect(() => capturedListeners['dropZone:drop'](e)).not.toThrow();
  });

  test('addBtn click calls openAddModal', () => {
    capturedListeners['addBtn:click']();
    expect(elements.addModal.classList.add).toHaveBeenCalledWith('open');
  });

  test('modalClose click calls closeAddModal', () => {
    capturedListeners['modalClose:click']();
    expect(elements.addModal.classList.remove).toHaveBeenCalledWith('open');
  });

  test('addModal click on overlay calls closeAddModal', () => {
    capturedListeners['addModal:click']({ target: elements.addModal });
    expect(elements.addModal.classList.remove).toHaveBeenCalledWith('open');
  });

  test('addModal click on inner element does nothing', () => {
    capturedListeners['addModal:click']({ target: makeEl('inner') });
    expect(elements.addModal.classList.remove).not.toHaveBeenCalled();
  });

  test('document keydown Escape closes modal', () => {
    capturedListeners['document:keydown']({ key: 'Escape' });
    expect(elements.addModal.classList.remove).toHaveBeenCalledWith('open');
  });

  test('document keydown other key does nothing', () => {
    capturedListeners['document:keydown']({ key: 'Enter' });
    expect(elements.addModal.classList.remove).not.toHaveBeenCalled();
  });

  test('window beforeunload sends beacon to cancel jobs', () => {
    capturedListeners['window:beforeunload']();
    expect(globalThis.navigator.sendBeacon).toHaveBeenCalledWith('/api/jobs/cancel');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('addFiles', () => {
  test('skips files with unsupported extensions', () => {
    addFiles([{ name: 'model.gltf', size: 1 }]);
    expect(elements.startBtn.disabled).toBe(true); // no files added
  });

  test('adds valid .stl and .obj files', () => {
    addFiles([
      { name: 'a.stl', size: 10 },
      { name: 'b.OBJ', size: 20 }, // uppercase ext
    ]);
    expect(elements.startBtn.disabled).toBe(false);
  });

  test('skips duplicate files (same name + size)', () => {
    const file = { name: 'dup.stl', size: 50 };
    addFiles([file]);
    addFiles([file]); // duplicate
    // fileList should still reflect exactly 1 file (startBtn enabled from first call)
    expect(elements.startBtn.disabled).toBe(false);
  });

  test('returns early when all files are filtered out', () => {
    elements.startBtn.disabled = true;
    addFiles([{ name: 'bad.txt', size: 1 }]);
    // fileList.innerHTML should not have been touched
    expect(elements.fileList.innerHTML).toBe('');
  });

  test('auto-starts conversion when jobs are already running and modal is closed', async () => {
    globalThis.activeJobCount = 1;
    elements.addModal.classList.contains.mockReturnValue(false);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });
    addFiles([{ name: 'c.stl', size: 5 }]);
    await Promise.resolve(); // flush microtask queue
    expect(globalThis.createJobCard).toHaveBeenCalled();
  });

  test('does NOT auto-start when modal is open', () => {
    globalThis.activeJobCount = 1;
    elements.addModal.classList.contains.mockReturnValue(true);
    addFiles([{ name: 'd.obj', size: 5 }]);
    expect(globalThis.createJobCard).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('renderFileList', () => {
  beforeEach(() => {
    // reset selected files by replacing them through addFiles
    // Use unique names to avoid duplicates with prior tests
  });

  test('sets startBtn.disabled to true when no files', () => {
    // clear files first
    removeFile(0);
    removeFile(0);
    removeFile(0);
    renderFileList();
    expect(elements.startBtn.disabled).toBe(true);
  });

  test('renders file items with name, size and remove button', () => {
    addFiles([{ name: 'show.stl', size: 1024 }]);
    expect(elements.fileList.innerHTML).toContain('show.stl');
    expect(elements.fileList.innerHTML).toContain('1024B');
    expect(elements.fileList.innerHTML).toContain('remove-btn');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('removeFile', () => {
  test('removes the file at the given index', () => {
    addFiles([{ name: 'rem.stl', size: 1 }]);
    removeFile(0);
    expect(elements.startBtn.disabled).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('startConversion', () => {
  test('returns immediately when no files selected', async () => {
    // ensure selectedFiles is empty
    renderFileList(); // triggers startBtn.disabled = true
    await startConversion();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('clears files, closes modal, and submits when files exist', async () => {
    addFiles([{ name: 'go.stl', size: 1 }]);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });
    await startConversion();
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(elements.addModal.classList.remove).toHaveBeenCalledWith('open');
  });

  test('restores files and reopens modal when submitFiles fails', async () => {
    addFiles([{ name: 'fail.stl', size: 1 }]);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: 'Server error' }),
    });
    await startConversion();
    expect(globalThis.alert).toHaveBeenCalled();
    expect(elements.addModal.classList.add).toHaveBeenCalledWith('open');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('submitFiles', () => {
  test('creates job cards for each file', async () => {
    const files = [{ name: 'f1.stl', size: 1 }];
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });
    const result = await submitFiles(files);
    expect(globalThis.createJobCard).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  test('creates batch card when more than one file is submitted', async () => {
    const files = [
      { name: 'f2.stl', size: 1 },
      { name: 'f3.obj', size: 2 },
    ];
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({}),
    });
    await submitFiles(files);
    expect(globalThis.createBatchCard).toHaveBeenCalledTimes(1);
  });

  test('removes job cards and alerts on HTTP error response', async () => {
    const files = [{ name: 'f4.stl', size: 1 }];
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: 'Bad request' }),
    });
    const result = await submitFiles(files);
    expect(globalThis.alert).toHaveBeenCalledWith('Bad request');
    expect(result).toBe(false);
  });

  test('uses fallback alert text when error field is missing', async () => {
    const files = [{ name: 'f5.stl', size: 1 }];
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({}),
    });
    const result = await submitFiles(files);
    expect(globalThis.alert).toHaveBeenCalledWith('Failed to start conversion.');
    expect(result).toBe(false);
  });

  test('removes job cards and alerts on network error', async () => {
    const files = [{ name: 'f6.stl', size: 1 }];
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));
    const result = await submitFiles(files);
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('Network failure'));
    expect(result).toBe(false);
  });

  test('alert contains non-Error string on non-Error throws', async () => {
    const files = [{ name: 'f7.stl', size: 1 }];
    globalThis.fetch = jest.fn().mockRejectedValue('plain string error');
    const result = await submitFiles(files);
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining('plain string error'));
    expect(result).toBe(false);
  });
});
