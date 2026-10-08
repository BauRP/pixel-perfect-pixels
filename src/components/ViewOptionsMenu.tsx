// Shared 3-dot view menu: grid column count + advanced sorting.
//
// Used both on the gallery home screen (folder grid) and inside a folder
// (media grid). Extra route-specific entries can be injected through
// `extraItems`.
//
// Layout note: the menu is anchored to the RIGHT edge of the screen and all
// option groups ("Сортировка", "Число столбцов") are rendered INLINE, expanding
// strictly DOWNWARDS. Flyout submenus used to open to the right and clip off
// the phone's right edge; inline groups can never overflow horizontally.

import { useState, type ReactNode } from "react";
import {
  MoreVertical, Check, Columns3, ArrowDownUp, ChevronDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n";
import {
  useViewPrefs, type Columns, type Scope, type SortField, type SortDir,
} from "@/lib/view-prefs";

/** Inline, collapsible group header — expands the options below it. */
function GroupHeader({
  icon, label, open, onToggle,
}: { icon: ReactNode; label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="tap flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <ChevronDown
        size={16}
        className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

export function ViewOptionsMenu({
  scope, showSize = false, extraItems,
}: {
  scope: Scope;
  /** "Размер" only makes sense for media lists. */
  showSize?: boolean;
  extraItems?: ReactNode;
}) {
  const t = useT();
  const [prefs, setPrefs] = useViewPrefs(scope);
  const [openGroup, setOpenGroup] = useState<"sort" | "cols" | null>(null);

  const toggle = (g: "sort" | "cols") =>
    setOpenGroup((cur) => (cur === g ? null : g));

  const fields: { id: SortField; label: string }[] = [
    { id: "created", label: t("sort_created") },
    { id: "name", label: t("sort_by_name") },
    ...(showSize ? [{ id: "size" as SortField, label: t("sort_by_size") }] : []),
    { id: "modified", label: t("sort_modified") },
  ];

  const dirs: { id: SortDir; label: string }[] = [
    { id: "asc", label: t("sort_asc") },
    { id: "desc", label: t("sort_desc") },
  ];

  return (
    <DropdownMenu
      onOpenChange={(o) => {
        if (!o) setOpenGroup(null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className="tap grid h-8 w-8 place-items-center rounded-full"
          style={{ background: "var(--color-surface)" }}
          aria-label={t("menu")}
        >
          <MoreVertical size={20} />
        </button>
      </DropdownMenuTrigger>

      {/* align="end" anchors the panel to the right edge; the transform origin
          follows Radix's computed side/align, i.e. top-right here. */}
      <DropdownMenuContent
        align="end"
        alignOffset={-4}
        className="rounded-2xl min-w-[220px] max-w-[calc(100vw-1rem)]"
      >
        <GroupHeader
          icon={<ArrowDownUp size={16} />}
          label={t("sort")}
          open={openGroup === "sort"}
          onToggle={() => toggle("sort")}
        />
        {openGroup === "sort" && (
          <div className="pl-3">
            {fields.map((f) => (
              <DropdownMenuItem
                key={f.id}
                onSelect={(e) => {
                  e.preventDefault();
                  setPrefs({ field: f.id });
                }}
                className="justify-between"
              >
                {f.label}
                {prefs.field === f.id && <Check size={15} />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {dirs.map((d) => (
              <DropdownMenuItem
                key={d.id}
                onSelect={(e) => {
                  e.preventDefault();
                  setPrefs({ dir: d.id });
                }}
                className="justify-between"
              >
                {d.label}
                {prefs.dir === d.id && <Check size={15} />}
              </DropdownMenuItem>
            ))}
          </div>
        )}

        <DropdownMenuSeparator />

        <GroupHeader
          icon={<Columns3 size={16} />}
          label={t("columns_count")}
          open={openGroup === "cols"}
          onToggle={() => toggle("cols")}
        />
        {openGroup === "cols" && (
          <div className="pl-3">
            {([2, 3, 4] as Columns[]).map((c) => (
              <DropdownMenuItem
                key={c}
                onSelect={(e) => {
                  e.preventDefault();
                  setPrefs({ columns: c });
                }}
                className="justify-between"
              >
                {c}
                {prefs.columns === c && <Check size={15} />}
              </DropdownMenuItem>
            ))}
          </div>
        )}

        {extraItems ? <DropdownMenuSeparator /> : null}
        {extraItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
