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
