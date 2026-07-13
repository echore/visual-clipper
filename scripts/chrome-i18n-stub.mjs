// Node-side chrome.i18n.getMessage backed by a real messages.json — so tests
// assert the actual shipped English copy, not made-up strings.
import { readFileSync } from 'node:fs';

export function makeGetMessage(messagesJsonPath) {
  const catalog = JSON.parse(readFileSync(messagesJsonPath, 'utf8'));
  return function getMessage(key, subs = []) {
    const entry = catalog[key];
    if (!entry) return '';
    let msg = entry.message;
    const arr = Array.isArray(subs) ? subs : [subs];
    for (const [name, spec] of Object.entries(entry.placeholders || {})) {
      const idx = parseInt(spec.content.slice(1), 10) - 1;
      msg = msg.replaceAll(`$${name.toUpperCase()}$`, String(arr[idx] ?? ''));
    }
    return msg;
  };
}
