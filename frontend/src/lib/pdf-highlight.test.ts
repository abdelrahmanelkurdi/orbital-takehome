import { describe, expect, it } from "vitest";
import {
	findHighlightItemIndices,
	normalizePdfText,
	renderHighlightedTextItem,
	scrollElementIntoContainer,
} from "./pdf-highlight";

describe("normalizePdfText", () => {
	it("collapses whitespace", () => {
		expect(normalizePdfText("The   cap\nis £2m")).toBe("The cap is £2m");
	});
});

describe("findHighlightItemIndices", () => {
	it("returns indices covering a phrase split across items", () => {
		const items = [
			{ str: "The cap" },
			{ str: "is" },
			{ str: "£2,000,000" },
		];
		const indices = findHighlightItemIndices(items, "The cap is £2,000,000");
		expect(indices).toEqual(new Set([0, 1, 2]));
	});

	it("returns empty set when phrase is absent", () => {
		const items = [{ str: "Other text" }];
		expect(findHighlightItemIndices(items, "missing")).toEqual(new Set());
	});
});

describe("renderHighlightedTextItem", () => {
	it("wraps highlighted items in mark tags", () => {
		expect(
			renderHighlightedTextItem("£2m", 1, new Set([1])),
		).toBe('<mark class="citation-highlight">£2m</mark>');
	});
});

describe("scrollElementIntoContainer", () => {
	it("scrolls only within the container", () => {
		const container = document.createElement("div");
		Object.defineProperty(container, "clientHeight", { value: 200 });
		Object.defineProperty(container, "scrollHeight", { value: 800 });
		container.scrollTo = vi.fn();

		const child = document.createElement("mark");
		container.appendChild(child);
		document.body.appendChild(container);

		vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
			top: 100,
			left: 0,
			right: 400,
			bottom: 300,
			width: 400,
			height: 200,
			x: 0,
			y: 100,
			toJSON: () => ({}),
		});
		vi.spyOn(child, "getBoundingClientRect").mockReturnValue({
			top: 500,
			left: 0,
			right: 400,
			bottom: 520,
			width: 400,
			height: 20,
			x: 0,
			y: 500,
			toJSON: () => ({}),
		});
		container.scrollTop = 0;

		scrollElementIntoContainer(container, child);

		expect(container.scrollTo).toHaveBeenCalledWith({
			top: expect.any(Number),
			behavior: "auto",
		});

		document.body.removeChild(container);
	});
});
