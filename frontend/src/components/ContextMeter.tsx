import { Loader2, X } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	formatUsagePercent,
	getContextMeterLevel,
	getUsableFraction,
} from "../lib/context-usage";
import { formatTokenCount } from "../lib/format";
import { cn } from "../lib/utils";
import type { ContextUsage } from "../types";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface ContextMeterProps {
	contextUsage: ContextUsage | null;
	loading: boolean;
	onRemoveDocument?: (documentId: string) => void;
}

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const POPOVER_WIDTH = 320;
const VIEWPORT_MARGIN = 8;
const POPOVER_GAP = 4;
const MIN_POPOVER_HEIGHT = 160;

const RING_COLORS: Record<ReturnType<typeof getContextMeterLevel>, string> = {
	idle: "stroke-neutral-300",
	loading: "stroke-neutral-300",
	normal: "stroke-neutral-500",
	warning: "stroke-amber-500",
	full: "stroke-red-500",
};

export interface PopoverLayout {
	top: number;
	left: number;
	maxHeight: number;
}

export function clampPopoverLeft(triggerRight: number): number {
	const idealLeft = triggerRight - POPOVER_WIDTH;
	const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
	const minLeft = VIEWPORT_MARGIN;
	return Math.min(maxLeft, Math.max(minLeft, idealLeft));
}

/** Size and place the popover from viewport space — not from content height. */
export function computePopoverLayout(triggerRect: DOMRect): PopoverLayout {
	const margin = VIEWPORT_MARGIN;
	const maxTotal = window.innerHeight - margin * 2;
	const spaceBelow =
		window.innerHeight - margin - (triggerRect.bottom + POPOVER_GAP);
	const spaceAbove = triggerRect.top - margin - POPOVER_GAP;
	const openBelow = spaceBelow >= spaceAbove;

	const maxHeight = Math.min(
		maxTotal,
		Math.max(MIN_POPOVER_HEIGHT, openBelow ? spaceBelow : spaceAbove),
	);

	let top = openBelow
		? triggerRect.bottom + POPOVER_GAP
		: triggerRect.top - POPOVER_GAP - maxHeight;

	top = Math.max(
		margin,
		Math.min(top, window.innerHeight - margin - maxHeight),
	);

	return {
		top,
		left: clampPopoverLeft(triggerRect.right),
		maxHeight,
	};
}

function TruncatedFilename({ filename }: { filename: string }) {
	const [truncated, setTruncated] = useState(false);
	const observerRef = useRef<ResizeObserver | null>(null);

	useEffect(() => () => observerRef.current?.disconnect(), []);

	const setLabelRef = (element: HTMLSpanElement | null) => {
		observerRef.current?.disconnect();
		observerRef.current = null;
		if (!element) return;

		const check = () => {
			setTruncated(element.scrollWidth > element.clientWidth);
		};

		check();
		if (typeof ResizeObserver !== "undefined") {
			const observer = new ResizeObserver(check);
			observer.observe(element);
			observerRef.current = observer;
		}
	};

	const label = (
		<span ref={setLabelRef} className="block min-w-0 truncate text-neutral-500">
			{filename}
		</span>
	);

	if (!truncated) return label;

	return (
		<Tooltip>
			<TooltipTrigger asChild>{label}</TooltipTrigger>
			<TooltipContent className="max-w-xs">{filename}</TooltipContent>
		</Tooltip>
	);
}

export function ContextMeter({
	contextUsage,
	loading,
	onRemoveDocument,
}: ContextMeterProps) {
	const [open, setOpen] = useState(false);
	const [popoverLayout, setPopoverLayout] = useState<PopoverLayout | null>(
		null,
	);
	const triggerRef = useRef<HTMLDivElement>(null);
	const popoverRef = useRef<HTMLDialogElement>(null);

	const level = getContextMeterLevel(contextUsage, loading);
	const usableFraction = contextUsage ? getUsableFraction(contextUsage) : 0;
	const ringProgress = Math.min(usableFraction, 1);
	const strokeDashoffset = RING_CIRCUMFERENCE * (1 - ringProgress);

	const updatePopoverLayout = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;
		setPopoverLayout(computePopoverLayout(trigger.getBoundingClientRect()));
	}, []);

	const handleToggle = useCallback(() => {
		if (loading || !contextUsage) return;
		setOpen((prev) => !prev);
	}, [contextUsage, loading]);

	useLayoutEffect(() => {
		if (!open) {
			setPopoverLayout(null);
			return;
		}
		updatePopoverLayout();
	}, [open, updatePopoverLayout]);

	useEffect(() => {
		if (!open) return;

		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				triggerRef.current?.contains(target) ||
				popoverRef.current?.contains(target)
			) {
				return;
			}
			setOpen(false);
		};

		document.addEventListener("mousedown", handlePointerDown);
		window.addEventListener("resize", updatePopoverLayout);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			window.removeEventListener("resize", updatePopoverLayout);
		};
	}, [open, updatePopoverLayout]);

	if (!contextUsage && !loading) {
		return null;
	}

	const percentLabel =
		contextUsage && !loading ? formatUsagePercent(usableFraction) : "—";

	const popover =
		open && contextUsage && popoverLayout
			? createPortal(
					<dialog
						ref={popoverRef}
						open
						aria-label="Context usage breakdown"
						className="fixed z-[100] m-0 flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white p-0 shadow-lg"
						style={{
							top: popoverLayout.top,
							left: popoverLayout.left,
							width: POPOVER_WIDTH,
							maxHeight: popoverLayout.maxHeight,
						}}
					>
						<div className="shrink-0 space-y-2 p-3 pb-2">
							<div className="flex items-baseline justify-between gap-2">
								<h3 className="text-xs font-semibold text-neutral-800">
									Context usage
								</h3>
								<span className="text-[11px] tabular-nums text-neutral-500">
									{formatTokenCount(contextUsage.used_tokens)} /{" "}
									{formatTokenCount(
										contextUsage.context_window - contextUsage.reserved_output,
									)}
								</span>
							</div>

							<div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
								<div
									className={cn(
										"h-full rounded-full transition-all",
										level === "full" && "bg-red-500",
										level === "warning" && "bg-amber-500",
										level !== "full" && level !== "warning" && "bg-neutral-500",
									)}
									style={{ width: `${Math.min(usableFraction * 100, 100)}%` }}
								/>
							</div>
						</div>

						<div
							className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3"
							data-testid="context-usage-scroll"
						>
							<ul className="space-y-1.5 pb-2">
								{contextUsage.categories.map((category) => (
									<li key={category.key}>
										<div className="flex items-center justify-between gap-2 text-xs">
											<span className="text-neutral-600">{category.label}</span>
											<span className="tabular-nums text-neutral-800">
												{formatTokenCount(category.tokens)}
											</span>
										</div>
										{category.items && category.items.length > 0 && (
											<ul className="mt-1 space-y-0.5 border-l border-neutral-100 pl-2">
												{category.items.map((item) => (
													<li
														key={item.id}
														className="flex items-center gap-2 text-[11px]"
													>
														<div className="min-w-0 flex-1">
															<TruncatedFilename
																key={item.id}
																filename={item.filename}
															/>
														</div>
														<div className="flex flex-shrink-0 items-center gap-1">
															<span className="tabular-nums text-neutral-600">
																{formatTokenCount(item.tokens)}
															</span>
															{category.key === "documents" &&
																onRemoveDocument && (
																	<Button
																		variant="ghost"
																		size="icon"
																		className="h-6 w-6"
																		aria-label={`Remove ${item.filename}`}
																		onClick={() => onRemoveDocument(item.id)}
																	>
																		<X className="h-3.5 w-3.5 text-red-600" />
																	</Button>
																)}
														</div>
													</li>
												))}
											</ul>
										)}
									</li>
								))}
							</ul>
						</div>

						<p className="shrink-0 border-t border-neutral-100 px-3 py-2 text-[10px] text-neutral-400">
							{formatTokenCount(contextUsage.reserved_output)} tokens reserved
							for the response
						</p>
					</dialog>,
					document.body,
				)
			: null;

	return (
		<>
			<div ref={triggerRef} className="relative">
				<button
					type="button"
					aria-label="Context usage"
					aria-expanded={open}
					disabled={loading || !contextUsage}
					onClick={handleToggle}
					className={cn(
						"flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors",
						contextUsage && !loading && "hover:bg-neutral-200/80",
					)}
				>
					<span className="relative flex h-5 w-5 items-center justify-center">
						<svg
							className="h-5 w-5 -rotate-90"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<circle
								cx="12"
								cy="12"
								r={RING_RADIUS}
								fill="none"
								className="stroke-neutral-200"
								strokeWidth="2.5"
							/>
							<circle
								cx="12"
								cy="12"
								r={RING_RADIUS}
								fill="none"
								className={cn(
									"transition-[stroke-dashoffset,stroke] duration-300",
									RING_COLORS[level],
								)}
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeDasharray={RING_CIRCUMFERENCE}
								strokeDashoffset={
									loading ? RING_CIRCUMFERENCE : strokeDashoffset
								}
							/>
						</svg>
						{loading && (
							<Loader2 className="absolute h-2.5 w-2.5 animate-spin text-neutral-400" />
						)}
					</span>
					<span
						className={cn(
							"text-[11px] font-medium tabular-nums",
							level === "warning" && "text-amber-700",
							level === "full" && "text-red-600",
							level !== "warning" && level !== "full" && "text-neutral-600",
						)}
					>
						{percentLabel}
					</span>
				</button>
			</div>
			{popover}
		</>
	);
}
