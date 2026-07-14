// destinations/index.js — routes captures to the active destination adapter.
// Adding a platform = new sibling file exporting { id, ping, send } + one entry here.
import * as obsidian from './obsidian.js';
import * as notion from './notion.js';

const DESTINATIONS = { obsidian, notion };

export async function getActiveDestination() {
  const { sc_destination } = await chrome.storage.local.get('sc_destination');
  return DESTINATIONS[sc_destination] || DESTINATIONS.obsidian;
}
