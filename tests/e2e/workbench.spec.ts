import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBe(true);

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
  await page.getByRole('button', { name: 'Apply to section' }).click();
  await expect(page.getByRole('status')).toContainText('proposal changed');
  await expect(page.getByLabel('Section content').first()).toContainText(
    'Product managers lose unsaved PRD work',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Section content').first()).not.toContainText(
    'Product managers lose unsaved PRD work',
  );

  await page.getByRole('tab', { name: 'review' }).click();
  await page.getByRole('button', { name: 'Run review' }).click();
  await expect(page.getByText('The evidence establishes repeated draft loss')).toBeVisible();
  await page.getByText('Inspect proposed diff').click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('proposal changed');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();

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
