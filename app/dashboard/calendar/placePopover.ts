/** Where the popover goes: right of the event when it fits, else flipped to
 *  its left, else pinned inside the viewport; the same for top/bottom using
 *  the popover's real (measured) height. Pure, so it is unit-tested. */
export function placePopover(
  rect: { left: number; right: number; top: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 16,
  gap = 8,
): { left: number; top: number } {
  const { width: w, height: h } = size
  const maxLeft = Math.max(margin, viewport.width - margin - w)
  let left: number
  if (rect.right + gap + w <= viewport.width - margin) left = rect.right + gap
  else if (rect.left - gap - w >= margin) left = rect.left - gap - w
  else left = maxLeft
  left = Math.min(Math.max(margin, left), maxLeft)
  const maxTop = Math.max(margin, viewport.height - margin - h)
  const top = Math.min(Math.max(margin, rect.top), maxTop)
  return { left, top }
}
