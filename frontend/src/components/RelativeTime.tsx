import { useEffect, useState } from "react";
import { relativeTime } from "../lib/utils";

const TICK_MS = 30_000;

interface RelativeTimeProps {
	date: string;
	className?: string;
}

/** Re-renders on an interval so "just now" / "Nm ago" labels stay current. */
export function RelativeTime({ date, className }: RelativeTimeProps) {
	const [, setTick] = useState(0);

	useEffect(() => {
		const id = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
		return () => window.clearInterval(id);
	}, []);

	return <span className={className}>{relativeTime(date)}</span>;
}
