'use strict';

/**
 * Jest transform for compiled global scripts in static/.
 * Appends module.exports so that require() can load them and jest can
 * instrument the code for coverage. Top-level function declarations are
 * collected by scanning the source text.
 */
module.exports = {
  process(sourceText) {
    const names = [];
    for (const [, name] of sourceText.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)) {
      names.push(name);
    }
    const suffix = names.length > 0 ? `\nmodule.exports = { ${names.join(', ')} };\n` : '';
    return { code: sourceText + suffix };
  },
};
