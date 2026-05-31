// background.js — Obsidian Visual Clipper service worker (thin router)
import * as screenshot from './modes/screenshot.js';
import * as hook from './modes/hook.js';
import * as keyframe from './modes/keyframe.js';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
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
  }
});
