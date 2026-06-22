import { useCallback, useMemo } from "react";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatWindow } from "./components/ChatWindow";
import { DocumentDropZone } from "./components/DocumentDropZone";
import { DocumentPanel } from "./components/DocumentPanel";
import { TooltipProvider } from "./components/ui/tooltip";
import { useContextUsage } from "./hooks/use-context-usage";
import { useConversations } from "./hooks/use-conversations";
import { useDocuments } from "./hooks/use-documents";
import { useMessages } from "./hooks/use-messages";
import { getCitedDocumentIds } from "./lib/citations";

export default function App() {
	const {
		conversations,
		selectedId,
		loading: conversationsLoading,
		create,
		select,
		remove,
		refresh: refreshConversations,
	} = useConversations();

	const {
		messages,
		loading: messagesLoading,
		refreshing: messagesRefreshing,
		error: messagesError,
		streaming,
		streamingContent,
		send,
	} = useMessages(selectedId);

	const {
		documents,
		activeDocumentId,
		activeDocument,
		setActiveDocument,
		upload,
		remove: removeDocument,
		uploading,
		uploadQueue,
		refresh: refreshDocuments,
		hasDocuments,
	} = useDocuments(selectedId);

	const {
		refreshContextUsage,
		contextUsage,
		contextUsageLoading,
		contextFull,
	} = useContextUsage(selectedId, documents);

	const citedDocumentIds = useMemo(
		() => getCitedDocumentIds(messages),
		[messages],
	);

	const handleSend = useCallback(
		async (content: string) => {
			await send(content);
			refreshConversations();
			void refreshContextUsage();
		},
		[send, refreshConversations, refreshContextUsage],
	);

	const handleUpload = useCallback(
		async (files: File[]) => {
			const { uploaded } = await upload(files);
			if (uploaded.length > 0) {
				refreshDocuments();
				refreshConversations();
				void refreshContextUsage();
			}
		},
		[upload, refreshDocuments, refreshConversations, refreshContextUsage],
	);

	const handleRemoveDocument = useCallback(
		async (documentId: string) => {
			const removed = await removeDocument(documentId);
			if (removed) {
				refreshConversations();
				void refreshContextUsage();
			}
		},
		[removeDocument, refreshConversations, refreshContextUsage],
	);

	const handleCreate = useCallback(async () => {
		await create();
	}, [create]);

	return (
		<TooltipProvider delayDuration={200}>
			<div className="flex h-screen bg-neutral-50">
				<ChatSidebar
					conversations={conversations}
					selectedId={selectedId}
					loading={conversationsLoading}
					onSelect={select}
					onCreate={handleCreate}
					onDelete={remove}
				/>

				<DocumentDropZone enabled={Boolean(selectedId)} onUpload={handleUpload}>
					<ChatWindow
						messages={messages}
						loading={messagesLoading}
						refreshing={messagesRefreshing}
						error={messagesError}
						streaming={streaming}
						streamingContent={streamingContent}
						hasDocument={hasDocuments}
						conversationId={selectedId}
						contextFull={contextFull}
						onSend={handleSend}
						onUpload={handleUpload}
						uploading={uploading}
					/>

					{selectedId && (
						<DocumentPanel
							documents={documents}
							activeDocument={activeDocument}
							activeDocumentId={activeDocumentId}
							citedDocumentIds={citedDocumentIds}
							uploading={uploading}
							uploadQueue={uploadQueue}
							conversationId={selectedId}
							contextUsage={contextUsage}
							contextUsageLoading={contextUsageLoading}
							onSelect={setActiveDocument}
							onUpload={handleUpload}
							onRemove={handleRemoveDocument}
						/>
					)}
				</DocumentDropZone>
			</div>
		</TooltipProvider>
	);
}
