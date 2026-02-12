import { UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

interface UploadDropzoneProps {
  onFiles: (files: File[]) => Promise<void> | void;
  disabled?: boolean;
}

export function UploadDropzone({ onFiles, disabled }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }
    await onFiles(Array.from(fileList));
  };

  return (
    <div
      className={`rounded-2xl border border-dashed px-4 py-4 transition ${
        isDragActive ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/20 bg-white/5'
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragActive(false);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setIsDragActive(false);
        await handleFiles(event.dataTransfer.files);
      }}
      aria-label="Upload dropzone"
    >
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        multiple
        disabled={disabled}
        onChange={async (event) => {
          await handleFiles(event.target.files);
          event.currentTarget.value = '';
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-200">
          <UploadCloud size={18} className="text-cyan-300" />
          Drag and drop files here or use upload button.
        </div>
        <Button type="button" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
          Upload
        </Button>
      </div>
    </div>
  );
}
