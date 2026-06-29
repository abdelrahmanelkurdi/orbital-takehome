import { AlertTriangle, Check, Info } from "lucide-react";
import type { GroundingDisplay } from "../lib/grounding";
import { GROUNDING_COPY } from "../lib/grounding";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "./ui/tooltip";

interface GroundingBannerProps {
	grounding: GroundingDisplay;
}

export function GroundingBanner({ grounding }: GroundingBannerProps) {
	const status = grounding.grounding_status;
	if (!status) return null;

	if (status === "grounded") {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div
						className="mb-2 flex items-center gap-1.5 text-xs text-emerald-700"
						aria-label={GROUNDING_COPY.groundedTooltip}
					>
						<Check className="h-3.5 w-3.5" aria-hidden />
						<span className="sr-only">{GROUNDING_COPY.groundedTooltip}</span>
					</div>
				</TooltipTrigger>
				<TooltipContent>{GROUNDING_COPY.groundedTooltip}</TooltipContent>
			</Tooltip>
		);
	}

	if (status === "partial" && grounding.grounding_summary) {
		return (
			<div
				className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
				role="status"
			>
				<Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
				<span>{grounding.grounding_summary}</span>
			</div>
		);
	}

	if (status === "ungrounded") {
		return (
			<div
				className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
				role="alert"
			>
				<AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
				<span>{GROUNDING_COPY.ungroundedBanner}</span>
			</div>
		);
	}

	return null;
}
