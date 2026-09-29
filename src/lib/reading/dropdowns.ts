export type ReadingDropdown = HTMLDetailsElement | null;

export function closeDropdownAfterSelection(dropdown: HTMLDetailsElement, target: EventTarget | null): void {
  const ElementType = dropdown.ownerDocument.defaultView?.Element;
  if (ElementType && target instanceof ElementType && target.closest("a")) dropdown.open = false;
}

export function closeReadingDropdownsOutside(dropdowns: readonly ReadingDropdown[], target: EventTarget | null): void {
  if (!target || typeof target !== "object" || !("nodeType" in target)) return;
  for (const dropdown of dropdowns) {
    if (dropdown?.open && !dropdown.contains(target as Node)) dropdown.open = false;
  }
}

export function closeReadingDropdownsOnEscape(
  event: Pick<KeyboardEvent, "key" | "preventDefault">,
  dropdowns: readonly ReadingDropdown[]
): boolean {
  if (event.key !== "Escape") return false;
  const open = dropdowns.filter((dropdown): dropdown is HTMLDetailsElement => Boolean(dropdown?.open));
  if (open.length === 0) return false;
  event.preventDefault();
  for (const dropdown of open) {
    dropdown.open = false;
    dropdown.querySelector<HTMLElement>("summary")?.focus();
  }
  return true;
}
