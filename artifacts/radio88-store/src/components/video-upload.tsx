import { userFacingError } from '@/lib/user-facing-errors';
import { useState, type ChangeEvent, type DragEvent } from 'react';
import { uploadStoreVideo } from '@workspace/api-client-react';

const MAX_VIDEO_BYTES = Math.floor(3.5 * 1024 * 1024);

export function VideoUploadField({
  value,
  onChange,
  onUploadingChange,
  disabled = false,
  label = 'Enviar vídeo MP4 para o R2',
}: {
  value: string;
  onChange: (url: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const testId = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const uploadFile = async (file: File) => {
    setMessage('');
    setIsError(false);
    if (file.type !== 'video/mp4') {
      setMessage('Escolha um vídeo MP4 codificado em H.264.');
      setIsError(true);
      return;
    }
    if (file.size < 1 || file.size > MAX_VIDEO_BYTES) {
      setMessage('O vídeo deve ter entre 1 byte e 3,5 MiB.');
      setIsError(true);
      return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    try {
      const asset = await uploadStoreVideo(file, { headers: { 'Content-Type': 'video/mp4' } });
      onChange(asset.url);
      setMessage(`Vídeo enviado · ${asset.width} × ${asset.height} px · ${asset.durationSeconds}s.`);
    } catch (error) {
      setMessage(userFacingError(error));
      setIsError(true);
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file) void uploadFile(file);
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!disabled && !uploading) {
      const file = event.dataTransfer.files?.[0];
      if (file) void uploadFile(file);
    }
  };

  return <div className={`mt-2 grid gap-2 rounded-2xl border border-dashed p-4 transition-colors ${isDragging ? 'border-foreground bg-muted' : 'border-border'}`}
    aria-busy={uploading}
    onDragEnter={event => { event.preventDefault(); if (!disabled && !uploading) setIsDragging(true); }}
    onDragOver={event => event.preventDefault()}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false); }}
    onDrop={handleDrop}
    data-testid={`dropzone-${testId}`}>
    <div className="flex flex-wrap items-center gap-3">
      <label className={`inline-flex w-fit cursor-pointer items-center rounded-full border border-border px-4 py-2.5 text-xs font-bold transition-colors hover:bg-muted ${disabled || uploading ? 'pointer-events-none opacity-60' : ''}`} data-testid={`control-${testId}`}>
        <span>{uploading ? 'Enviando vídeo…' : label}</span>
        <input type="file" accept="video/mp4" disabled={disabled || uploading} onChange={handleFile} className="sr-only" aria-label={label} data-testid={`input-${testId}`} />
      </label>
      <span className="text-xs text-muted-foreground">ou arraste um vídeo até aqui</span>
    </div>
    <p className="text-xs text-muted-foreground" data-testid={`hint-${testId}`}>MP4 H.264, sem áudio · até 15 segundos · 3,5 MiB · o arquivo ficará público.</p>
    {message && <p role={isError ? 'alert' : 'status'} className={`text-xs ${isError ? 'text-destructive' : 'text-muted-foreground'}`} data-testid={`status-${testId}`}>{message}</p>}
    {value.trim() && <div className="grid justify-items-start gap-3">
      <video src={value} controls playsInline preload="metadata" className="max-h-64 w-full max-w-xl rounded-xl border border-border bg-black" aria-label="Prévia do vídeo selecionado" data-testid={`preview-${testId}`} />
      <button type="button" disabled={disabled || uploading} onClick={() => { onChange(''); setMessage('Vídeo removido.'); setIsError(false); }}
        className="rounded-full border border-border px-3 py-2 text-xs font-bold hover:bg-muted disabled:opacity-60" aria-label="Remover vídeo selecionado" data-testid={`remove-${testId}`}>Remover vídeo</button>
    </div>}
  </div>;
}
