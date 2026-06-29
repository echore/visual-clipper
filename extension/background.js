// background.js — Obsidian Visual Clipper service worker (thin router)
import * as screenshot from './modes/screenshot.js';
import * as hook from './modes/hook.js';
import * as keyframe from './modes/keyframe.js';
import * as thumbnail from './modes/thumbnail.js';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

// Holding this port (and its periodic pings) keeps the worker alive while a
// capture/picker is in progress, so its message port can't close mid-flow.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sc-keepalive') port.onMessage.addListener(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;

  switch (msg.action) {
    case 'startCapture':
      screenshot.start(msg.tabId, msg.windowId);
      break;
    case 'regionSelected':
      if (tabId) screenshot.handleRegion(msg, tabId);
      break;
    case 'startHook':
      hook.start(msg.tabId);
      break;
    case 'startKeyframe':
      keyframe.start(msg.tabId);
      break;
    case 'markOut':
      keyframe.markOut(msg.tabId, msg.currentTime, msg.inTime, msg.url, msg.title, msg.platform, msg.videoTitle, msg.channel)
        .catch(err => console.error('[OVC] markOut failed:', err));
      break;
    case 'analyzeBatch':
      screenshot.analyzeBatch(msg.queue);
      break;
    case 'saveThumbnail':
      thumbnail.start(msg.tabId);
      break;
  }
});
