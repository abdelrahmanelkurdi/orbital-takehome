import { Loader2, Upload } from "lucide-react";
import { type DragEvent, useCallback, useRef, useState } from "react";

interface DocumentUploadProps {
	onUpload: (files: File[]) => void;
	uploading?: boolean;
}

function collectPdfFiles(fileList: FileList | File[]): File[] {
	return Array.from(fileList).filter(
		(file) =>
			file.type === "application/pdf" ||
			file.name.toLowerCase().endsWith(".pdf"),
	);
}

export function DocumentUpload({
	onUpload,
	uploading = false,
}: DocumentUploadProps) {
	const [dragOver, setDragOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleFiles = useCallback(
		(files: File[]) => {
			const pdfs = collectPdfFiles(files);
			if (pdfs.length > 0) {
				onUpload(pdfs);
			}
		},
		[onUpload],
	);

	const handleDragOver = useCallback((e: DragEvent) => {
		e.preventDefault();
		setDragOver(true);
	}, []);

	const handleDragLeave = useCallback((e: DragEvent) => {
		e.preventDefault();
		setDragOver(false);
	}, []);

	const handleDrop = useCallback(
		(e: DragEvent) => {
			e.preventDefault();
			setDragOver(false);
			handleFiles(Array.from(e.dataTransfer.files));
		},
		[handleFiles],
	);

	const handleClick = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			handleFiles(Array.from(e.target.files ?? []));
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		},
		[handleFiles],
	);

	return (
		<button
			type="button"
			className={`w-full max-w-md cursor-pointer rounded-xl border-2 border-dashed px-8 py-10 text-center transition-colors ${
				dragOver
					? "border-neutral-400 bg-neutral-100"
					: "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"
			}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			onClick={handleClick}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".pdf,application/pdf"
				multiple
				className="hidden"
				onChange={handleFileChange}
			/>

			{uploading ? (
				<div className="flex flex-col items-center">
					<Loader2 className="mb-3 h-10 w-10 animate-spin text-neutral-400" />
					<p className="text-sm font-medium text-neutral-600">
						Uploading documents...
					</p>
				</div>
			) : (
				<div className="flex flex-col items-center">
					<Upload className="mb-3 h-10 w-10 text-neutral-400" />
					<p className="text-sm font-medium text-neutral-600">
						Upload PDF documents
					</p>
					<p className="mt-1 text-xs text-neutral-400">
						Click or drag and drop · multiple files supported
					</p>
				</div>
			)}
		</button>
	);
}
