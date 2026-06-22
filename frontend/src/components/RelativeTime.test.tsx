import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelativeTime } from "./RelativeTime";

describe("RelativeTime", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("updates the label as time passes", () => {
		vi.useFakeTimers({ shouldAdvanceTime: false });
		vi.setSystemTime(new Date("2026-06-22T14:00:30Z"));

		render(<RelativeTime date="2026-06-22T14:00:00" />);
		expect(screen.getByText("just now")).toBeTruthy();

		act(() => {
			vi.setSystemTime(new Date("2026-06-22T14:01:00Z"));
		});
		act(() => {
			vi.advanceTimersByTime(30_000);
		});
		expect(screen.getByText("1m ago")).toBeTruthy();
	});
});
