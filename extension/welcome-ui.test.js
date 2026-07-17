import fs from 'node:fs';
import { normalizeDestination, applyDestinationView, resolveConnView } from './welcome-ui.js';

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
    expect(html).toContain('href="https://www.notion.so/profile/integrations"');
    expect(html).toContain('data-i18n="welcome_notion_s1_link"');
    expect(html).not.toContain('<code>https://www.notion.so/profile/integrations</code>');
    expect(html).not.toContain('class="url-copy"');
    expect(html).not.toContain('data-i18n="welcome_notion_s2_alt"');
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

  test('gives direct bilingual instructions for the provided template and its page link', () => {
    expect(en.welcome_notion_stage2_outcome.message).toBe('We have prepared a ready-to-use Notion template for you. Click the button below to copy it to your Notion.');
    expect(zh.welcome_notion_stage2_outcome.message).toBe('我们已经为你准备好了可以直接使用的 Notion 模板。点击下方按钮，把它复制到你的 Notion。');
    expect(en.welcome_notion_parent_label.message).toBe('Notion template page link');
    expect(zh.welcome_notion_parent_label.message).toBe('Notion 模板页面链接');
    expect(en.welcome_notion_parent_helper.message).toBe("Open the template you just copied, copy the link from your browser's address bar, and paste it here.");
    expect(zh.welcome_notion_parent_helper.message).toBe('打开刚刚复制的模板页面，复制浏览器地址栏中的链接，然后粘贴到这里。');
  });

  test.each([en, zh])('uses plain-language Notion setup copy', (catalog) => {
    expect(notionMessages(catalog)).not.toMatch(/compatible database|plain page|Video Clips|兼容数据库|普通页面/i);
  });

  test('renders exactly three plain-language save outcomes', () => {
    expect(html).toContain('data-i18n="welcome_notion_storage_fact1"');
    expect(html).toContain('data-i18n="welcome_notion_storage_fact2"');
    expect(html).toContain('data-i18n="welcome_notion_storage_fact3"');
    expect(html).not.toContain('data-i18n="welcome_notion_storage_fact4"');
    expect(html).not.toContain('data-i18n="welcome_notion_storage_fact5"');
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

describe('resolveConnView', () => {
  test('connected always wins', () => {
    expect(resolveConnView({ connected: true, everConnected: false, choice: undefined })).toBe('green');
    expect(resolveConnView({ connected: true, everConnected: true, choice: 'install' })).toBe('green');
  });
  test('explicit user choice is honored when disconnected', () => {
    expect(resolveConnView({ connected: false, everConnected: true, choice: 'install' })).toBe('install');
    expect(resolveConnView({ connected: false, everConnected: false, choice: 'troubleshoot' })).toBe('troubleshoot');
  });
  test('past success without a choice means troubleshoot, not install', () => {
    expect(resolveConnView({ connected: false, everConnected: true, choice: undefined })).toBe('troubleshoot');
  });
  test('never connected and no choice asks the triage question', () => {
    expect(resolveConnView({ connected: false, everConnected: false, choice: undefined })).toBe('triage');
  });
  test('garbage choice values fall back to memory-based routing', () => {
    expect(resolveConnView({ connected: false, everConnected: false, choice: 'bogus' })).toBe('triage');
  });
});

describe('Obsidian triage markup and copy', () => {
  const html = read('./welcome.html');
  test('declares triage and troubleshoot blocks inside the Obsidian view', () => {
    expect(html).toContain('id="setup-triage"');
    expect(html).toContain('id="troubleshoot-guide"');
    expect(html).toContain('id="btn-triage-first"');
    expect(html).toContain('id="btn-triage-installed"');
    expect(html).toContain('id="btn-open-obsidian"');
    expect(html).toContain('id="lnk-show-install"');
    expect(html).toContain('id="lnk-show-trouble"');
  });
  test('triage and troubleshoot copy exists in both locales', () => {
    for (const cat of [en, zh]) {
      for (const k of ['welcome_triage_q', 'welcome_triage_first', 'welcome_triage_installed',
        'welcome_trouble_title', 'welcome_trouble_known', 'welcome_trouble_s1',
        'welcome_trouble_s2_html', 'welcome_trouble_s3', 'welcome_open_obsidian',
        'welcome_trouble_to_install', 'welcome_install_to_trouble', 'welcome_conn_waiting']) {
        expect({ key: k, present: typeof cat[k]?.message === 'string' && cat[k].message.length > 0 })
          .toEqual({ key: k, present: true });
      }
    }
  });
  test('the cramped ①②③ detail line is retired', () => {
    expect(en.welcome_conn_bad_detail).toBeUndefined();
    expect(zh.welcome_conn_bad_detail).toBeUndefined();
  });
});
