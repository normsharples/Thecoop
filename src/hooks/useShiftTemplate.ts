import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ShiftTemplate, ShiftTemplateLine } from "@/types";

export interface TemplateLineInput {
  id?: string;
  day_of_week: number; // 0 = Monday … 6 = Sunday
  employee_id: string | null;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  position_id: string | null;
  note: string | null;
}

/**
 * A single reusable weekly roster template per venue (the first
 * `shift_templates` row for the store, created on demand). Its
 * `shift_template_lines` are day-of-week based rather than dated, so the same
 * template can be generated onto any week.
 */
export function useShiftTemplate(restaurantId: string | null) {
  const qc = useQueryClient();

  const { data: template = null, isLoading: loadingT } = useQuery({
    queryKey: ["shift-template", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await supabase
        .from("shift_templates")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as ShiftTemplate | null) ?? null;
    },
    enabled: !!restaurantId,
  });

  const { data: lines = [], isLoading: loadingL } = useQuery({
    queryKey: ["shift-template-lines", template?.id],
    queryFn: async () => {
      if (!template) return [];
      const { data, error } = await supabase
        .from("shift_template_lines")
        .select("*")
        .eq("template_id", template.id)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return data as ShiftTemplateLine[];
    },
    enabled: !!template,
  });

  const ensureTemplate = async (): Promise<string> => {
    if (template) return template.id;
    if (!restaurantId) throw new Error("No store selected");
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("shift_templates")
      .insert({
        restaurant_id: restaurantId,
        name: "Weekly template",
        created_by: userData?.user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["shift-template", restaurantId] });
    return (data as { id: string }).id;
  };

  const saveLine = useMutation({
    mutationFn: async (input: TemplateLineInput) => {
      const templateId = await ensureTemplate();
      const { error } = await supabase.from("shift_template_lines").upsert({
        ...(input.id ? { id: input.id } : {}),
        template_id: templateId,
        day_of_week: input.day_of_week,
        employee_id: input.employee_id,
        start_time: input.start_time,
        end_time: input.end_time,
        unpaid_break_minutes: input.unpaid_break_minutes,
        position_id: input.position_id,
        note: input.note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-template"] });
      qc.invalidateQueries({ queryKey: ["shift-template-lines"] });
    },
  });

  const removeLine = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shift_template_lines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-template-lines"] }),
  });

  return {
    template,
    lines,
    isLoading: loadingT || loadingL,
    saveLine: saveLine.mutateAsync,
    isSavingLine: saveLine.isPending,
    removeLine: removeLine.mutateAsync,
  };
}
