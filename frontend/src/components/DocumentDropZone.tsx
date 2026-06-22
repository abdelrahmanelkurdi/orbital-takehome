import { Upload } from "lucide-react";
import { type DragEvent, type ReactNode, useCallback, useState } from "react";

interface DocumentDropZoneProps {
	enabled: boolean;
	onUpload: (files: File[]) => void;
	children: ReactNode;
}

function collectPdfFiles(fileList: FileList | File[]): File[] {
	return Array.from(fileList).filter(
		(file) =>
			file.type === "application/pdf" ||
			file.name.toLowerCase().endsWith(".pdf"),
	);
}

export function DocumentDropZone({
	enabled,
	onUpload,
	children,
}: DocumentDropZoneProps) {
	const [dragOver, setDragOver] = useState(false);

	const handleDragOver = useCallback(
		(event: DragEvent) => {
			if (!enabled) return;
			event.preventDefault();
			setDragOver(true);
		},
		[enabled],
	);

	const handleDragLeave = useCallback((event: DragEvent) => {
		event.preventDefault();
		setDragOver(false);
	}, []);

	const handleDrop = useCallback(
		(event: DragEvent) => {
			event.preventDefault();
			setDragOver(false);
			if (!enabled) return;

			const files = collectPdfFiles(event.dataTransfer.files);
			if (files.length > 0) {
				onUpload(files);
			}
		},
		[enabled, onUpload],
	);

	return (
		<div
			className="relative flex min-w-0 flex-1 flex-row"
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{children}
			{enabled && dragOver && (
				<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-neutral-900/5 backdrop-blur-[1px]">
					<div className="rounded-xl border-2 border-dashed border-neutral-400 bg-white/95 px-8 py-6 text-center shadow-sm">
						<Upload className="mx-auto mb-2 h-8 w-8 text-neutral-500" />
						<p className="text-sm font-medium text-neutral-700">
							Drop PDFs to add documents
						</p>
						<p className="mt-1 text-xs text-neutral-400">
							Multiple files supported
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
