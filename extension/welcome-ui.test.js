import fs from 'node:fs';
import { normalizeDestination, applyDestinationView } from './welcome-ui.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const en = JSON.parse(read('./_locales/en/messages.json'));
const zh = JSON.parse(read('./_locales/zh_CN/messages.json'));

describe('destination view state', () => {
  test('normalizes every value except notion to obsidian', () => {
    expect(normalizeDestination('notion')).toBe('notion');
    expect(normalizeDestination('obsidian')).toBe('obsidian');
    expect(normalizeDestination(undefined)).toBe('obsidian');
  });

  test('writes normalized destination to the document root', () => {
    const root = { documentElement: { dataset: {} } };
    expect(applyDestinationView(root, 'notion')).toBe('notion');
    expect(root.documentElement.dataset.destination).toBe('notion');
    expect(applyDestinationView(root, 'bad-value')).toBe('obsidian');
    expect(root.documentElement.dataset.destination).toBe('obsidian');
  });
});

describe('Visual Clipper product identity', () => {
  test.each([en, zh])('uses the product name on localized surfaces', (catalog) => {
    expect(catalog.ext_name.message).toBe('Visual Clipper');
    expect(catalog.welcome_tab_title.message).toContain('Visual Clipper');
    expect(catalog.err_title.message).toContain('Visual Clipper');
    expect(catalog.ext_desc.message).toMatch(/Notion/i);
  });

  test('visible popup and welcome headings are localized', () => {
    expect(read('./popup.html')).toContain('<h1 data-i18n="ext_name"></h1>');
    expect(read('./welcome.html')).toContain('<h1 data-i18n="ext_name"></h1>');
  });
});

describe('detailed destination-aware Welcome content', () => {
  const html = read('./welcome.html');
  const notionMessages = (catalog) => Object.entries(catalog)
    .filter(([key]) => key.startsWith('welcome_notion_'))
    .map(([, value]) => value.message)
    .join('\n');

  test('packages the complete three-stage Notion workflow', () => {
    expect(html).toContain('https://www.notion.so/profile/integrations');
    expect(html).toContain('data-i18n="welcome_notion_stage1_title"');
    expect(html).toContain('data-i18n="welcome_notion_stage2_title"');
    expect(html).toContain('data-i18n="welcome_notion_stage3_title"');
    expect(html).toContain('guide/notion-create-connection.png');
    expect(html).toContain('guide/notion-create-connection-dialog.png');
    expect(html).toContain('guide/notion-copy-token.png');
    expect(html).toContain('guide/notion-connect-template.png');
    expect(html).toContain('id="notion-token"');
    expect(html).toContain('id="notion-parent"');
    expect(html).toContain('id="btn-notion-save"');
  });

  test('uses the exact locale-specific template URLs', () => {
    expect(en.welcome_notion_tpl_url.message).toBe('https://fifree.notion.site/39d942e6a592804fa800fbd2cad47162?v=39d942e6a59280f99050000c23d10303&source=copy_link');
    expect(zh.welcome_notion_tpl_url.message).toBe('https://fifree.notion.site/39d942e6a59280459785f6bba9073209?v=39d942e6a592812b8a42000ce890d8ea&source=copy_link');
  });

  test.each([en, zh])('Notion-specific copy excludes Obsidian-only concepts', (catalog) => {
    expect(notionMessages(catalog)).not.toMatch(/Obsidian|vault-autopilot|localhost|17183/i);
  });

  test('declares both full destination views', () => {
    expect(html).toContain('id="obsidian-content" data-dest-only="obsidian"');
    expect(html).toContain('id="notion-content" data-dest-only="notion"');
    expect(html).toContain('id="try-it"');
  });

  test.each([en, zh])('has a destination-specific Notion checking state', (catalog) => {
    expect(catalog.welcome_conn_checking_notion.message).toMatch(/Notion/i);
  });
});
