/**
 * Keyboard stepping for review/audit lists. `j`/`k` work anywhere on the page, but the arrow keys
 * only step the list while focus is inside that list (or nowhere in particular), so they keep their
 * native meaning in the diff viewer, tabs, menus and form controls.
 */
const PROTECTED = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="tablist"], [role="tab"], [role="menu"], [role="listbox"], [role="dialog"], .rv-diff'

/** True when a page-level shortcut must not act on this keyboard event at all. */
export function isProtectedKeyTarget(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest(PROTECTED))
}

function focusIsFree(target: EventTarget | null): boolean {
  return !target || target === document.body || target === document.documentElement
}

/** Returns +1 / −1 when the event should move the list selection, otherwise 0. */
export function listKeyStep(event: KeyboardEvent, listRoot: Element | null): 1 | -1 | 0 {
  if (isProtectedKeyTarget(event)) return 0
  if (event.key === 'j') return 1
  if (event.key === 'k') return -1
  const arrow = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (!arrow) return 0
  const target = event.target
  if (focusIsFree(target)) return arrow
  return listRoot && target instanceof Node && listRoot.contains(target) ? arrow : 0
}
