# Development tool installations

## Playwright browsers

| Field              | Record                                                                           |
| ------------------ | -------------------------------------------------------------------------------- |
| Tool               | Playwright browser binaries for Chromium 151, Firefox 153, and WebKit 26.5       |
| Publisher          | Microsoft Playwright project                                                     |
| Purpose            | Cross-browser, responsive, and accessibility verification                        |
| Scope              | Current user cache only                                                          |
| Permissions        | Network download and user-cache writes                                           |
| Repository changes | None                                                                             |
| Verification       | All 15 browser checks passed after installation                                  |
| Uninstall          | `npx playwright uninstall --all`                                                 |
| Rollback           | Uninstall the binaries; the package lock and application source remain unchanged |
