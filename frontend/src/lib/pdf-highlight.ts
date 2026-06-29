export function normalizePdfText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Find the smallest span of PDF text-layer items that contains *phrase*. */
export function findHighlightItemIndices(
	items: { str: string }[],
	phrase: string,
): Set<number> {
	const target = normalizePdfText(phrase);
	if (!target || items.length === 0) {
		return new Set();
	}

	let best: Set<number> | null = null;

	for (let start = 0; start < items.length; start++) {
		let combined = "";
		for (let end = start; end < items.length; end++) {
			combined = normalizePdfText(`${combined} ${items[end].str}`);
			if (combined.length > target.length + 48 && !combined.includes(target)) {
				break;
			}
			if (!combined.includes(target)) {
				continue;
			}
			const indices = new Set<number>();
			for (let i = start; i <= end; i++) {
				indices.add(i);
			}
			if (!best || indices.size < best.size) {
				best = indices;
			}
		}
	}

	return best ?? new Set();
}

export function renderHighlightedTextItem(
	str: string,
	itemIndex: number,
	highlightedIndices: Set<number>,
): string {
	if (!highlightedIndices.has(itemIndex)) {
		return str;
	}
	return `<mark class="citation-highlight">${str}</mark>`;
}

/** Scroll *element* into view inside *container* without affecting outer page scroll. */
export function scrollElementIntoContainer(
	container: HTMLElement,
	element: Element,
): void {
	const containerRect = container.getBoundingClientRect();
	const elementRect = element.getBoundingClientRect();
	const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
	const target =
		relativeTop - container.clientHeight / 2 + elementRect.height / 2;
	const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
	container.scrollTo({
		top: Math.max(0, Math.min(target, maxScroll)),
		behavior: "auto",
	});
}
