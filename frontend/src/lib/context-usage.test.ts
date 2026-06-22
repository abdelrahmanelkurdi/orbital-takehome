import { describe, expect, it } from "vitest";
import type { ContextUsage } from "../types";
import {
	CONTEXT_WARNING_FRACTION,
	formatUsagePercent,
	getContextMeterLevel,
	getUsableFraction,
	isContextFull,
} from "./context-usage";

function makeUsage(usedTokens: number): ContextUsage {
	return {
		model: "claude-haiku-4-5-20251001",
		context_window: 200_000,
		reserved_output: 8000,
		used_tokens: usedTokens,
		used_fraction: usedTokens / 200_000,
		categories: [],
	};
}

describe("context-usage utilities", () => {
	it("computes usable fraction against context window minus reserved output", () => {
		const usage = makeUsage(160_000);
		expect(getUsableFraction(usage)).toBeCloseTo(160_000 / 192_000);
	});

	it("flags warning level near budget", () => {
		const warningTokens = Math.ceil(192_000 * CONTEXT_WARNING_FRACTION);
		expect(getContextMeterLevel(makeUsage(warningTokens), false)).toBe(
			"warning",
		);
	});

	it("flags full level at or over usable budget", () => {
		expect(getContextMeterLevel(makeUsage(192_000), false)).toBe("full");
		expect(getContextMeterLevel(makeUsage(200_000), false)).toBe("full");
	});

	it("isContextFull matches server gate (used > usable budget)", () => {
		expect(isContextFull(makeUsage(192_000))).toBe(false);
		expect(isContextFull(makeUsage(192_001))).toBe(true);
	});

	it("formatUsagePercent is not capped at 100%", () => {
		expect(formatUsagePercent(0.27)).toBe("27%");
		expect(formatUsagePercent(1)).toBe("100%");
		expect(formatUsagePercent(1.02)).toBe("102%");
	});
});
