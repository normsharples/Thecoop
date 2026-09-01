import { useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2 } from "lucide-react";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useSetRecipePhoto } from "@/hooks/useRecipes";

/**
 * Managers own the photos, superadmin owns the spec. Postgres has no
 * column-level RLS, so the write goes through the recipe_set_photo RPC.
 */
export function RecipePhotoButton({
  recipeId,
  hasPhoto,
}: {
  recipeId: string;
  hasPhoto: boolean;
}) {
  const upload = useFileUpload({ bucket: "recipe-media", folder: "hero" });
  const setPhoto = useSetRecipePhoto();
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const { path } = await upload.upload(file);
      await setPhoto.mutateAsync({ recipeId, path });
      toast.success("Photo updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the photo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary hover:underline">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
      {hasPhoto ? "Replace photo" : "Add a photo"}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </label>
  );
}
