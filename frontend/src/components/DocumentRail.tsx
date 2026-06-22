import {
	AlertCircle,
	ChevronDown,
	ChevronUp,
	FileText,
	Loader2,
	Plus,
	X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { UploadQueueItem } from "../hooks/use-documents";
import { formatPageCount, formatUploadTime } from "../lib/format";
import type { ContextUsage, Document } from "../types";
import { ContextMeter } from "./ContextMeter";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface DocumentRailProps {
	documents: Document[];
	activeDocumentId: string | null;
	citedDocumentIds: Set<string>;
	uploading: boolean;
	uploadQueue: UploadQueueItem[];
	conversationId: string | null;
	contextUsage: ContextUsage | null;
	contextUsageLoading: boolean;
	onSelect: (documentId: string) => void;
	onUpload: (files: File[]) => void;
	onRemove: (documentId: string) => void;
}

function collectPdfFiles(fileList: FileList | File[]): File[] {
	return Array.from(fileList).filter(
		(file) =>
			file.type === "application/pdf" ||
			file.name.toLowerCase().endsWith(".pdf"),
	);
}

export function DocumentRail({
	documents,
	activeDocumentId,
	citedDocumentIds,
	uploading,
	uploadQueue,
	conversationId,
	contextUsage,
	contextUsageLoading,
	onSelect,
	onUpload,
	onRemove,
}: DocumentRailProps) {
	const [collapsed, setCollapsed] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleAddClick = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const files = collectPdfFiles(event.target.files ?? []);
			if (files.length > 0) {
				onUpload(files);
			}
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		},
		[onUpload],
	);

	const header = (
		<div className="flex min-w-0 items-center gap-1 px-2 py-2">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 flex-shrink-0"
						onClick={() => setCollapsed((prev) => !prev)}
						aria-label={
							collapsed ? "Expand document rail" : "Collapse document rail"
						}
					>
						{collapsed ? (
							<ChevronDown className="h-4 w-4 text-neutral-500" />
						) : (
							<ChevronUp className="h-4 w-4 text-neutral-500" />
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{collapsed ? "Show documents" : "Hide documents"}
				</TooltipContent>
			</Tooltip>

			<h2 className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
				Documents
				{collapsed && documents.length > 0 && (
					<span className="ml-1.5 font-normal normal-case text-neutral-400">
						· {documents.length}
					</span>
				)}
			</h2>

			<div className="ml-auto flex flex-shrink-0 items-center gap-1">
				<ContextMeter
					contextUsage={contextUsage}
					loading={contextUsageLoading}
					onRemoveDocument={onRemove}
				/>
				{!collapsed && (
					<Button
						variant="secondary"
						size="sm"
						className="h-7 gap-1 px-2 text-xs"
						disabled={!conversationId || uploading}
						onClick={handleAddClick}
					>
						<Plus className="h-3.5 w-3.5" />
						Add
					</Button>
				)}
			</div>
			<input
				ref={fileInputRef}
				type="file"
				accept=".pdf,application/pdf"
				multiple
				className="hidden"
				onChange={handleFileChange}
			/>
		</div>
	);

	if (collapsed) {
		return (
			<div className="relative z-10 shrink-0 border-b border-neutral-200 bg-neutral-50">
				{header}
			</div>
		);
	}

	return (
		<div className="relative z-10 flex max-h-44 shrink-0 flex-col border-b border-neutral-200 bg-neutral-50">
			{header}

			<div className="min-h-0 overflow-x-auto overflow-y-hidden px-2 pb-2">
				<div className="flex min-w-min gap-2">
					{documents.length === 0 && uploadQueue.length === 0 && (
						<div className="flex min-w-[14rem] flex-1 items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-4">
							<div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100">
								<FileText className="h-4 w-4 text-neutral-400" />
							</div>
							<div className="min-w-0 text-left">
								<p className="text-sm font-medium text-neutral-600">
									No documents yet
								</p>
								<p className="text-xs text-neutral-400">
									Add PDFs or drag them into the chat area.
								</p>
							</div>
						</div>
					)}

					{documents.map((document) => {
						const isActive = document.id === activeDocumentId;
						const isCited = citedDocumentIds.has(document.id);
						const extractionFailed = !document.has_extracted_text;

						return (
							<div
								key={document.id}
								className={`group relative w-44 flex-shrink-0 rounded-lg border bg-white transition-colors ${
									isActive
										? "border-neutral-900 ring-1 ring-inset ring-neutral-900"
										: extractionFailed
											? "border-amber-200 hover:border-amber-300"
											: "border-neutral-200 hover:border-neutral-300"
								}`}
							>
								<button
									type="button"
									className="w-full px-3 py-2.5 text-left"
									onClick={() => onSelect(document.id)}
								>
									<div className="flex min-w-0 items-start gap-1.5">
										{extractionFailed && (
											<Tooltip>
												<TooltipTrigger asChild>
													<span className="mt-0.5 flex-shrink-0">
														<AlertCircle className="h-3.5 w-3.5 text-amber-600" />
													</span>
												</TooltipTrigger>
												<TooltipContent className="max-w-xs">
													Text not extracted — the AI cannot reference this file
												</TooltipContent>
											</Tooltip>
										)}
										<Tooltip>
											<TooltipTrigger asChild>
												<span className="block min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">
													{document.filename}
												</span>
											</TooltipTrigger>
											<TooltipContent className="max-w-xs">
												{document.filename}
											</TooltipContent>
										</Tooltip>
									</div>
									<p className="mt-1 text-xs text-neutral-400">
										{formatPageCount(document.page_count)} ·{" "}
										{formatUploadTime(document.uploaded_at)}
									</p>
									{isCited && (
										<span className="mt-1.5 inline-block rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
											Cited
										</span>
									)}
								</button>
								<Button
									variant="ghost"
									size="icon"
									className="absolute top-1 right-1 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
									aria-label={`Remove ${document.filename}`}
									onClick={() => onRemove(document.id)}
								>
									<X className="h-3.5 w-3.5 text-red-600" />
								</Button>
							</div>
						);
					})}

					{uploadQueue.map((item) => (
						<div
							key={item.key}
							className={`w-44 flex-shrink-0 rounded-lg border px-3 py-2.5 ${
								item.status === "error"
									? "border-red-200 bg-red-50"
									: "border-neutral-200 bg-white"
							}`}
						>
							<div className="flex min-w-0 items-center gap-2">
								{(item.status === "pending" || item.status === "uploading") && (
									<Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-neutral-400" />
								)}
								{item.status === "error" && (
									<AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
								)}
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="block min-w-0 flex-1 truncate text-sm text-neutral-700">
											{item.filename}
										</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-xs">
										{item.filename}
									</TooltipContent>
								</Tooltip>
							</div>
							<p
								className={`mt-1 text-xs ${
									item.status === "error" ? "text-red-600" : "text-neutral-400"
								}`}
							>
								{item.status === "uploading" && "Uploading…"}
								{item.status === "pending" && "Waiting…"}
								{item.status === "error" && (item.error ?? "Upload failed")}
							</p>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
