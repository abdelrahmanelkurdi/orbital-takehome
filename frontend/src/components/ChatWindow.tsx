import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Message, VerifiedCitation } from "../types";
import { ChatInput } from "./ChatInput";
import { EmptyState } from "./EmptyState";
import {
	MessageBubble,
	StreamingBubble,
	VerifyingBubble,
} from "./MessageBubble";
import type { GroundingDisplay } from "../lib/grounding";

interface ChatWindowProps {
	messages: Message[];
	loading: boolean;
	refreshing?: boolean;
	error: string | null;
	streaming: boolean;
	verifying?: boolean;
	streamingContent: string;
	pendingGrounding?: GroundingDisplay | null;
	hasDocument: boolean;
	conversationId: string | null;
	contextFull?: boolean;
	uploading?: boolean;
	onSend: (content: string) => void;
	onUpload: (files: File[]) => void;
	onCitationClick?: (citation: VerifiedCitation) => void;
}

export function ChatWindow({
	messages,
	loading,
	refreshing = false,
	error,
	streaming,
	verifying = false,
	streamingContent,
	pendingGrounding = null,
	hasDocument,
	conversationId,
	contextFull = false,
	uploading = false,
	onSend,
	onUpload,
	onCitationClick,
}: ChatWindowProps) {
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when new messages arrive or during streaming
	const messagesLength = messages.length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: messages and streamingContent are intentional triggers for auto-scroll
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messagesLength, streamingContent, verifying]);

	const inputDisabled = streaming;

	// No conversation selected
	if (!conversationId) {
		return (
			<div className="flex flex-1 items-center justify-center bg-neutral-50">
				<div className="text-center">
					<p className="text-sm text-neutral-400">
						Select a conversation or create a new one
					</p>
				</div>
			</div>
		);
	}

	// First visit only — cached chats render immediately while revalidating.
	if (loading && messages.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center bg-white">
				<Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
			</div>
		);
	}

	// Empty conversation - show upload prompt
	if (messages.length === 0 && !streaming) {
		return (
			<div className="flex flex-1 flex-col bg-white">
				<div className="flex flex-1 items-center justify-center">
					{hasDocument ? (
						<div className="text-center">
							<p className="text-sm text-neutral-500">
								Document uploaded. Ask a question to get started.
							</p>
						</div>
					) : (
						<EmptyState onUpload={onUpload} uploading={uploading} />
					)}
				</div>
				<ChatInput
					onSend={onSend}
					onUpload={onUpload}
					disabled={inputDisabled}
					contextFull={contextFull}
					uploading={uploading}
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col bg-white">
			{refreshing && (
				<div className="flex items-center justify-center gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-1">
					<Loader2 className="h-3 w-3 animate-spin text-neutral-400" />
					<span className="text-xs text-neutral-400">Updating…</span>
				</div>
			)}
			{error && (
				<div className="mx-4 mt-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
					{error}
				</div>
			)}

			<div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
				<div className="mx-auto max-w-2xl space-y-1">
					{messages.map((message) => (
						<MessageBubble
							key={message.id}
							message={message}
							onCitationClick={onCitationClick}
						/>
					))}
					{streaming && <StreamingBubble content={streamingContent} />}
					{verifying && !streaming && (
						<VerifyingBubble
							content={streamingContent}
							grounding={pendingGrounding}
							onCitationClick={onCitationClick}
						/>
					)}
				</div>
			</div>

			<ChatInput
				onSend={onSend}
				onUpload={onUpload}
				disabled={inputDisabled}
				contextFull={contextFull}
				uploading={uploading}
			/>
		</div>
	);
}
