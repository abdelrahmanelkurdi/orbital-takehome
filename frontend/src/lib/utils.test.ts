import { afterEach, describe, expect, it, vi } from "vitest";
import { parseApiDate, relativeTime } from "./utils";

describe("parseApiDate", () => {
	it("treats timezone-less API timestamps as UTC", () => {
		expect(parseApiDate("2026-06-22T14:00:00").toISOString()).toBe(
			"2026-06-22T14:00:00.000Z",
		);
	});

	it("passes through explicit UTC offsets", () => {
		expect(parseApiDate("2026-06-22T14:00:00Z").toISOString()).toBe(
			"2026-06-22T14:00:00.000Z",
		);
	});
});

describe("relativeTime", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows just now for a freshly created conversation", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-22T14:00:30Z"));

		expect(relativeTime("2026-06-22T14:00:00")).toBe("just now");
	});
});
