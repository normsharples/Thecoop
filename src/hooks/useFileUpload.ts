import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const MAX_SIZE_BYTES = 1024 * 1024; // 1 MB
const MAX_DIMENSION = 1920;

// ── Client-side image compression via Canvas ──────────────────────────────────

async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Scale down if either dimension exceeds MAX_DIMENSION
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height / width) * MAX_DIMENSION);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width / height) * MAX_DIMENSION);
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas context unavailable")); return; }

      ctx.drawImage(img, 0, 0, width, height);

      // Try quality levels until under MAX_SIZE_BYTES
      const tryQuality = (quality: number) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error("Compression failed")); return; }
            if (blob.size <= MAX_SIZE_BYTES || quality <= 0.1) {
              resolve(blob);
            } else {
              tryQuality(Math.max(0.1, quality - 0.1));
            }
          },
          "image/jpeg",
          quality
        );
      };

      tryQuality(0.85);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UploadResult {
  url: string;
  path: string;
}

export interface UseFileUploadOptions {
  bucket: string;
  folder?: string;
  accept?: string;
  maxSizeMB?: number;
}

export function useFileUpload(options: UseFileUploadOptions) {
  const { bucket, folder = "", accept = "image/*" } = options;

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File): Promise<UploadResult> => {
      setError(null);
      setUploading(true);
      setProgress(0);

      try {
        // Generate a local preview immediately
        const localUrl = URL.createObjectURL(file);
        setPreviewUrl(localUrl);
        setProgress(20);

        // Compress if it's an image and over 1 MB
        let uploadBlob: Blob = file;
        if (file.type.startsWith("image/") && file.size > MAX_SIZE_BYTES) {
          uploadBlob = await compressImage(file);
        }
        setProgress(60);

        // Build storage path
        const ext = file.name.split(".").pop() ?? "jpg";
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const path = folder ? `${folder}/${filename}` : filename;

        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(path, uploadBlob, {
            contentType: uploadBlob.type || "image/jpeg",
            upsert: false,
          });

        if (uploadError) throw uploadError;
        setProgress(90);

        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
        setProgress(100);

        return { url: urlData.publicUrl, path };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setError(msg);
        setPreviewUrl(null);
        throw err;
      } finally {
        setUploading(false);
      }
    },
    [bucket, folder]
  );

  const remove = useCallback(
    async (path: string) => {
      await supabase.storage.from(bucket).remove([path]);
      setPreviewUrl(null);
    },
    [bucket]
  );

  const clearPreview = useCallback(() => {
    setPreviewUrl(null);
    setError(null);
    setProgress(0);
  }, []);

  return { upload, remove, uploading, progress, previewUrl, setPreviewUrl, error, accept };
}
