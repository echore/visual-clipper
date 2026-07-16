export function normalizeDestination(value) {
  return value === 'notion' ? 'notion' : 'obsidian';
}

export function applyDestinationView(root, value) {
  const destination = normalizeDestination(value);
  root.documentElement.dataset.destination = destination;
  return destination;
}

// Which guidance block the Obsidian connection card shows. The extension can
// only probe the port; "not installed" vs "Obsidian closed" is decided by the
// user's own answer (choice) or by remembered past success (everConnected).
export function resolveConnView({ connected, everConnected, choice }) {
  if (connected) return 'green';
  if (choice === 'install' || choice === 'troubleshoot') return choice;
  return everConnected ? 'troubleshoot' : 'triage';
}
