import { useCallback, useState } from "react";
import type { UploadQueueItem } from "../hooks/use-documents";
import type { ViewerJumpRequest } from "../lib/citation-jump";
import type { ContextUsage, Document } from "../types";
import { DocumentRail } from "./DocumentRail";
import { DocumentViewer } from "./DocumentViewer";

const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 480;

interface DocumentPanelProps {
	documents: Document[];
	activeDocument: Document | null;
	activeDocumentId: string | null;
	citedDocumentIds: Set<string>;
	uploading: boolean;
	uploadQueue: UploadQueueItem[];
	conversationId: string | null;
	contextUsage: ContextUsage | null;
	contextUsageLoading: boolean;
	jumpRequest?: ViewerJumpRequest | null;
	onSelect: (documentId: string) => void;
	onUpload: (files: File[]) => void;
	onRemove: (documentId: string) => void;
}

export function DocumentPanel({
	activeDocument,
	jumpRequest = null,
	...railProps
}: DocumentPanelProps) {
	const [width, setWidth] = useState(DEFAULT_WIDTH);
	const [dragging, setDragging] = useState(false);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setDragging(true);

			const startX = e.clientX;
			const startWidth = width;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const delta = startX - moveEvent.clientX;
				setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta)));
			};

			const handleMouseUp = () => {
				setDragging(false);
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
			};

			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		},
		[width],
	);

	return (
		<div
			style={{ width }}
			className="relative flex h-full shrink-0 flex-col border-l border-neutral-200 bg-neutral-50"
		>
			<div
				className={`absolute top-0 left-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-neutral-300 ${
					dragging ? "bg-neutral-400" : ""
				}`}
				onMouseDown={handleMouseDown}
			/>
			<DocumentRail {...railProps} />
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<DocumentViewer
					document={activeDocument}
					containerWidth={width}
					jumpRequest={jumpRequest}
				/>
			</div>
		</div>
	);
}
