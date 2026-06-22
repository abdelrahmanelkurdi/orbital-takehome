import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** API datetimes are stored/sent as naive UTC; JS treats timezone-less ISO as local. */
export function parseApiDate(dateString: string): Date {
	const trimmed = dateString.trim();
	const naiveUtc = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(
		trimmed,
	);
	if (naiveUtc) {
		return new Date(`${trimmed.replace(" ", "T")}Z`);
	}
	return new Date(trimmed);
}

export function relativeTime(dateString: string): string {
	const date = parseApiDate(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHr = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHr / 24);

	if (diffMs < 0 || diffSec < 60) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	if (diffHr < 24) return `${diffHr}h ago`;
	if (diffDay < 7) return `${diffDay}d ago`;
	return date.toLocaleDateString();
}
