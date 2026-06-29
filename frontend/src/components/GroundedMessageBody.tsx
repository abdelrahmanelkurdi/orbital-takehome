import { Streamdown } from "streamdown";
import type { GroundingDisplay } from "../lib/grounding";
import type { GroundingBlock, VerifiedCitation } from "../types";
import { BlockCitationChips } from "./CitationChip";

interface GroundedMessageBodyProps {
	content: string;
	grounding?: GroundingDisplay | null;
	onCitationClick?: (citation: VerifiedCitation) => void;
}

function GroundedBlock({
	block,
	onCitationClick,
}: {
	block: GroundingBlock;
	onCitationClick?: (citation: VerifiedCitation) => void;
}) {
	return (
		<div className="py-0.5">
			<div className="flex items-start justify-between gap-2">
				<div className="prose min-w-0 flex-1">
					<Streamdown>{block.text}</Streamdown>
				</div>
				<span className="mt-1 flex flex-shrink-0 gap-1">
					<BlockCitationChips
						basis={block.basis}
						citations={block.citations}
						onCitationClick={onCitationClick}
					/>
				</span>
			</div>
		</div>
	);
}

export function GroundedMessageBody({
	content,
	grounding,
	onCitationClick,
}: GroundedMessageBodyProps) {
	const blocks = grounding?.blocks;
	if (!blocks || blocks.length === 0) {
		return (
			<div className="prose">
				<Streamdown>{content}</Streamdown>
			</div>
		);
	}

	const sorted = [...blocks].sort((a, b) => a.block_index - b.block_index);

	return (
		<div className="space-y-1">
			{sorted.map((block) => (
				<GroundedBlock
					key={block.block_index}
					block={block}
					onCitationClick={onCitationClick}
				/>
			))}
		</div>
	);
}
