'use strict';

const { fmtSize, escHtml } = require('../../static/utils/utils.js');

// ---------------------------------------------------------------------------
// fmtSize
// ---------------------------------------------------------------------------

describe('fmtSize', () => {
  test('bytes — exact', () => expect(fmtSize(0)).toBe('0 B'));
  test('bytes — upper boundary', () => expect(fmtSize(1023)).toBe('1023 B'));
  test('kilobytes — exact 1 KB', () => expect(fmtSize(1024)).toBe('1.0 KB'));
  test('kilobytes — 1.5 KB', () => expect(fmtSize(1536)).toBe('1.5 KB'));
  test('kilobytes — upper boundary', () => expect(fmtSize(1048575)).toBe('1024.0 KB'));
  test('megabytes — exact 1 MB', () => expect(fmtSize(1048576)).toBe('1.0 MB'));
  test('megabytes — 2.5 MB', () => expect(fmtSize(2621440)).toBe('2.5 MB'));
});

// ---------------------------------------------------------------------------
// escHtml
// ---------------------------------------------------------------------------

describe('escHtml', () => {
  test('ampersand', () => expect(escHtml('a&b')).toBe('a&amp;b'));
  test('less-than', () => expect(escHtml('<tag>')).toBe('&lt;tag&gt;'));
  test('greater-than', () => expect(escHtml('a>b')).toBe('a&gt;b'));
  test('double quote', () => expect(escHtml('"hello"')).toBe('&quot;hello&quot;'));
  test('multiple escapes in one string', () =>
    expect(escHtml('<a href="x&y">text</a>')).toBe(
      '&lt;a href=&quot;x&amp;y&quot;&gt;text&lt;/a&gt;'
    ));
  test('no special chars — unchanged', () => expect(escHtml('hello world')).toBe('hello world'));
  test('empty string', () => expect(escHtml('')).toBe(''));
  test('coerces non-string input', () => expect(escHtml(42)).toBe('42'));
});
