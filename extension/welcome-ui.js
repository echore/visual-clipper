export function normalizeDestination(value) {
  return value === 'notion' ? 'notion' : 'obsidian';
}

export function applyDestinationView(root, value) {
  const destination = normalizeDestination(value);
  root.documentElement.dataset.destination = destination;
  return destination;
}
