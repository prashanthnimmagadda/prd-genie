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
  await expect(page.getByRole('button', { name: 'Apply to section' })).toBeEnabled();
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
  await expect(page.getByRole('button', { name: 'Apply to section' })).toBeEnabled();
  await page.locator('.action-context select').first().selectOption('ask');
  await page.locator('.action-context select').nth(1).selectOption('document');
  await expect(
    page.getByText(/Proposal from openai-compatible \/ synthetic-prd-model/),
  ).toContainText('rewrite on section scope');
  await expect(page.getByRole('button', { name: 'Apply to section' })).toBeEnabled();
  await page.locator('.action-context select').first().selectOption('rewrite');
  await page.locator('.action-context select').nth(1).selectOption('section');
  await page.getByLabel('Section content').first().fill('Unsaved local edit must be preserved.');
  await expect(page.getByRole('button', { name: 'Apply to section' })).toBeDisabled();
  await page.getByLabel('Undo editor change').first().click();
  await expect(page.getByRole('button', { name: 'Apply to section' })).toBeEnabled();
  let releaseApply!: () => void;
  const heldApply = new Promise<void>((resolve) => {
    releaseApply = resolve;
  });
  await page.route('**/api/projects/*/ai-runs/*/apply', async (route) => {
    await heldApply;
    await route.continue();
  });
  await page.getByText('Revise proposal before applying').click();
  await page.getByRole('button', { name: 'Apply to section' }).click();
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
    'Product managers lose unsaved PRD work',
  );
  const persisted = (await (await request.get(`/api/projects/${project.id}/prd`)).json()) as {
    sections: Array<{ body: string }>;
  };
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
  await expect(page.getByText('The evidence establishes repeated draft loss')).toBeVisible();
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
  const projectName = `Portable handoff ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/projects', {
    data: { name: projectName, description: 'Synthetic portable workflow' },
  });
  expect(created.ok()).toBe(true);
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

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

for (const width of [320, 375, 414, 768]) {
  test(`keeps editing and provider setup available at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/');
    if (await page.getByLabel('Project name').isVisible()) {
      await page.getByLabel('Project name').fill(`Responsive ${width}`);
      await page.getByRole('button', { name: 'Create project' }).click();
    }
    await page.getByRole('button', { name: 'Open project navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Document outline' })).toBeVisible();
    await page.getByRole('button', { name: 'Close navigation' }).click();
    await page.getByRole('button', { name: 'Configure model provider' }).click();
    await expect(page.getByRole('heading', { name: 'Model provider' })).toBeVisible();
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
  });
}
