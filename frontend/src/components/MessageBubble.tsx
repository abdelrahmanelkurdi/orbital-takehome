import { motion } from "framer-motion";
import { Bot, Loader2 } from "lucide-react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { formatCitationSummary } from "../lib/citations";
import type { GroundingDisplay } from "../lib/grounding";
import { GROUNDING_COPY } from "../lib/grounding";
import type { Message, VerifiedCitation } from "../types";
import { GroundedMessageBody } from "./GroundedMessageBody";
import { GroundingBanner } from "./GroundingBanner";

interface MessageBubbleProps {
	message: Message;
	onCitationClick?: (citation: VerifiedCitation) => void;
}

export function MessageBubble({
	message,
	onCitationClick,
}: MessageBubbleProps) {
	if (message.role === "system") {
		return (
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.2 }}
				className="flex justify-center py-2"
			>
				<p className="text-xs text-neutral-400">{message.content}</p>
			</motion.div>
		);
	}

	if (message.role === "user") {
		return (
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.2 }}
				className="flex justify-end py-1.5"
			>
				<div className="max-w-[75%] rounded-2xl rounded-br-md bg-neutral-100 px-4 py-2.5">
					<p className="whitespace-pre-wrap text-sm text-neutral-800">
						{message.content}
					</p>
				</div>
			</motion.div>
		);
	}

	const citationSummary = formatCitationSummary(message);
	const grounding: GroundingDisplay = {
		grounding_status: message.grounding_status,
		grounding_summary: message.grounding_summary,
		blocks: message.blocks,
	};

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2 }}
			className="flex gap-3 py-1.5"
		>
			<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900">
				<Bot className="h-4 w-4 text-white" />
			</div>
			<div className="min-w-0 max-w-[80%]">
				<GroundingBanner grounding={grounding} />
				<GroundedMessageBody
					content={message.content}
					grounding={grounding}
					onCitationClick={onCitationClick}
				/>
				{citationSummary && (
					<p className="mt-1.5 text-xs text-neutral-400">{citationSummary}</p>
				)}
			</div>
		</motion.div>
	);
}

interface StreamingBubbleProps {
	content: string;
}

export function StreamingBubble({ content }: StreamingBubbleProps) {
	return (
		<div className="flex gap-3 py-1.5">
			<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900">
				<Bot className="h-4 w-4 text-white" />
			</div>
			<div className="min-w-0 max-w-[80%]">
				{content ? (
					<div className="prose">
						<Streamdown mode="streaming">{content}</Streamdown>
					</div>
				) : (
					<div className="flex items-center gap-1 py-2">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
						<span
							className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400"
							style={{ animationDelay: "0.15s" }}
						/>
						<span
							className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400"
							style={{ animationDelay: "0.3s" }}
						/>
					</div>
				)}
				<span className="inline-block h-4 w-0.5 animate-pulse bg-neutral-400" />
			</div>
		</div>
	);
}

interface VerifyingBubbleProps {
	content: string;
	grounding?: GroundingDisplay | null;
	onCitationClick?: (citation: VerifiedCitation) => void;
}

/** Answer prose is readable while the judge runs; input stays enabled. */
export function VerifyingBubble({
	content,
	grounding,
	onCitationClick,
}: VerifyingBubbleProps) {
	const hasBlocks = (grounding?.blocks?.length ?? 0) > 0;

	return (
		<div className="flex gap-3 py-1.5">
			<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900">
				<Bot className="h-4 w-4 text-white" />
			</div>
			<div className="min-w-0 max-w-[80%]">
				{hasBlocks && grounding ? (
					<>
						<GroundingBanner grounding={grounding} />
						<GroundedMessageBody
							content={content}
							grounding={grounding}
							onCitationClick={onCitationClick}
						/>
					</>
				) : (
					<div className="prose">
						<Streamdown>{content}</Streamdown>
					</div>
				)}
				<p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
					<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
					{GROUNDING_COPY.checkingSources}
				</p>
			</div>
		</div>
	);
}
