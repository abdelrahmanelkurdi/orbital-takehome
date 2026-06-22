import type { ContextUsage } from "../types";

/** Amber styling when usable budget usage crosses this fraction (design §2.4). */
export const CONTEXT_WARNING_FRACTION = 0.85;

export type ContextMeterLevel =
	| "idle"
	| "loading"
	| "normal"
	| "warning"
	| "full";

export function getUsableBudget(
	contextWindow: number,
	reservedOutput: number,
): number {
	return Math.max(0, contextWindow - reservedOutput);
}

export function getUsableFraction(usage: ContextUsage): number {
	const usable = getUsableBudget(usage.context_window, usage.reserved_output);
	if (usable <= 0) return 0;
	return usage.used_tokens / usable;
}

export function getContextMeterLevel(
	usage: ContextUsage | null,
	loading: boolean,
): ContextMeterLevel {
	if (loading) return "loading";
	if (!usage) return "idle";
	const fraction = getUsableFraction(usage);
	if (fraction >= 1) return "full";
	if (fraction >= CONTEXT_WARNING_FRACTION) return "warning";
	return "normal";
}

export function isContextFull(usage: ContextUsage | null): boolean {
	if (!usage) return false;
	return (
		usage.used_tokens >
		getUsableBudget(usage.context_window, usage.reserved_output)
	);
}

export function formatUsagePercent(fraction: number): string {
	return `${Math.round(fraction * 100)}%`;
}
