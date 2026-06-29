import { FileText, Paperclip, X } from "lucide-react";
import { useState } from "react";
import type { BlockBasis, VerifiedCitation } from "../types";
import { isCitationNavigable } from "../lib/citation-jump";
import { getCitationChipTooltip } from "../lib/grounding";
import { cn } from "../lib/utils";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "./ui/tooltip";

interface CitationChipProps {
	basis: BlockBasis;
	citation?: VerifiedCitation | null;
	/** When set, tooltip open state is controlled by the parent (for chip groups). */
	tooltipOpen?: boolean;
	onPointerEnter?: () => void;
	onPointerLeave?: () => void;
	onCitationClick?: (citation: VerifiedCitation) => void;
}

function chipIconClass(basis: BlockBasis, verified: boolean): string {
	if (basis === "general_knowledge") {
		return "border-neutral-200 bg-neutral-100 text-neutral-500";
	}
	if (basis === "not_in_documents") {
		return "border-red-200 bg-red-50 text-red-700";
	}
	if (basis === "mixed" || (basis === "document" && !verified)) {
		return "border-amber-200 bg-amber-50 text-amber-700";
	}
	return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export function CitationChip({
	basis,
	citation = null,
	tooltipOpen,
	onPointerEnter,
	onPointerLeave,
	onCitationClick,
}: CitationChipProps) {
	const verified = citation?.verified ?? basis !== "document";
	const tooltip = getCitationChipTooltip(basis, citation);
	const navigable =
		isCitationNavigable(basis, citation) && onCitationClick != null && citation != null;
	const Icon =
		basis === "general_knowledge"
			? FileText
			: basis === "not_in_documents"
				? X
				: Paperclip;
	const controlled = tooltipOpen !== undefined;

	return (
		<Tooltip open={controlled ? tooltipOpen : undefined}>
			<TooltipTrigger asChild>
				<span
					className={cn(
						"inline-flex h-6 w-6 items-center justify-center rounded-md border",
						chipIconClass(basis, verified),
						navigable && "cursor-pointer hover:opacity-80",
					)}
					role={navigable ? "button" : "img"}
					tabIndex={navigable ? 0 : undefined}
					aria-label={tooltip}
					onPointerEnter={onPointerEnter}
					onPointerLeave={onPointerLeave}
					onClick={
						navigable
							? () => {
									onCitationClick(citation);
								}
							: undefined
					}
					onKeyDown={
						navigable
							? (event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onCitationClick(citation);
									}
								}
							: undefined
					}
				>
					<Icon className="h-3.5 w-3.5" aria-hidden />
				</span>
			</TooltipTrigger>
			<TooltipContent key={tooltip} className="max-w-xs whitespace-pre-wrap">
				{tooltip}
			</TooltipContent>
		</Tooltip>
	);
}

/** Chips for a block — one GK chip, or one per document citation. */
export function BlockCitationChips({
	basis,
	citations,
	onCitationClick,
}: {
	basis: BlockBasis;
	citations: VerifiedCitation[];
	onCitationClick?: (citation: VerifiedCitation) => void;
}) {
	const [openKey, setOpenKey] = useState<string | null>(null);

	if (basis === "not_in_documents") {
		return (
			<span className="inline-flex gap-1">
				<CitationChip basis="not_in_documents" />
			</span>
		);
	}

	if (basis === "general_knowledge") {
		return (
			<span className="inline-flex gap-1">
				<CitationChip basis="general_knowledge" />
			</span>
		);
	}

	if (citations.length === 0) {
		return null;
	}

	const citationKey = (citation: VerifiedCitation) =>
		`${citation.document_id}-${citation.label}-${citation.document_ordinal}`;

	return (
		<span className="inline-flex flex-wrap gap-1">
			{citations.map((citation) => {
				const key = citationKey(citation);
				return (
					<CitationChip
						key={key}
						basis={basis}
						citation={citation}
						tooltipOpen={openKey === key}
						onPointerEnter={() => setOpenKey(key)}
						onPointerLeave={() =>
							setOpenKey((current: string | null) =>
								current === key ? null : current,
							)
						}
						onCitationClick={onCitationClick}
					/>
				);
			})}
		</span>
	);
}
