export type NameMatcher = string | RegExp | ((name: string) => boolean);

export function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function normalizeForMatch(input: string): string {
  return normalizeText(input).toLowerCase();
}

export function getElementName(el: Element): string {
  // Best-effort accessible name approximation:
  // 1) aria-label
  // 2) aria-labelledby referenced text
  // 3) title
  // 4) textContent
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return normalizeText(ariaLabel);

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/g)
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((x): x is HTMLElement => !!x)
      .map((node) => node.innerText || node.textContent || '')
      .map(normalizeText)
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  if (el instanceof HTMLElement && el.title) return normalizeText(el.title);
  return normalizeText((el as HTMLElement).innerText || el.textContent || '');
}

export function matchesName(name: string, matcher: NameMatcher): boolean {
  if (typeof matcher === 'string') return normalizeForMatch(name).includes(normalizeForMatch(matcher));
  if (matcher instanceof RegExp) return matcher.test(name);
  return matcher(name);
}

