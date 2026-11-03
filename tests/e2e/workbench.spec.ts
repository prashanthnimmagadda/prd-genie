import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });

async function showSidebar(page: Page): Promise<boolean> {
  await page.locator('.workbench').first().waitFor();
  const hidden = await sidebar(page).isHidden();
  if (hidden) await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(sidebar(page)).toBeVisible();
  return hidden;
}

async function hideSidebar(page: Page) {
  if (await sidebar(page).isVisible())
    await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await expect(sidebar(page)).toBeHidden();
}

async function expectProject(page: Page, name: string) {
  const wasHidden = await showSidebar(page);
  await expect(
    sidebar(page).getByRole('button', { name: `Project: ${name}. Show project menu` }),
  ).toBeVisible();
  if (wasHidden) await hideSidebar(page);
}

async function selectProject(page: Page, name: string) {
  const wasHidden = await showSidebar(page);
  const trigger = sidebar(page).getByRole('button', { name: /Show project menu$/ });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-label')) !== `Project: ${name}. Show project menu`) {
    await trigger.click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  await expect(
    sidebar(page).getByRole('button', { name: `Project: ${name}. Show project menu` }),
  ).toBeVisible();
  if (wasHidden) await hideSidebar(page);
}

async function openNavigation(page: Page, destination: string) {
  await showSidebar(page);
  await sidebar(page).getByRole('button', { name: destination, exact: true }).click();
}

async function openDocument(page: Page) {
  if (await page.locator('#prd-editor').isHidden()) await openNavigation(page, 'Document');
  await expect(page.locator('#prd-editor')).toBeVisible();
}

async function openConversation(page: Page) {
  if (await page.locator('#conversation-workspace').isHidden())
    await openNavigation(page, 'Conversation');
  await expect(page.locator('#conversation-workspace')).toBeVisible();
}

async function openSettings(page: Page) {
  await openNavigation(page, 'AI settings');
  await expect(page.getByRole('main', { name: 'AI settings', exact: true })).toBeVisible();
}

async function openHistory(page: Page) {
  await openNavigation(page, 'History');
  await expect(page.getByRole('main', { name: 'History', exact: true })).toBeVisible();
}

async function openSources(page: Page) {
  await openNavigation(page, 'Sources');
  await expect(page.getByRole('main', { name: 'Sources', exact: true })).toBeVisible();
}

async function openStructures(page: Page) {
  await openNavigation(page, 'Structures');
  await expect(page.getByRole('main', { name: 'Structures', exact: true })).toBeVisible();
}

async function chooseScope(page: Page, label: string | RegExp) {
  // Wait for any closing menu to finish its exit animation before opening a new one.
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: /^Apply to/ }).click();
  const menu = page.locator('[role="menu"][data-state="open"]');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: label }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

async function configureMockProvider(page: Page) {
  await openSettings(page);
  const settings = page.getByRole('main', { name: 'AI settings', exact: true });
  await settings.getByRole('option', { name: /^OpenAI-compatible endpoint/ }).click();
  await settings.getByLabel('Base URL').fill('http://127.0.0.1:4312/v1');
  await settings.getByLabel('API key (optional)').fill('synthetic-session-key');
  await settings.getByRole('button', { name: 'Check connection' }).click();
  await expect(settings.getByLabel('Model name')).toHaveValue('synthetic-prd-model');
  await settings.getByRole('button', { name: 'Use for this project' }).click();
  await expect(settings.getByRole('button', { name: 'In use for this project' })).toBeVisible();
}

async function exportAs(page: Page, format: RegExp) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('radio', { name: format }).check();
  await sheet.getByRole('button', { name: 'Export…' }).click();
  await expect(sheet).toBeHidden();
}

async function removeSource(page: Page, name: string) {
  await openSources(page);
  await page.getByRole('option', { name: new RegExp(name.replace('.', '\\.')) }).click();
  await page.getByRole('button', { name: 'Remove from project…' }).click();
  const alert = page.getByRole('alertdialog');
  await expect(alert).toContainText(name);
  await alert.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(
    page.getByRole('option', { name: new RegExp(name.replace('.', '\\.')) }),
  ).toHaveCount(0);
}

test('production settings, menus and sheets satisfy CSP and release scroll locks', async ({
  page,
  request,
}) => {
  test.skip(process.env.PRD_GENIE_E2E_PRODUCTION !== '1', 'Requires the production CSP header');
  const violations: string[] = [];
  await page.exposeFunction('recordCspViolation', (directive: string) =>
    violations.push(directive),
  );
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      void (
        window as unknown as { recordCspViolation: (value: string) => Promise<void> }
      ).recordCspViolation(event.violatedDirective);
    });
  });
  const name = `CSP fixture ${crypto.randomUUID()}`;
  const created = await request.post('/api/projects', { data: { name } });
  expect(created.ok()).toBe(true);
  await page.goto('/');
  await selectProject(page, name);
  const sidebarSettings = sidebar(page).getByRole('button', { name: 'AI settings', exact: true });
  await sidebarSettings.focus();
  await page.keyboard.press('Enter');
  const settings = page.getByRole('main', { name: 'AI settings', exact: true });
  await expect(settings).toBeVisible();
  const nonce = await page.locator('meta[name="csp-style-nonce"]').getAttribute('content');
  expect(nonce).toBeTruthy();
  await openConversation(page);
  const composerModel = page.getByRole('button', { name: /Choose model$/ });
  await composerModel.focus();
  await page.keyboard.press('Enter');
  const modelMenu = page.getByRole('menu', { name: /Choose model$/ });
  await expect(modelMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modelMenu).toBeHidden();
  await expect(composerModel).toBeFocused();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exportSheet = page.getByRole('dialog', { name: 'Export', exact: true });
  await expect(exportSheet).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect(page.locator('style[nonce]').first()).toBeAttached();
  expect(
    await page
      .locator('style[nonce]')
      .evaluateAll((styles) =>
        styles.every(
          (style) =>
            (style as HTMLStyleElement).nonce.length > 0 &&
            (style as HTMLStyleElement).sheet !== null,
        ),
      ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(exportSheet).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Action', exact: true })).toHaveCount(0);
  await expect(
    page
      .locator('#conversation-workspace')
      .getByRole('button', { name: 'AI settings', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked');
  expect(violations).toEqual([]);
});

test('creates a project with central conversation and an accessible document workspace', async ({
  page,
  request,
}, testInfo) => {
  await expect
    .poll(async () => (await request.get('/api/health')).status(), { timeout: 10_000 })
    .toBe(200);
  if (process.env.UPDATE_SCREENSHOTS === '1') {
    const existing = await request.get('/api/projects');
    const projects = (await existing.json()) as { projects: Array<{ id: string }> };
    for (const project of projects.projects) {
      await request.delete(`/api/projects/${project.id}`);
    }
  }
  const projectName =
    process.env.UPDATE_SCREENSHOTS === '1'
      ? 'Draft recovery'
      : `Synthetic recovery ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/projects', {
    data: { name: projectName, description: 'Synthetic browser fixture' },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBe(true);
  const createdProject = (await created.json()) as { id: string };
  await page.goto('/');
  await selectProject(page, projectName);
  await expect(page.getByLabel('Your instruction')).toBeVisible();
  await expect(page.locator('#prd-editor')).toBeHidden();
  await openDocument(page);
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Outline' })).toBeVisible();
  await expect(page.getByLabel('Section title').first()).toHaveValue('Problem');

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  const recovery = await request.get(`/api/projects/${createdProject.id}/workspace`);
  expect((await recovery.json()) as { revision: number }).toMatchObject({ revision: 0 });
  if (process.env.UPDATE_SCREENSHOTS === '1' && testInfo.project.name === 'chromium') {
    await page.screenshot({
      path: 'docs/screenshots/workbench.png',
      fullPage: true,
    });
  }
});

test('exports the latest editor text and reopens it locally', async ({
  page,
  request,
}, testInfo) => {
  await expect
    .poll(async () => (await request.get('/api/health')).status(), { timeout: 10_000 })
    .toBe(200);
  const name = `Latest export ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/projects', { data: { name } });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string };
  await page.goto('/');
  await selectProject(page, name);
  await openDocument(page);
  await page.getByLabel('Section content').first().fill('Latest unsaved requirement for the PDF.');
  const download = page.waitForEvent('download');
  await exportAs(page, /^PDF/);
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  const saved = (await (await request.get(`/api/projects/${project.id}/prd`)).json()) as {
    sections: Array<{ body: string }>;
  };
  expect(saved.sections[0]?.body).toContain('Latest unsaved requirement for the PDF.');
  await page.reload();
  await selectProject(page, name);
  await openDocument(page);
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Latest unsaved requirement for the PDF.',
  );
});

test('saves and applies a custom project structure without dropping content', async ({
  page,
  request,
}, testInfo) => {
  await expect
    .poll(async () => (await request.get('/api/health')).status(), { timeout: 10_000 })
    .toBe(200);
  const name = `Custom structure ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/projects', { data: { name } });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string };
  await page.goto('/');
  await selectProject(page, name);
  await openDocument(page);
  await page.getByLabel('Section content').first().fill('Keep this confirmed problem.');
  await openStructures(page);
  await page.getByRole('button', { name: 'New structure' }).click();
  await expect(page.getByLabel('Structure name')).toHaveValue(/^Structure \d+$/);
  await page.getByLabel('Structure name').fill('Client brief');
  await page.getByLabel('Section 1 title').fill('Problem');
  await page.getByLabel('Section 1 purpose').fill('State the confirmed issue');
  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByLabel('Section 2 title').fill('Next steps');
  await page.getByLabel('Section 2 purpose').fill('Decisions and owners');
  await expect
    .poll(
      async () => {
        const result = (await (
          await request.get(`/api/projects/${project.id}/structures`)
        ).json()) as {
          structures: Array<{ name: string; sections: Array<{ title: string }> }>;
        };
        return result.structures
          .find((item) => item.name === 'Client brief')
          ?.sections.map((section) => section.title)
          .join('|');
      },
      { timeout: 10_000 },
    )
    .toBe('Problem|Next steps');
  await page.getByRole('button', { name: 'Use for this project…' }).click();
  const alert = page.getByRole('alertdialog');
  await expect(alert).toContainText('Client brief');
  await alert.getByRole('button', { name: 'Use', exact: true }).click();
  await openDocument(page);
  await expect(page.getByRole('list', { name: 'Outline' })).toContainText('Next steps');
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Keep this confirmed problem.',
  );
  await page.reload();
  await selectProject(page, name);
  await openDocument(page);
  await expect(page.getByRole('list', { name: 'Outline' })).toContainText('Next steps');
});

test('isolates provider drafts and discloses active and pending outbound hosts', async ({
  page,
  request,
}, testInfo) => {
  await expect
    .poll(async () => (await request.get('/api/health')).status(), { timeout: 10_000 })
    .toBe(200);
  const projectName = `Provider isolation ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/projects', {
    data: { name: projectName, description: 'Synthetic provider isolation fixture' },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBe(true);

  await page.route('**/api/session/providers', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [
          {
            provider: 'openai',
            credentialSource: 'none',
            configured: false,
            baseUrl: 'api.openai.com',
          },
          {
            provider: 'anthropic',
            credentialSource: 'none',
            configured: false,
            baseUrl: 'api.anthropic.com',
          },
          {
            provider: 'google',
            credentialSource: 'none',
            configured: false,
            baseUrl: 'generativelanguage.googleapis.com',
          },
          {
            provider: 'openai-compatible',
            credentialSource: 'session',
            configured: true,
            baseUrl: 'models.saved.example.test',
          },
          {
            provider: 'ollama',
            credentialSource: 'session',
            configured: true,
            baseUrl: 'ollama.saved.example.test',
          },
        ],
      }),
    }),
  );

  await page.goto('/');
  await selectProject(page, projectName);
  await openSettings(page);
  const settings = page.getByRole('main', { name: 'AI settings', exact: true });
  const pick = (provider: RegExp) => settings.getByRole('option', { name: provider }).click();

  await pick(/^OpenAI-compatible endpoint/);
  await expect(settings.locator('.provider-host').first()).toContainText(
    'models.saved.example.test',
  );
  await settings.getByLabel('API key (optional)').fill('replacement-compatible-key');
  await expect(settings.getByText('Re-enter the full endpoint')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Check connection' })).toBeDisabled();
  await settings.getByLabel('API key (optional)').fill('');
  await settings.getByLabel('Base URL').fill('https://models.example.test/v1');
  await settings.getByLabel('API key (optional)').fill('old-compatible-key');
  if (!(await settings.getByLabel('Optional headers as JSON').isVisible()))
    await settings.getByText('Additional headers', { exact: true }).click();
  await settings.getByLabel('Optional headers as JSON').fill('{"X-Old-Provider":"retained"}');

  await pick(/^Anthropic/);
  await expect(settings.getByLabel('API key', { exact: true })).toHaveValue('');
  await expect(settings.getByLabel('Base URL')).toHaveCount(0);
  await expect(settings.getByLabel('Optional headers as JSON')).toHaveCount(0);

  let anthropicConfiguration: unknown;
  const anthropicKey = ['new', 'anthropic', 'key'].join('-');
  let releaseAnthropicConfiguration: (() => void) | undefined;
  const anthropicConfigurationReleased = new Promise<void>((resolve) => {
    releaseAnthropicConfiguration = resolve;
  });
  await page.route('**/api/session/providers/anthropic', async (route) => {
    anthropicConfiguration = route.request().postDataJSON();
    await anthropicConfigurationReleased;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'anthropic',
        credentialSource: 'session',
        configured: true,
        baseUrl: 'api.anthropic.com',
      }),
    });
  });
  await page.route('**/api/providers/anthropic/models', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ models: [{ id: 'claude-synthetic', name: 'Claude synthetic' }] }),
    }),
  );
  await settings.getByLabel('API key', { exact: true }).fill(anthropicKey);
  await settings.getByRole('button', { name: 'Check key' }).click();
  await expect(
    settings.getByRole('option', { name: /^OpenAI-compatible endpoint/ }),
  ).toBeDisabled();
  await expect(settings.getByLabel('API key', { exact: true })).toBeDisabled();
  releaseAnthropicConfiguration?.();
  await expect(settings.getByLabel('Model name')).toHaveValue('claude-synthetic');
  expect(anthropicConfiguration).toEqual({ apiKey: anthropicKey });

  await pick(/^OpenAI-compatible endpoint/);
  await expect(settings.getByLabel('Base URL')).toHaveValue('');
  await expect(settings.getByLabel('API key (optional)')).toHaveValue('');
  if (!(await settings.getByLabel('Optional headers as JSON').isVisible()))
    await settings.getByText('Additional headers', { exact: true }).click();
  await expect(settings.getByLabel('Optional headers as JSON')).toHaveValue('');
  await settings.getByLabel('Base URL').fill('https://remote.example.test/v1');
  await settings.getByLabel('API key (optional)').fill('second-compatible-key');
  await settings.getByLabel('Optional headers as JSON').fill('{"X-Remote":"true"}');
  await settings.getByLabel('Model name').fill('manual-compatible');
  await expect(settings.getByRole('button', { name: 'Use for this project' })).toBeDisabled();
  await expect(settings.locator('.provider-host').filter({ hasText: 'Pending' })).toContainText(
    'remote.example.test',
  );

  await pick(/^Ollama/);
  await expect(settings.getByLabel(/^Host/)).toHaveValue('');
  await expect(settings.getByLabel(/^API key/)).toHaveCount(0);
  await expect(settings.getByLabel('Optional headers as JSON')).toHaveCount(0);
  await expect(settings.locator('.provider-host')).toContainText('ollama.saved.example.test');
  await expect(settings.locator('.provider-host')).not.toContainText('remote.example.test');

  let ollamaConfiguration: unknown;
  await page.route('**/api/session/providers/ollama', async (route) => {
    ollamaConfiguration = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'ollama',
        credentialSource: 'session',
        configured: true,
        baseUrl: '127.0.0.1',
      }),
    });
  });
  await page.route('**/api/providers/ollama/models', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ models: [{ id: 'local-synthetic', name: 'Local synthetic' }] }),
    }),
  );
  await settings.getByRole('button', { name: /^Check (connection|again)$/ }).click();
  await expect(settings.getByLabel('Model name')).toHaveValue('local-synthetic');
  expect(ollamaConfiguration).toBeUndefined();
  await expect(settings.locator('.provider-host')).toContainText('ollama.saved.example.test');
  await expect(settings.locator('.provider-host')).not.toContainText('remote.example.test');

  await settings.getByLabel(/^Host/).fill('https://pending-close.example.test/v1');
  await openConversation(page);
  await openSettings(page);
  const reopened = page.getByRole('main', { name: 'AI settings', exact: true });
  await reopened.getByRole('option', { name: /^Ollama/ }).click();
  await expect(reopened.getByLabel(/^Host/)).toHaveValue('');
  await expect(reopened.locator('.provider-host')).toContainText('ollama.saved.example.test');
  await expect(reopened.locator('.provider-host')).not.toContainText('pending-close.example.test');
});

test('exports current AI evidence immediately and clears handoff selection boundaries', async ({
  page,
  request,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await expect
    .poll(async () => (await request.get('/api/health')).status(), { timeout: 10_000 })
    .toBe(200);
  const projectName = `Evidence handoff ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const alternateName = `Evidence alternate ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/projects', {
    data: { name: projectName, description: 'Synthetic evidence handoff fixture' },
  });
  const createdBody = await created.text();
  expect(created.ok(), `${created.status()} ${createdBody}`).toBe(true);
  const project = JSON.parse(createdBody) as { id: string };
  const alternate = await request.post('/api/projects', {
    data: { name: alternateName, description: 'Synthetic project switch fixture' },
  });
  expect(alternate.ok()).toBe(true);

  await page.goto('/');
  await selectProject(page, projectName);
  await page.getByLabel('Add source file').setInputFiles({
    name: 'handoff-evidence.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Evidence\nEight of twelve product managers lost an unsaved PRD draft before review.',
    ),
  });
  await expect
    .poll(
      async () => {
        const result = (await (
          await request.get(`/api/projects/${project.id}/sources`)
        ).json()) as {
          sources: Array<{ status: string }>;
        };
        return result.sources[0]?.status;
      },
      { timeout: 15_000 },
    )
    .not.toBe('processing');

  await configureMockProvider(page);
  await openConversation(page);
  await chooseScope(page, /Problem/);
  await page.getByLabel('Your instruction').fill('Rewrite the problem using the current evidence.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: "I reviewed the supporting material and this proposal's claims.",
    })
    .check();
  await expect(page.getByRole('button', { name: 'Accept change' })).toBeEnabled();

  const openHandoff = async () => {
    await openHistory(page);
    await page.getByRole('button', { name: 'Manual handoff…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Manual handoff', exact: true });
    await expect(sheet).toBeVisible();
    return sheet;
  };
  const closeHandoff = async () => {
    await page
      .getByRole('dialog', { name: 'Manual handoff', exact: true })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Manual handoff', exact: true })).toBeHidden();
  };

  let sheet = await openHandoff();
  const evidenceCheckbox = sheet.getByRole('checkbox', { name: /handoff-evidence\.md/ });
  await expect(evidenceCheckbox).toBeVisible();
  await evidenceCheckbox.check();
  await sheet
    .getByLabel('Instruction')
    .fill('Rewrite the problem using only the selected evidence.');
  const handoffDownload = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Save as file…' }).click();
  const handoffPath = await (await handoffDownload).path();
  expect(handoffPath).toBeTruthy();
  const handoffRequest = JSON.parse(fs.readFileSync(handoffPath, 'utf8')) as {
    evidence: Array<{ id: string; sourceName: string }>;
  };
  expect(handoffRequest.evidence).toEqual([
    expect.objectContaining({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      sourceName: 'handoff-evidence.md',
    }),
  ]);
  await closeHandoff();

  await openConversation(page);
  await page.getByLabel('Your instruction').fill('Summarize the current evidence.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect
    .poll(async () => {
      const result = (await (await request.get(`/api/projects/${project.id}/ai-runs`)).json()) as {
        runs: unknown[];
      };
      return result.runs.length;
    })
    .toBe(2);
  sheet = await openHandoff();
  await expect(sheet.getByRole('checkbox', { name: /handoff-evidence\.md/ })).not.toBeChecked();
  await sheet.getByRole('checkbox', { name: /handoff-evidence\.md/ }).check();
  await closeHandoff();

  await page.getByRole('button', { name: 'AI runs', exact: true }).click();
  const rewriteRun = page
    .locator('.history-row')
    .filter({ hasText: 'Proposal · Problem' })
    .filter({ hasText: 'synthetic-prd-model' })
    .first();
  await rewriteRun.click();
  await page.getByRole('button', { name: 'Open in conversation' }).click();
  await expect(page.getByRole('group', { name: 'Proposed change to Problem' })).toBeVisible();
  sheet = await openHandoff();
  await expect(sheet.getByRole('checkbox', { name: /handoff-evidence\.md/ })).not.toBeChecked();
  await sheet.getByRole('checkbox', { name: /handoff-evidence\.md/ }).check();
  await closeHandoff();

  await selectProject(page, alternateName);
  await selectProject(page, projectName);
  sheet = await openHandoff();
  await expect(sheet.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await closeHandoff();

  await removeSource(page, 'handoff-evidence.md');
  await openHistory(page);
  await page.getByRole('button', { name: 'AI runs', exact: true }).click();
  await expect(
    page.locator('.history-row').filter({ hasText: 'Manual handoff' }).first(),
  ).toContainText('Out of date');
  const runsAfterDeletion = (await (
    await request.get(`/api/projects/${project.id}/ai-runs`)
  ).json()) as {
    runs: Array<{
      id: string;
      action: string;
      sourceRevision: number;
      outputText: string | null;
    }>;
  };
  const deletedEvidenceProposal = runsAfterDeletion.runs.find((run) => run.action === 'rewrite');
  expect(deletedEvidenceProposal).toBeTruthy();
  const rejectedApply = await request.post(
    `/api/projects/${project.id}/ai-runs/${deletedEvidenceProposal!.id}/apply`,
    {
      data: {
        revision: deletedEvidenceProposal!.sourceRevision,
        proposedMarkdown: deletedEvidenceProposal!.outputText,
      },
    },
  );
  expect(rejectedApply.status()).toBe(409);
  expect((await rejectedApply.json()) as { error: { code: string } }).toMatchObject({
    error: { code: 'stale_evidence' },
  });
  await page
    .locator('.history-row')
    .filter({ hasText: 'Proposal · Problem' })
    .filter({ hasText: 'synthetic-prd-model' })
    .first()
    .click();
  await page.getByRole('button', { name: 'Open in conversation' }).click();
  const invalidProposal = page.getByRole('group', { name: 'Proposed change to Problem' });
  await expect(invalidProposal).toBeVisible();
  await expect(invalidProposal.getByRole('button', { name: 'Accept change' })).toHaveCount(0);
  await expect(
    invalidProposal.getByText(
      'This proposal cites an excerpt that isn’t in Sources. It can’t be applied.',
    ),
  ).toBeVisible();
});

test('keeps uncertain grounding visible and requires renewed source review before applying', async ({
  page,
  request,
}) => {
  await expect
    .poll(async () => (await request.get('/api/health')).status(), { timeout: 10_000 })
    .toBe(200);
  const name = `Grounding review ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/projects', {
    data: { name, description: 'Local grounding UI fixture' },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBe(true);
  const project = (await created.json()) as { id: string };
  await page.goto('/');
  await selectProject(page, name);
  await page.getByLabel('Add source file').setInputFiles({
    name: 'research.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Research\nEight of twelve product managers lost an unsaved PRD draft. Reconstruction took 23 minutes on average.',
    ),
  });
  await expect(page.getByRole('option', { name: /research\.md/ })).toContainText('Ready', {
    timeout: 15_000,
  });
  await configureMockProvider(page);
  await openConversation(page);
  await chooseScope(page, /Problem/);
  await page.getByLabel('Your instruction').fill('Make the problem evidence-led.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const notice = page.getByRole('region', { name: 'Needs source review' });
  const apply = page.getByRole('button', { name: 'Accept change' });
  const acknowledgement = page.getByRole('checkbox', {
    name: "I reviewed the supporting material and this proposal's claims.",
  });
  await expect(notice).toBeVisible();
  await expect(apply).toBeDisabled();
  await expect(notice).toContainText('Reconstruction took 23 minutes');
  await acknowledgement.check();
  await expect(apply).toBeEnabled();
  await page.reload();
  await selectProject(page, name);
  await openHistory(page);
  await page.getByRole('button', { name: 'AI runs', exact: true }).click();
  const row = page.locator('.history-row').filter({ hasText: 'Proposal · Problem' }).first();
  await expect(row).toContainText('Needs source review');
  await row.click();
  await page.getByRole('button', { name: 'Open in conversation' }).click();
  await expect(acknowledgement).not.toBeChecked();
  await expect(apply).toBeDisabled();
  await acknowledgement.check();
  await page.getByText('Edit…', { exact: true }).click();
  await page
    .getByLabel('Revised AI proposal')
    .fill('Eight of twelve product managers lost an unsaved PRD draft. Reviewed locally.');
  await expect(acknowledgement).not.toBeChecked();
  await expect(apply).toBeDisabled();
  await acknowledgement.check();
  await apply.click();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted ·' })).toBeVisible();
  const runs = (await (await request.get(`/api/projects/${project.id}/ai-runs`)).json()) as {
    runs: Array<{ grounding: { status: string }; appliedRevision: number | null }>;
  };
  expect(runs.runs[0]?.grounding.status).toBe('review_required');
  expect(runs.runs[0]?.appliedRevision).not.toBeNull();
});

test('completes the provider, evidence, proposal, review, undo, and export workflow', async ({
  page,
  request,
}, testInfo) => {
  testInfo.setTimeout(90_000);
  await expect
    .poll(async () => (await request.get('/api/health')).status(), { timeout: 10_000 })
    .toBe(200);
  const projectName = `Complete workflow ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/projects', {
    data: { name: projectName, description: 'Synthetic end-to-end fixture' },
  });
  const project = (await created.json()) as { id: string };
  expect(created.ok(), `${created.status()} ${JSON.stringify(project)}`).toBe(true);
  const alternateName = `Alternate project ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const alternate = await request.post('/api/projects', {
    data: { name: alternateName, description: 'Synthetic switch target' },
  });
  expect(alternate.ok(), `${alternate.status()} ${await alternate.text()}`).toBe(true);

  await page.goto('/');
  await selectProject(page, projectName);
  await page.getByLabel('Add source file').setInputFiles({
    name: 'research.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Research\n\nEight of twelve product managers lost an unsaved PRD draft.\n\nReconstruction took 23 minutes on average.',
    ),
  });
  await expect(page.getByRole('option', { name: /research\.md/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /research\.md/ })).toContainText('Ready', {
    timeout: 15_000,
  });

  await configureMockProvider(page);
  await openConversation(page);

  let chooserGenerationCalls = 0;
  const countGeneration = (request: import('@playwright/test').Request) => {
    if (request.url().endsWith('/api/ai/actions')) chooserGenerationCalls++;
  };
  page.on('request', countGeneration);
  await page.getByRole('button', { name: /Choose model$/ }).click();
  const modelMenu = page.getByRole('menu', { name: /Choose model$/ });
  await expect(modelMenu).toBeVisible();
  await expect(modelMenu.getByText('On this Mac', { exact: true })).toBeVisible();
  await modelMenu
    .getByRole('group', { name: 'On this Mac · OpenAI-compatible endpoint', exact: true })
    .getByRole('menuitemradio', { name: /synthetic-prd-model/ })
    .click();
  await expect(modelMenu).toBeHidden();
  await expect(page.getByRole('button', { name: /Choose model$/ })).toContainText(
    'synthetic-prd-model',
  );
  expect(chooserGenerationCalls).toBe(0);
  page.off('request', countGeneration);

  await chooseScope(page, /Problem/);
  await page.getByLabel('Your instruction').fill('Make the problem evidence-led.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const proposal = page.getByRole('group', { name: 'Proposed change to Problem' });
  const accept = page.getByRole('button', { name: 'Accept change' });
  await expect(accept).toBeEnabled();
  await page.reload();
  await selectProject(page, projectName);
  await openHistory(page);
  await page.getByRole('button', { name: 'AI runs', exact: true }).click();
  const durableRewrite = page
    .locator('.history-row')
    .filter({ hasText: 'Proposal · Problem' })
    .filter({ hasText: 'synthetic-prd-model' })
    .first();
  await expect(durableRewrite).toContainText('OpenAI-compatible endpoint');
  await expect(durableRewrite).toContainText('Based on Version 0');
  await durableRewrite.click();
  await page.getByRole('button', { name: 'Open in conversation' }).click();
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Based on Version 0');
  await expect(accept).toBeEnabled();
  await chooseScope(page, 'Whole PRD');
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText('Based on Version 0');
  await expect(accept).toBeEnabled();
  await chooseScope(page, /Problem/);
  const beforeTargetSwitch = (await (
    await request.get(`/api/projects/${project.id}/prd`)
  ).json()) as { sections: Array<{ id: string; title: string; body: string }> };
  const contextSection = beforeTargetSwitch.sections.find(
    (section) => section.title === 'Context',
  )!;
  const contextBefore = contextSection.body;
  const contextEditor = page.locator(`#section-${contextSection.id}`);
  await openDocument(page);
  await page
    .getByRole('list', { name: 'Outline' })
    .getByRole('link', { name: /^02 Context\b/ })
    .click();
  await openConversation(page);
  await expect(page.getByRole('button', { name: 'Apply to: Context' })).toBeVisible();
  await expect(proposal).toBeVisible();
  await openDocument(page);
  await contextEditor.getByLabel('Section content').focus();
  await page.keyboard.insertText('Unsaved local edit must be preserved.');
  await openConversation(page);
  await expect(accept).toBeDisabled();
  await openDocument(page);
  await contextEditor.getByLabel('Section content').focus();
  await page.getByRole('button', { name: 'Undo editor change' }).click();
  await expect(contextEditor.getByLabel('Section content')).toHaveText(contextBefore);
  await openConversation(page);
  await expect(accept).toBeEnabled();
  let releaseApply!: () => void;
  const heldApply = new Promise<void>((resolve) => {
    releaseApply = resolve;
  });
  await page.route('**/api/projects/*/ai-runs/*/apply', async (route) => {
    await heldApply;
    await route.continue();
  });
  await page.getByText('Edit…', { exact: true }).click();
  await accept.click();
  await expect(page.getByLabel('Your instruction')).toBeDisabled();
  await expect(page.getByLabel('Revised AI proposal')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Apply to/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  releaseApply();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted ·' })).toContainText(
    'Problem updated',
  );
  await page.unroute('**/api/projects/*/ai-runs/*/apply');
  await openDocument(page);
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Eight of twelve product managers lost an unsaved PRD draft',
  );
  const persisted = (await (await request.get(`/api/projects/${project.id}/prd`)).json()) as {
    sections: Array<{ title: string; body: string }>;
  };
  expect(persisted.sections.find((section) => section.title === 'Context')?.body).toBe(
    contextBefore,
  );
  const appliedBody = persisted.sections[0]!.body;
  await page
    .getByLabel('Section content')
    .first()
    .fill(`${appliedBody} Unsaved local work must survive revision controls.`);
  await openConversation(page);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      return window.dispatchEvent(event);
    }),
  ).toBe(false);
  await showSidebar(page);
  await sidebar(page)
    .getByRole('button', { name: /Show project menu$/ })
    .click();
  await page.getByRole('menuitem', { name: 'New project' }).click();
  const newProject = page.getByRole('dialog', { name: 'New project', exact: true });
  await expect(newProject).toBeVisible();
  await newProject.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(newProject).toBeHidden();
  await openDocument(page);
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Unsaved local work must survive revision controls.',
  );
  await selectProject(page, alternateName);
  const savedBeforeSwitch = (await (
    await request.get(`/api/projects/${project.id}/prd`)
  ).json()) as { sections: Array<{ body: string }> };
  expect(savedBeforeSwitch.sections[0]?.body).toContain(
    'Unsaved local work must survive revision controls.',
  );
  await selectProject(page, projectName);
  await openDocument(page);
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Unsaved local work must survive revision controls.',
  );
  await page
    .getByLabel('Section content')
    .first()
    .fill(`${savedBeforeSwitch.sections[0]!.body} Further unsaved work.`);
  const invalidImport = page.waitForResponse((response) =>
    response.url().endsWith('/api/projects/restore'),
  );
  await page.getByLabel('Import PRD or restore project archive').setInputFiles({
    name: 'invalid.prdgenie.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not imported'),
  });
  expect((await invalidImport).ok()).toBe(false);
  await expectProject(page, projectName);
  const savedBeforeImport = (await (
    await request.get(`/api/projects/${project.id}/prd`)
  ).json()) as { sections: Array<{ body: string }> };
  expect(savedBeforeImport.sections[0]?.body).toContain('Further unsaved work.');
  await openDocument(page);
  await page
    .getByLabel('Section content')
    .first()
    .fill(`${savedBeforeImport.sections[0]!.body} Keep work after failed import.`);
  await showSidebar(page);
  await sidebar(page)
    .getByRole('button', { name: /Show project menu$/ })
    .click();
  await page.getByRole('menuitem', { name: 'Delete project…' }).click();
  const deleteAlert = page.getByRole('alertdialog');
  await expect(deleteAlert).toContainText('discards unsaved changes');
  await deleteAlert.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(deleteAlert).toBeHidden();
  await expectProject(page, projectName);
  await openDocument(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await openConversation(page);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await openDocument(page);
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Unsaved local work must survive revision controls.',
  );

  await openConversation(page);
  await chooseScope(page, 'Whole PRD');
  await page.getByLabel('Your instruction').fill('Run the full structured review.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const finding = page.locator('.finding').first();
  await expect(finding).toBeVisible();
  await expect(finding).toContainText('Reconstruction took 23 minutes on average.');
  await expect(page.getByLabel('Revised AI proposal')).toHaveCount(0);
  await expect(page.locator('.finding')).toHaveCount(1);
  await openDocument(page);
  await page.getByLabel('Section content').first().fill('Unsaved review edit must be preserved.');
  await openConversation(page);
  await expect(finding.getByRole('button', { name: 'Accept change' })).toBeDisabled();
  await expect
    .poll(async () => {
      const workspace = (await (
        await request.get(`/api/projects/${project.id}/workspace`)
      ).json()) as { draft: { sections: Array<{ body: string }> } | null };
      return workspace.draft?.sections[0]?.body;
    })
    .toContain('Unsaved review edit must be preserved.');
  const unloadDialog = page.waitForEvent('dialog');
  const reload = page.reload();
  const dialog = await unloadDialog;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.accept();
  await reload;
  await selectProject(page, projectName);
  await openDocument(page);
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Unsaved review edit must be preserved.',
  );
  const savedBeforeRecovery = (await (
    await request.get(`/api/projects/${project.id}/prd`)
  ).json()) as { sections: Array<{ body: string }> };
  await page.getByLabel('Section content').first().fill(savedBeforeRecovery.sections[0]!.body);
  await openConversation(page);
  await expect(finding.getByRole('button', { name: 'Accept change' })).toBeEnabled();
  let releaseFinding!: () => void;
  const heldFinding = new Promise<void>((resolve) => {
    releaseFinding = resolve;
  });
  await page.route('**/api/projects/*/review-findings/*/accept', async (route) => {
    await heldFinding;
    await route.continue();
  });
  await finding.getByRole('button', { name: 'Accept change' }).click();
  await expect(page.locator('.finding-revision textarea')).toBeDisabled();
  await expect(finding.getByRole('button', { name: 'Accept change' })).toBeDisabled();
  await expect(finding.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  releaseFinding();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted ·' })).toContainText(
    'Problem updated',
  );
  await page.unroute('**/api/projects/*/review-findings/*/accept');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await openDocument(page);
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Unsaved local work must survive revision controls.',
  );

  await openConversation(page);
  await page.getByLabel('Your instruction').fill('Run the full structured review.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.locator('.finding').first().getByRole('button', { name: 'Accept change' }),
  ).toBeVisible();
  await removeSource(page, 'research.md');
  await openConversation(page);
  const staleFinding = page.locator('.finding').filter({ hasText: 'Status: stale' }).first();
  await expect(staleFinding).toBeVisible();
  await staleFinding.getByRole('button', { name: /research\.md/ }).click();
  await expect(page.getByRole('main', { name: 'Sources', exact: true })).toBeVisible();
  await expect(page.getByText('Source removed.', { exact: false })).toBeVisible();

  const download = page.waitForEvent('download');
  await exportAs(page, /^Markdown/);
  expect((await download).suggestedFilename()).toMatch(/\.md$/);

  await openSettings(page);
  const settings = page.getByRole('main', { name: 'AI settings', exact: true });
  await settings.getByRole('option', { name: /^OpenAI-compatible endpoint/ }).click();
  await settings.getByRole('button', { name: 'Remove key' }).click();
  await expect(settings.getByRole('button', { name: 'Remove key' })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Check connection' })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('validates a ChatGPT handoff, durable history, revision restore, and archive restore', async ({
  page,
  request,
}, testInfo) => {
  await expect
    .poll(async () => (await request.get('/api/health')).status(), { timeout: 10_000 })
    .toBe(200);
  const projectName = `Portable handoff ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/projects', {
    data: { name: projectName, description: 'Synthetic portable workflow' },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBe(true);
  await page.goto('/');
  await selectProject(page, projectName);
  await openHistory(page);
  await page.getByRole('button', { name: 'Manual handoff…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Manual handoff', exact: true });
  await sheet
    .getByLabel('Instruction')
    .fill('Rewrite the problem using only the supplied synthetic context.');

  const requestDownload = page.waitForEvent('download');
  await sheet.getByRole('button', { name: 'Save as file…' }).click();
  const requestPath = await (await requestDownload).path();
  expect(requestPath).toBeTruthy();
  const handoffRequest = JSON.parse(fs.readFileSync(requestPath, 'utf8')) as {
    handoffId: string;
    projectId: string;
    sourceRevision: number;
    requestDigest: string;
    sections: Array<{ id: string; preimageHash: string }>;
  };
  const response = {
    formatVersion: 1,
    kind: 'prd-genie-response',
    handoffId: handoffRequest.handoffId,
    projectId: handoffRequest.projectId,
    sourceRevision: handoffRequest.sourceRevision,
    requestDigest: handoffRequest.requestDigest,
    summary: 'Adds a concrete synthetic user problem.',
    patches: [
      {
        sectionId: handoffRequest.sections[0]!.id,
        preimageHash: handoffRequest.sections[0]!.preimageHash,
        afterMarkdown: 'Working product managers lose unsaved draft changes before review.',
        evidenceIds: [],
      },
    ],
    findings: [],
    hostModel: 'synthetic-chatgpt-model',
  };
  await sheet
    .getByLabel('Paste the full response from the other chat tool')
    .fill(JSON.stringify(response));
  await sheet.getByRole('button', { name: 'Create proposal' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Adds a concrete synthetic user problem.')).toBeVisible();
  let releaseHandoff!: () => void;
  const heldHandoff = new Promise<void>((resolve) => {
    releaseHandoff = resolve;
  });
  await page.route('**/api/projects/*/chatgpt-handoffs/*/apply', async (route) => {
    await heldHandoff;
    await route.continue();
  });
  const stagedHandoff = page.locator('.handoff-row').filter({
    hasText: 'Adds a concrete synthetic user problem.',
  });
  await stagedHandoff.getByRole('button', { name: 'Accept change' }).click();
  await expect(stagedHandoff.getByRole('checkbox')).toBeDisabled();
  await expect(stagedHandoff.locator('textarea')).toBeDisabled();
  await expect(stagedHandoff.getByRole('button', { name: 'Accept change' })).toBeDisabled();
  await expect(stagedHandoff.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  releaseHandoff();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted ·' })).toBeVisible();
  await page.unroute('**/api/projects/*/chatgpt-handoffs/*/apply');
  await openDocument(page);
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Working product managers',
  );
  await openHistory(page);
  await expect(page.getByRole('option', { name: /^Version 1\b/ })).toBeVisible();

  await page.getByRole('option', { name: /^Version 0\b/ }).click();
  await page.getByRole('button', { name: 'Restore Version 0…' }).click();
  const restoreAlert = page.getByRole('alertdialog');
  await expect(restoreAlert).toContainText('Restore Version 0?');
  await restoreAlert.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('option', { name: /^Version 2\b/ })).toBeVisible();
  await openDocument(page);
  await expect(page.getByLabel('Section content').first()).not.toContainText(
    'Working product managers',
  );

  const archiveDownload = page.waitForEvent('download');
  await exportAs(page, /^Project archive/);
  const downloadedArchive = await archiveDownload;
  const archivePath = await downloadedArchive.path();
  expect(archivePath).toBeTruthy();
  await page.getByLabel('Import PRD or restore project archive').setInputFiles({
    name: downloadedArchive.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: fs.readFileSync(archivePath),
  });
  await expect
    .poll(async () => {
      const projects = (await (await request.get('/api/projects')).json()) as {
        projects: Array<{ name: string }>;
      };
      return projects.projects.filter((item) => item.name === projectName).length;
    })
    .toBe(2);
  await expectProject(page, projectName);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

for (const width of [320, 375, 414, 768]) {
  test(`keeps editing and provider setup available at ${width}px`, async ({ page, request }) => {
    const projectName = `Responsive ${width} ${crypto.randomUUID().slice(0, 8)}`;
    const created = await request.post('/api/projects', { data: { name: projectName } });
    expect(created.ok()).toBe(true);
    await page.setViewportSize({ width, height: 820 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await selectProject(page, projectName);
    const outline = page.getByRole('list', { name: 'Outline' });
    await expect(outline).toBeHidden();
    await hideSidebar(page);
    await expect(page.getByLabel('Your instruction')).toBeVisible();
    await openDocument(page);
    await expect(page.getByLabel('Section content').first()).toBeVisible();
    await showSidebar(page);
    await expect(outline).toBeVisible();
    await hideSidebar(page);
    await expect(outline).toBeHidden();
    await openConversation(page);
    await expect(page.getByLabel('Your instruction')).toBeVisible();
    await openSettings(page);
    await expect(page.getByRole('heading', { name: 'AI settings', exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
    if (width === 768) {
      // Exercise the same preference flags supplied by the native shell,
      // without changing the host Mac's accessibility settings.
      await page.evaluate(() => {
        Object.assign(document.documentElement.dataset, {
          reduceMotion: 'true',
          reduceTransparency: 'true',
          increaseContrast: 'true',
        });
      });
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCSS(
        'background-color',
        'rgb(236, 236, 239)',
      );
      await expect(page.getByRole('dialog', { name: 'Export', exact: true })).toHaveCSS(
        'animation-name',
        'none',
      );
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground').trim(),
        ),
      ).toBe('#45454a');
      await page
        .getByRole('dialog', { name: 'Export', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await expect(page.getByRole('dialog', { name: 'Export', exact: true })).toBeHidden();
    }
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
    const focusStyle = await focused.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { outline: style.outlineStyle, boxShadow: style.boxShadow };
    });
    expect(focusStyle.outline !== 'none' || focusStyle.boxShadow !== 'none').toBe(true);
  });
}
