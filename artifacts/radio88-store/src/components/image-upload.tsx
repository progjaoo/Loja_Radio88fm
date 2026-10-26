import { userFacingError } from '@/lib/user-facing-errors';
import { useState, type ChangeEvent, type DragEvent } from "react";
import { uploadStoreImage } from "@workspace/api-client-react";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ImageUploadField({
  value,
  onChange,
  onUploadingChange,
  disabled = false,
  label = "Enviar uma imagem para o R2",
  imageRequirements,
}: {
  value: string;
  onChange: (url: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  label?: string;
  imageRequirements?: { width: number; height: number; minWidth: number; minHeight: number };
}) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const testId = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const uploadFile = async (file: File) => {
    setMessage("");
    setIsError(false);

    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setMessage("Escolha uma imagem JPG, PNG ou WebP.");
      setIsError(true);
      return;
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      setMessage("A imagem deve ter entre 1 byte e 8 MB.");
      setIsError(true);
      return;
    }

    setUploading(true);
    onUploadingChange?.(true);
    try {
      if (imageRequirements) {
        const objectUrl = URL.createObjectURL(file);
        try {
          const image = new Image();
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("Não foi possível ler a imagem. Escolha outro arquivo."));
            image.src = objectUrl;
          });
          const { width, height, minWidth, minHeight } = imageRequirements;
          if (image.naturalWidth < minWidth || image.naturalHeight < minHeight) {
            setMessage(`A imagem tem ${image.naturalWidth} × ${image.naturalHeight} px. Use pelo menos ${minWidth} × ${minHeight} px.`);
            setIsError(true);
            return;
          }
          // Allow only pixel-rounding differences, not a visibly different aspect ratio.
          if (Math.abs(image.naturalHeight - image.naturalWidth * height / width) > 1) {
            setMessage(`A imagem tem ${image.naturalWidth} × ${image.naturalHeight} px. Para o carrossel, envie uma arte 16:9, como ${width} × ${height} px, sem margens brancas.`);
            setIsError(true);
            return;
          }
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
      const asset = await uploadStoreImage(file, {
        headers: { "Content-Type": file.type },
      });
      onChange(asset.url);
      setMessage("Imagem enviada para o Cloudflare R2.");
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
    input.value = "";
    if (file) void uploadFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled || uploading) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  };

  return (
    <div
      className={`mt-2 grid gap-2 rounded-2xl border border-dashed p-4 transition-colors ${isDragging ? "border-foreground bg-muted" : "border-border"}`}
      aria-busy={uploading}
      onDragEnter={(event) => { event.preventDefault(); if (!disabled && !uploading) setIsDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
      }}
      onDrop={handleDrop}
      data-testid={`dropzone-${testId}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label
          data-testid={`control-${testId}`}
          className={`inline-flex w-fit cursor-pointer items-center rounded-full border border-border px-4 py-2.5 text-xs font-bold transition-colors hover:bg-muted ${disabled || uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          <span>{uploading ? "Enviando imagem…" : label}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled || uploading}
            onChange={handleFile}
            data-testid={`input-${testId}`}
            className="sr-only"
            aria-label={label}
          />
        </label>
        <span className="text-xs text-muted-foreground">ou arraste uma imagem até aqui</span>
      </div>
      <p data-testid={`hint-${testId}`} className="text-xs text-muted-foreground">JPG, PNG ou WebP · até 8 MB · a imagem ficará pública.</p>
      {imageRequirements && <p className="text-xs text-muted-foreground">Padrão do carrossel: {imageRequirements.width} × {imageRequirements.height} px (16:9). Mínimo: {imageRequirements.minWidth} × {imageRequirements.minHeight} px na mesma proporção. Arquivos fora do padrão não serão enviados.</p>}
      {message && (
        <p
          role={isError ? "alert" : "status"}
          data-testid={`status-${testId}`}
          className={`text-xs ${isError ? "text-destructive" : "text-muted-foreground"}`}
        >
          {message}
        </p>
      )}
      {value.trim() && (
        <div className="flex flex-wrap items-start gap-3">
          <img
            src={value}
            alt="Prévia da imagem selecionada"
            className="max-h-32 w-fit max-w-full rounded-xl border border-border object-contain"
            loading="lazy"
            data-testid={`preview-${testId}`}
          />
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => { onChange(""); setMessage("Imagem removida."); setIsError(false); }}
            className="rounded-full border border-border px-3 py-2 text-xs font-bold hover:bg-muted disabled:opacity-60"
            aria-label="Remover imagem selecionada"
            data-testid={`remove-${testId}`}
          >
            Remover imagem
          </button>
        </div>
      )}
    </div>
  );
}
