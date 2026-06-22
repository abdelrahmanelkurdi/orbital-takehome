import { parseApiDate } from "./utils";

export function formatUploadTime(iso: string): string {
	const date = parseApiDate(iso);
	if (Number.isNaN(date.getTime())) return iso;

	const monthDay = date.toLocaleDateString(undefined, {
		month: "long",
		day: "numeric",
	});
	const time = date.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	return `${monthDay} ${time}`;
}

export function formatPageCount(pages: number): string {
	return `${pages} ${pages === 1 ? "page" : "pages"}`;
}

export function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}K`;
	}
	return String(tokens);
}
