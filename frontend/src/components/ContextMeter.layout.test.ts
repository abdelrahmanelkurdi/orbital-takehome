import { describe, expect, it } from "vitest";
import { clampPopoverLeft, computePopoverLayout } from "./ContextMeter";

describe("computePopoverLayout", () => {
	it("caps height to available space below the trigger", () => {
		const triggerRect = {
			top: 100,
			bottom: 130,
			left: 800,
			right: 860,
			width: 60,
			height: 30,
			x: 800,
			y: 100,
			toJSON: () => ({}),
		} as DOMRect;

		const layout = computePopoverLayout(triggerRect);
		const spaceBelow = window.innerHeight - 8 - (triggerRect.bottom + 4);

		expect(layout.top).toBe(134);
		expect(layout.maxHeight).toBe(
			Math.min(window.innerHeight - 16, Math.max(160, spaceBelow)),
		);
		expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(
			window.innerHeight - 8,
		);
	});

	it("opens upward when there is more room above", () => {
		const triggerRect = {
			top: window.innerHeight - 80,
			bottom: window.innerHeight - 50,
			left: 800,
			right: 860,
			width: 60,
			height: 30,
			x: 800,
			y: window.innerHeight - 80,
			toJSON: () => ({}),
		} as DOMRect;

		const layout = computePopoverLayout(triggerRect);

		expect(layout.top).toBeLessThan(triggerRect.top);
		expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(
			triggerRect.top - 4,
		);
	});

	it("keeps the popover within the viewport vertically", () => {
		const triggerRect = {
			top: 8,
			bottom: 36,
			left: 800,
			right: 860,
			width: 60,
			height: 28,
			x: 800,
			y: 8,
			toJSON: () => ({}),
		} as DOMRect;

		const layout = computePopoverLayout(triggerRect);

		expect(layout.top).toBeGreaterThanOrEqual(8);
		expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(
			window.innerHeight - 8,
		);
	});
});

describe("clampPopoverLeft", () => {
	it("clamps to the viewport when near the right edge", () => {
		const left = clampPopoverLeft(window.innerWidth - 4);
		expect(left).toBeGreaterThanOrEqual(8);
		expect(left + 320).toBeLessThanOrEqual(window.innerWidth - 8);
	});
});
