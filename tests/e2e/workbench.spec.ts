import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

test('creates a project and exposes the document-first workbench', async ({
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
  await page.goto('/');
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Document outline' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'assist' })).toBeVisible();
  await expect(page.getByText('Problem', { exact: true }).first()).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  if (process.env.UPDATE_SCREENSHOTS === '1' && testInfo.project.name === 'chromium') {
    await page.screenshot({
      path: 'docs/screenshots/workbench.png',
      fullPage: true,
    });
  }
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
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByRole('button', { name: 'Configure model provider' }).click();
  const dialog = page.getByRole('dialog', { name: 'Model provider' });
  const providerSelect = dialog.getByRole('combobox').first();

  await providerSelect.selectOption('openai-compatible');
  await expect(dialog.locator('.provider-host').first()).toContainText('models.saved.example.test');
  await dialog.getByLabel('Session key').fill('replacement-compatible-key');
  await expect(dialog.getByText('Re-enter the full endpoint')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Refresh models' })).toBeDisabled();
  await dialog.getByLabel('Session key').fill('');
  await dialog.getByLabel('Endpoint').fill('https://models.example.test/v1');
  await dialog.getByLabel('Session key').fill('old-compatible-key');
  await dialog.getByLabel('Optional headers as JSON').fill('{"X-Old-Provider":"retained"}');

  await providerSelect.selectOption('anthropic');
  await expect(dialog.getByLabel('Session key')).toHaveValue('');
  await expect(dialog.getByLabel('Endpoint')).toHaveCount(0);
  await expect(dialog.getByLabel('Optional headers as JSON')).toHaveCount(0);

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
  await dialog.getByLabel('Session key').fill(anthropicKey);
  const configureAnthropic = dialog.getByRole('button', { name: 'Configure and discover' });
  await configureAnthropic.click();
  await expect(providerSelect).toBeDisabled();
  await expect(dialog.getByLabel('Session key')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  releaseAnthropicConfiguration?.();
  await expect(dialog.getByPlaceholder('Or enter a model ID')).toHaveValue('claude-synthetic');
  expect(anthropicConfiguration).toEqual({ apiKey: anthropicKey });

  await providerSelect.selectOption('openai-compatible');
  await expect(dialog.getByLabel('Endpoint')).toHaveValue('');
  await expect(dialog.getByLabel('Session key')).toHaveValue('');
  await expect(dialog.getByLabel('Optional headers as JSON')).toHaveValue('');
  await dialog.getByLabel('Endpoint').fill('https://remote.example.test/v1');
  await dialog.getByLabel('Session key').fill('second-compatible-key');
  await dialog.getByLabel('Optional headers as JSON').fill('{"X-Remote":"true"}');
  await dialog.getByPlaceholder('Or enter a model ID').fill('manual-compatible');
  await expect(dialog.getByRole('button', { name: 'Use provider' })).toBeDisabled();
  await expect(dialog.locator('.provider-host-pending')).toContainText('remote.example.test');

  await providerSelect.selectOption('ollama');
  await expect(dialog.getByLabel('Endpoint')).toHaveValue('');
  await expect(dialog.getByLabel('Session key')).toHaveCount(0);
  await expect(dialog.getByLabel('Optional headers as JSON')).toHaveCount(0);
  await expect(dialog.locator('.provider-host')).toContainText('ollama.saved.example.test');
  await expect(dialog.locator('.provider-host')).not.toContainText('remote.example.test');

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
  await dialog.getByRole('button', { name: /Configure and discover|Refresh models/ }).click();
  await expect(dialog.getByPlaceholder('Or enter a model ID')).toHaveValue('local-synthetic');
  expect(ollamaConfiguration).toBeUndefined();
  await expect(dialog.locator('.provider-host')).toContainText('ollama.saved.example.test');
  await expect(dialog.locator('.provider-host')).not.toContainText('remote.example.test');

  await dialog.getByLabel('Endpoint').fill('https://pending-close.example.test/v1');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Configure model provider' }).click();
  const reopened = page.getByRole('dialog', { name: 'Model provider' });
  await reopened.getByRole('combobox').first().selectOption('ollama');
  await expect(reopened.getByLabel('Endpoint')).toHaveValue('');
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
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByLabel('Add source file').setInputFiles({
    name: 'handoff-evidence.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Evidence\nEight of twelve product managers lost an unsaved PRD draft before review.',
    ),
  });
  await expect
    .poll(async () => {
      const result = (await (await request.get(`/api/projects/${project.id}/sources`)).json()) as {
        sources: Array<{ status: string }>;
      };
      return result.sources[0]?.status;
    })
    .not.toBe('processing');

  await page.getByRole('button', { name: 'Configure model provider' }).click();
  const providerDialog = page.getByRole('dialog', { name: 'Model provider' });
  await providerDialog.getByRole('combobox').first().selectOption('openai-compatible');
  await providerDialog.getByLabel('Endpoint').fill('http://127.0.0.1:4312/v1');
  await providerDialog.getByLabel('Session key').fill('synthetic-session-key');
  await providerDialog.getByRole('button', { name: 'Configure and discover' }).click();
  await expect(providerDialog.getByPlaceholder('Or enter a model ID')).toHaveValue(
    'synthetic-prd-model',
  );
  await providerDialog.getByRole('button', { name: 'Use provider' }).click();

  await page.getByLabel('Action').selectOption('rewrite');
  await page
    .getByPlaceholder('How should this be improved?')
    .fill('Rewrite the problem using the current evidence.');
  await page.getByLabel('Submit').click();
  await expect(page.getByRole('button', { name: 'Apply to Problem' })).toBeEnabled();

  await page.getByRole('tab', { name: 'history' }).click();
  const evidenceCheckbox = page.getByRole('checkbox', { name: /handoff-evidence\.md/ });
  await expect(evidenceCheckbox).toBeVisible();
  await evidenceCheckbox.check();
  await page
    .getByPlaceholder('Describe the draft, review, or rewrite you want ChatGPT to propose.')
    .fill('Rewrite the problem using only the selected evidence.');
  const handoffDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export request' }).click();
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

  await page.getByRole('tab', { name: 'assist' }).click();
  await page.getByLabel('Action').selectOption('ask');
  await page.getByPlaceholder('Ask about this PRD').fill('Summarize the current evidence.');
  await page.getByLabel('Submit').click();
  await expect
    .poll(async () => {
      const result = (await (await request.get(`/api/projects/${project.id}/ai-runs`)).json()) as {
        runs: unknown[];
      };
      return result.runs.length;
    })
    .toBe(2);
  await page.getByRole('tab', { name: 'history' }).click();
  await expect(page.getByRole('checkbox', { name: /handoff-evidence\.md/ })).not.toBeChecked();

  await page.getByRole('checkbox', { name: /handoff-evidence\.md/ }).check();
  const rewriteRun = page
    .locator('.history-row')
    .filter({ hasText: 'rewrite on section' })
    .filter({ hasText: 'synthetic-prd-model' })
    .first();
  await rewriteRun.getByRole('button', { name: 'Inspect' }).click();
  await page.getByRole('tab', { name: 'history' }).click();
  await expect(page.getByRole('checkbox', { name: /handoff-evidence\.md/ })).not.toBeChecked();

  await page.getByRole('checkbox', { name: /handoff-evidence\.md/ }).check();
  await page.getByRole('button', { name: alternateName, exact: true }).click();
  await expect(page.getByRole('heading', { name: alternateName })).toBeVisible();
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByRole('tab', { name: 'history' }).click();
  await expect(page.getByRole('checkbox', { name: /handoff-evidence\.md/ })).toHaveCount(0);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete handoff-evidence.md' }).click();
  await expect(page.getByText('handoff-evidence.md', { exact: true })).toHaveCount(0);
  await expect(page.locator('.handoff-row').first()).toContainText('stale');
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
  const deletedEvidenceRun = page
    .locator('.history-row')
    .filter({ hasText: 'rewrite on section' })
    .filter({ hasText: 'synthetic-prd-model' })
    .first();
  await deletedEvidenceRun.getByRole('button', { name: 'Inspect' }).click();
  await expect(page.getByRole('button', { name: 'Apply to Problem' })).toBeDisabled();
  await expect(
    page.getByText('This proposal cannot be applied because its source evidence was deleted.'),
  ).toBeVisible();
});

test('completes the provider, evidence, proposal, review, undo, and export workflow', async ({
  page,
  request,
}, testInfo) => {
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
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByLabel('Add source file').setInputFiles({
    name: 'research.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Research\nEight of twelve product managers lost an unsaved PRD draft. Reconstruction took 23 minutes on average.',
    ),
  });
  await expect(page.getByText('research.md', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Configure model provider' }).click();
  let providerDialog = page.getByRole('dialog', { name: 'Model provider' });
  await providerDialog.getByRole('combobox').first().selectOption('openai-compatible');
  await providerDialog.getByLabel('Endpoint').fill('http://127.0.0.1:4312/v1');
  await providerDialog.getByLabel('Session key').fill('synthetic-session-key');
  await providerDialog.getByRole('button', { name: 'Configure and discover' }).click();
  await expect(providerDialog.getByPlaceholder('Or enter a model ID')).toHaveValue(
    'synthetic-prd-model',
  );
  await providerDialog.getByRole('button', { name: 'Use provider' }).click();

  await page.getByLabel('Action').selectOption('rewrite');
  await page
    .getByPlaceholder('How should this be improved?')
    .fill('Make the problem evidence-led.');
  await page.getByLabel('Submit').click();
  await expect(page.getByRole('button', { name: 'Apply to Problem' })).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByRole('tab', { name: 'history' }).click();
  const durableRewrite = page
    .locator('.history-row')
    .filter({ hasText: 'rewrite on section' })
    .filter({ hasText: 'synthetic-prd-model' })
    .first();
  await durableRewrite.getByRole('button', { name: 'Inspect' }).click();
  await expect(
    page.getByText(/Proposal from openai-compatible \/ synthetic-prd-model/),
  ).toContainText('revision 0, rewrite on section scope');
  await expect(page.getByRole('button', { name: 'Apply to Problem' })).toBeEnabled();
  await page.locator('.action-context select').first().selectOption('ask');
  await page.locator('.action-context select').nth(1).selectOption('document');
  await expect(
    page.getByText(/Proposal from openai-compatible \/ synthetic-prd-model/),
  ).toContainText('rewrite on section scope');
  await expect(page.getByRole('button', { name: 'Apply to Problem' })).toBeEnabled();
  await page.locator('.action-context select').first().selectOption('rewrite');
  await page.locator('.action-context select').nth(1).selectOption('section');
  const beforeTargetSwitch = (await (
    await request.get(`/api/projects/${project.id}/prd`)
  ).json()) as { sections: Array<{ id: string; title: string; body: string }> };
  const contextSection = beforeTargetSwitch.sections.find(
    (section) => section.title === 'Context',
  )!;
  const contextBefore = contextSection.body;
  const contextEditor = page.locator(`#section-${contextSection.id}`);
  await page
    .getByRole('navigation', { name: 'Document outline' })
    .getByRole('link', { name: /Context$/ })
    .click();
  await expect(page.locator('.scope-caption')).toContainText('Proposal target: Problem');
  await expect(page.getByText(/^Target: Problem \[/)).toBeVisible();
  await contextEditor.getByLabel('Section content').fill('Unsaved local edit must be preserved.');
  await expect(page.getByRole('button', { name: 'Apply to Problem' })).toBeDisabled();
  await contextEditor.getByLabel('Undo editor change').click();
  await expect(page.getByRole('button', { name: 'Apply to Problem' })).toBeEnabled();
  let releaseApply!: () => void;
  const heldApply = new Promise<void>((resolve) => {
    releaseApply = resolve;
  });
  await page.route('**/api/projects/*/ai-runs/*/apply', async (route) => {
    await heldApply;
    await route.continue();
  });
  await page.getByText('Revise proposal before applying').click();
  await page.getByRole('button', { name: 'Apply to Problem' }).click();
  await expect(page.getByLabel('Section content').first()).toHaveAttribute(
    'contenteditable',
    'false',
  );
  await expect(page.getByLabel('Section title').first()).toBeDisabled();
  await expect(page.getByPlaceholder('How should this be improved?')).toBeDisabled();
  await expect(page.getByLabel('Revised AI proposal')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Dismiss proposal' })).toBeDisabled();
  await page.getByRole('tab', { name: 'review' }).click();
  await expect(page.getByRole('button', { name: 'Run review' })).toBeDisabled();
  await page.getByRole('tab', { name: 'assist' }).click();
  releaseApply();
  await expect(page.getByRole('status')).toContainText('proposal changed');
  await page.unroute('**/api/projects/*/ai-runs/*/apply');
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
    .fill(`${appliedBody}\n\nUnsaved local work must survive revision controls.`);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      return window.dispatchEvent(event);
    }),
  ).toBe(false);
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('confirm');
    void dialog.dismiss();
  });
  await page.getByLabel('Create project').click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message().toLowerCase()).toContain('discard unsaved changes');
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: alternateName, exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('confirm');
    void dialog.dismiss();
  });
  await page.getByLabel('Restore PRD Genie project archive').setInputFiles({
    name: 'cancelled.prdgenie.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not imported'),
  });
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message().toLowerCase()).toContain('discard unsaved changes');
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Unsaved local work must survive revision controls.',
  );

  await page.getByRole('tab', { name: 'review' }).click();
  await page.getByRole('button', { name: 'Run review' }).click();
  await expect(
    page.getByText('The cited evidence states reconstruction took 23 minutes on average.'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'history' }).click();
  const durableReview = page
    .locator('.history-row')
    .filter({ hasText: 'review on document' })
    .filter({ hasText: 'synthetic-prd-model' })
    .first();
  await durableReview.getByRole('button', { name: 'Inspect' }).click();
  await expect(page.getByRole('button', { name: /^Apply to/ })).toHaveCount(0);
  await expect(page.getByLabel('Revised AI proposal')).toHaveCount(0);
  await page.getByRole('tab', { name: 'review' }).click();
  await page.getByText('Inspect proposed diff').click();
  await page.getByLabel('Section content').first().fill('Unsaved review edit must be preserved.');
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
  const unloadDialog = page.waitForEvent('dialog');
  const reload = page.reload();
  const dialog = await unloadDialog;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.accept();
  await reload;
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByRole('tab', { name: 'review' }).click();
  await page.getByText('Inspect proposed diff').click();
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
  let releaseFinding!: () => void;
  const heldFinding = new Promise<void>((resolve) => {
    releaseFinding = resolve;
  });
  await page.route('**/api/projects/*/review-findings/*/accept', async (route) => {
    await heldFinding;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.locator('.finding-revision textarea')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toBeDisabled();
  releaseFinding();
  await expect(page.getByRole('status')).toContainText('proposal changed');
  await page.unroute('**/api/projects/*/review-findings/*/accept');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Unsaved local work must survive revision controls.',
  );

  await page.getByRole('button', { name: 'Run review' }).click();
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete research.md' }).click();
  await expect(page.getByText('research.md', { exact: true })).toHaveCount(0);
  const staleFinding = page.locator('article.finding').filter({ hasText: 'Status: stale' }).first();
  await expect(staleFinding).toBeVisible();
  await staleFinding.getByRole('button', { name: /research\.md/ }).click();
  await expect(page.getByText('Historical snapshot, source deleted')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'markdown' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);

  await page.getByRole('button', { name: 'Configure model provider' }).click();
  providerDialog = page.getByRole('dialog', { name: 'Model provider' });
  await providerDialog.getByRole('combobox').first().selectOption('openai-compatible');
  await providerDialog.getByRole('button', { name: 'Clear session configuration' }).click();
  await expect(
    providerDialog.getByRole('button', { name: 'Configure and discover' }),
  ).toBeVisible();

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
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByRole('tab', { name: 'history' }).click();
  await page
    .getByPlaceholder('Describe the draft, review, or rewrite you want ChatGPT to propose.')
    .fill('Rewrite the problem using only the supplied synthetic context.');

  const requestDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export request' }).click();
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
  await page.getByLabel('Import ChatGPT handoff response').setInputFiles({
    name: 'response.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(response)),
  });
  await expect(page.getByText('Adds a concrete synthetic user problem.')).toBeVisible();
  let releaseHandoff!: () => void;
  const heldHandoff = new Promise<void>((resolve) => {
    releaseHandoff = resolve;
  });
  await page.route('**/api/projects/*/chatgpt-handoffs/*/apply', async (route) => {
    await heldHandoff;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Apply selected' }).click();
  const stagedHandoff = page.locator('.handoff-row').filter({
    hasText: 'Adds a concrete synthetic user problem.',
  });
  await expect(stagedHandoff.getByRole('checkbox')).toBeDisabled();
  await expect(stagedHandoff.locator('textarea')).toBeDisabled();
  await expect(stagedHandoff.getByRole('button', { name: 'Apply selected' })).toBeDisabled();
  await expect(stagedHandoff.getByRole('button', { name: 'Delete handoff' })).toBeDisabled();
  releaseHandoff();
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Working product managers',
  );
  await page.unroute('**/api/projects/*/chatgpt-handoffs/*/apply');
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Restore', exact: true }).last().click();
  await expect(page.getByText('Revision 2', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Section content').first()).not.toContainText(
    'Working product managers',
  );

  const archiveDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export archive' }).click();
  const downloadedArchive = await archiveDownload;
  const archivePath = await downloadedArchive.path();
  expect(archivePath).toBeTruthy();
  await page.getByLabel('Restore PRD Genie project archive').setInputFiles({
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
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

for (const width of [320, 375, 414, 768]) {
  test(`keeps editing and provider setup available at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    if (await page.getByLabel('Project name').isVisible()) {
      await page.getByLabel('Project name').fill(`Responsive ${width}`);
      await page.getByRole('button', { name: 'Create project' }).click();
    }
    const outline = page.getByRole('navigation', { name: 'Document outline' });
    const assistantTabs = page.getByRole('tablist', { name: 'Assistant panels' });
    await expect(outline).toBeHidden();
    await expect(assistantTabs).toBeHidden();
    await page.getByRole('button', { name: 'Open project navigation' }).click();
    await expect(outline).toBeVisible();
    await page.getByRole('button', { name: 'Close navigation' }).click();
    await expect(outline).toBeHidden();
    await page.getByRole('button', { name: 'Open assist and review panel' }).click();
    await expect(assistantTabs).toBeVisible();
    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect(assistantTabs).toBeHidden();
    await page.getByRole('button', { name: 'Configure model provider' }).click();
    await expect(page.getByRole('heading', { name: 'Model provider' })).toBeVisible();
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
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
