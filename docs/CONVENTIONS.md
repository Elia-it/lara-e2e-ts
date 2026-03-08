# Conventions

## File Naming
- Page objects: `<name>.page.ts` (e.g., `login.page.ts`)
- Components: `<name>.component.ts` (e.g., `navbar.component.ts`)
- Fixtures: `<name>.fixture.ts` (e.g., `base.fixture.ts`)
- Helpers: `<name>.helper.ts` (e.g., `api.helper.ts`)
- Test specs: `<name>.spec.ts` (e.g., `login.spec.ts`)
- Config: `<name>.config.ts` (e.g., `env.config.ts`)

All filenames use **kebab-case**.

## TypeScript
- Strict mode enabled. No `any` types.
- Use `readonly` for locators and properties that don't change.
- Use `import type` for type-only imports.
- Prefer `const` assertions and literal types where applicable.

## Locators
Priority order:
1. `getByRole` - always preferred
2. `getByLabel` - for form inputs
3. `getByText` - for visible text
4. `getByTestId` - last resort fallback

Never use:
- `page.locator('.css-class')`
- `page.locator('//xpath')`

Exception: `locator('#id')` is acceptable **only** when the semantic role/label resolves to multiple elements (e.g., mobile vs desktop variants of the same combobox). Always document why with a comment. Keep ID selectors encapsulated inside components, never in spec files.

## Test Structure
```typescript
test.describe('Feature Name', () => {
  test('should describe expected behavior', async ({ pageObject }) => {
    // Arrange
    await pageObject.goto();

    // Act
    await pageObject.doSomething();

    // Assert
    await expect(something).toBeVisible();
  });
});
```

- One `test.describe` per spec file.
- Test names start with `should` and describe the expected outcome.
- Follow Arrange-Act-Assert pattern.
- One primary assertion per test. Multiple related assertions on the same subject are acceptable.

## Page Objects
- Extend `BasePage`.
- Define `readonly path` for the page URL path.
- Expose locators as readonly class properties (initialized in declaration, not constructor).
- Multi-step flows become methods that return `Promise<void>`.
- Never assert inside page objects - assertions belong in tests.

## Commits
- Use conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`.
- Keep commits atomic - one logical change per commit.
