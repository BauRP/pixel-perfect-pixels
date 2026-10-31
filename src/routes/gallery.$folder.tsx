import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, ScreenHeader } from "@/components/AppShell";
import { deviceScan, useDeviceScan, type ScannedItem } from "@/lib/device-scan";
import {
  ArrowLeft, Play, MoreVertical, Share2, Trash2, Check, X,
  Pencil, RotateCw, RotateCcw, Info, Image as ImgIcon,
  FlipHorizontal, FlipVertical, Undo2, Loader2, Brush, Wand2,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { fmtBytes } from "@/lib/vault-store";
import { materializeFile } from "@/lib/device-scan";
import { getThumb } from "@/lib/thumbnails";
import { useBackHandler } from "@/lib/back-handler";
import {
  isNative, deleteOriginals, setWallpaperSafely, saveEditedImage, shareNative,
} from "@/lib/native-vault";
import { guessMimeFromName } from "@/lib/device-scan";
import { ViewOptionsMenu } from "@/components/ViewOptionsMenu";
import { useViewPrefs, sortRows } from "@/lib/view-prefs";

export const Route = createFileRoute("/gallery/$folder")({
  head: () => ({
    meta: [
      { title: "Album — Vault" },
      { name: "description", content: "View, edit, share and delete the photos and videos inside an album." },
      { property: "og:title", content: "Album — Vault" },
      { property: "og:description", content: "View, edit, share and delete the photos and videos inside an album." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { filter: "all" | "photo" | "video" } => {
    const f = search.filter;
    return {
      filter: f === "photo" || f === "video" ? f : "all",
    };
  },
  component: FolderView,
});

function FolderView() {
  const { folder: folderId } = Route.useParams();
  const { filter } = Route.useSearch();
  const t = useT();
  const navigate = useNavigate();
  const albums = useDeviceScan((s) => s.albums);
  const rawFolder = albums.find((a) => a.id === folderId) ?? deviceScan.getAlbum(folderId);
  // Inherit the parent gallery filter strictly — photo tab hides all
  // videos and vice versa, matching the sibling folder grid on "/".
  const folder = useMemo(() => {
    if (!rawFolder) return rawFolder;
    if (filter === "all") return rawFolder;
    const kind = filter === "photo" ? "image" : "video";
    return { ...rawFolder, items: rawFolder.items.filter((i) => i.kind === kind) };
  }, [rawFolder, filter]);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewer, setViewer] = useState<ScannedItem | null>(null);
  const [prefs] = useViewPrefs("media");

  // Sorted media list — recomputed whenever the folder or the sort changes.
  const sortedItems: ScannedItem[] = useMemo(
    () => (folder ? sortRows(folder.items, prefs.field, prefs.dir) : []),
    [folder, prefs.field, prefs.dir],
  );

  // Hardware back inside a gallery folder → pop exactly one level to the
  // gallery root (the fullscreen viewer registers its own handler on top).
  const backToGallery = useCallback(() => {
    if (selectMode) { setSelectMode(false); setSelected(new Set()); return true; }
    navigate({ to: "/" });
    return true;
  }, [navigate, selectMode]);
  useBackHandler(viewer === null, backToGallery);

  if (!folder) {
    return (
      <AppShell>
        <ScreenHeader
          title={t("not_found")}
          back={
            <button onClick={() => navigate({ to: "/" })} className="tap -ml-2 grid place-items-center rounded-full" aria-label={t("back")}>
              <ArrowLeft size={22} />
            </button>
          }
        />
        <div className="px-5 py-10 text-sm text-muted-foreground">
          {t("album_unavailable")}
        </div>
      </AppShell>
    );
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const enterSelect = () => { setSelectMode(true); setSelected(new Set()); };
  const cancelSelect = () => { setSelectMode(false); setSelected(new Set()); };

  const doDelete = async () => {
    if (selected.size === 0) { cancelSelect(); setConfirmDelete(false); return; }
    const targets = folder.items.filter((i) => selected.has(i.id));
    const deleted = await purgeFromDevice(targets);
    const confirmed = new Set(targets.filter((it) =>
      deleted.has(it.nativeUri ?? it.path)).map((it) => it.id));
    if (confirmed.size > 0) {
      if (confirmed.size === folder.items.length) navigate({ to: "/" });
      deviceScan.removeItems(folder.id, confirmed);
      toast.success(t("deleted_count", { n: confirmed.size }));
    }
    if (confirmed.size < targets.length) toast.error("Android could not confirm deletion. Files remain in the gallery.");
    cancelSelect();
    setConfirmDelete(false);
  };

  /**
   * Permanently remove the underlying files from public storage on device.
   * On web there is no filesystem to touch — the store update is enough.
   */
  const purgeFromDevice = async (targets: ScannedItem[]): Promise<Set<string>> => {
    const paths = targets.map((i) => i.nativeUri ?? i.path).filter(Boolean);
    if (!isNative()) return new Set(paths);
    try {
      const result = await deleteOriginals(paths);
      return new Set(result.deleted);
    } catch { return new Set(); }
  };

  /**
   * Single-item delete coming from the fullscreen viewer.
   *
   * Order matters: if this is the album's last item the album row is dropped
   * from the store, so we must navigate away FIRST — otherwise the route
   * re-renders against a missing album and shows "Album unavailable".
   */
  const deleteFromViewer = async (item: ScannedItem) => {
    const last = rawFolder ? rawFolder.items.length <= 1 : true;
    setViewer(null);
    const deleted = await purgeFromDevice([item]);
    if (deleted.has(item.nativeUri ?? item.path)) {
      if (last) navigate({ to: "/" });
      deviceScan.removeItems(folder.id, new Set([item.id]));
      toast.success(t("deleted"));
    } else {
      toast.error("Android could not confirm deletion. Files remain in the gallery.");
    }
  };

  const shareAlbum = async () => {
    const files: File[] = [];
    for (const it of folder.items) {
      try { files.push(await materializeFile(it)); } catch { /* skip unreadable */ }
    }
    // Native intent: Web Share API level 2 for files, mirroring Android
    // ACTION_SEND_MULTIPLE / iOS UIActivityViewController.
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare && nav.canShare({ files })) {
      try { await nav.share({ files, title: folder.name }); return; } catch { /* cancelled */ return; }
    }
    if (files[0]) {
      try { await nav.share?.({ files: [files[0]], title: files[0].name }); return; } catch { /* cancelled */ return; }
    }
    toast.info(t("sharing_unsupported"));
  };

  const shareItem = async (item: ScannedItem) => {
    // Native Android: hand the file to the system share sheet (Telegram,
    // WhatsApp, Drive, …) through the SecureVault FileProvider bridge. The
    // WebView has no Web Share API level 2, which is why this used to fail.
    if (isNative()) {
      try {
        const ok = await shareNative({
          path: item.nativeUri ?? item.path,
          name: item.name,
          mime: guessMimeFromName(item.name),
          title: item.name,
        });
        if (ok) return;
      } catch { /* fall through to the web path below */ }
    }
    let file: File;
    try { file = await materializeFile(item); }
    catch { toast.info(t("share_failed")); return; }
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title: item.name }); return; } catch { return; }
    }
    toast.info(t("share_failed"));
  };

  return (
    <AppShell>
      <ScreenHeader
        title={selectMode ? `${selected.size} ${t("selected")}` : folder.name}
        subtitle={selectMode ? undefined : `${folder.items.length} ${t("elements")}`}
        back={
          selectMode ? (
            <button onClick={cancelSelect} className="tap -ml-2 grid place-items-center rounded-full" aria-label={t("cancel")}>
              <X size={22} />
            </button>
          ) : (
            <Link
              to="/"
              className="tap -ml-2 flex items-center justify-center rounded-full"
              style={{ color: "var(--color-foreground)" }}
              aria-label={t("back")}
            >
              <ArrowLeft size={22} />
            </Link>
          )
        }
        right={
          selectMode ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={selected.size === 0}
              className="tap grid h-10 w-10 place-items-center rounded-full disabled:opacity-50"
              style={{ background: "var(--color-surface)", color: "hsl(var(--destructive))" }}
              aria-label={t("delete")}
            >
              <Trash2 size={18} />
            </button>
          ) : (
            <ViewOptionsMenu
              scope="media"
              showSize
              extraItems={
                <>
                  <DropdownMenuItem onSelect={() => void shareAlbum()}>
                    <Share2 size={16} className="mr-2" /> {t("share")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={enterSelect} className="text-destructive focus:text-destructive">
                    <Trash2 size={16} className="mr-2" /> {t("delete")}
                  </DropdownMenuItem>
                </>
              }
            />
          )
        }
      />

      <VirtualizedGrid
        items={sortedItems}
        columns={prefs.columns}
        selectMode={selectMode}
        selected={selected}
        onTap={(item) => (selectMode ? toggle(item.id) : setViewer(item))}
        onLongTap={(item) => { if (!selectMode) { enterSelect(); toggle(item.id); } }}
      />


      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete_files_confirm", { n: selected.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground">
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MediaViewer
        item={viewer}
        onClose={() => setViewer(null)}
        onDelete={deleteFromViewer}
        onShare={shareItem}
      />
    </AppShell>
  );
}

/**
 * Fullscreen media viewer with a working action bar:
 * edit (rotate / flip / apply), properties overlay, set-as-wallpaper and a
 * confirmed delete. Every overlay layer registers its own hardware-back
 * handler so Android's back button peels exactly one layer at a time.
 */
type FilterPreset = "none" | "vintage" | "bw" | "compress";
type StrokePoint = { x: number; y: number };
type Stroke = { pts: StrokePoint[]; color: string; width: number };

const PRESET_CSS: Record<FilterPreset, string> = {
  none: "",
  vintage: "sepia(0.55) saturate(1.25) contrast(1.06)",
  bw: "grayscale(1)",
  compress: "",
};

function MediaViewer({
  item, onClose, onDelete, onShare,
}: {
  item: ScannedItem | null;
  onClose: () => void;
  onDelete: (item: ScannedItem) => void | Promise<void>;
  onShare: (item: ScannedItem) => void;
}) {
  const t = useT();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // ── editor state ──────────────────────────────────────────────────────
  const [tool, setTool] = useState<"none" | "draw" | "filters">("none");
  const [preset, setPreset] = useState<FilterPreset>("none");
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brush, setBrush] = useState(6);
  const [color, setColor] = useState("#ff3b30");

  const resetAll = useCallback(() => {
    setRotation(0); setFlipH(false); setFlipV(false);
    setTool("none"); setPreset("none");
    setBrightness(100); setContrast(100);
    setStrokes([]); setBrush(6); setColor("#ff3b30");
  }, []);

  useEffect(() => {
    resetAll();
    setEditMode(false); setDetailsOpen(false); setConfirmOpen(false);
    setChromeVisible(true); setDims(null); setBusy(false);
  }, [item, resetAll]);

  const open = item !== null;

  // ── hardware back: innermost layer first ───────────────────────────────
  useBackHandler(open && confirmOpen, useCallback(() => { setConfirmOpen(false); return true; }, []));
  useBackHandler(open && detailsOpen, useCallback(() => { setDetailsOpen(false); return true; }, []));
  useBackHandler(open && editMode && tool !== "none" && !detailsOpen && !confirmOpen,
    useCallback(() => { setTool("none"); return true; }, []));
  useBackHandler(open && editMode && tool === "none" && !detailsOpen && !confirmOpen,
    useCallback(() => { setEditMode(false); return true; }, []));
  useBackHandler(open && !editMode && !detailsOpen && !confirmOpen,
    useCallback(() => { onClose(); return true; }, [onClose]));

  if (!item) return null;

  const ext = (item.name.split(".").pop() ?? "").toUpperCase();
  const transform = [
    `rotate(${rotation}deg)`,
    `scaleX(${flipH ? -1 : 1})`,
    `scaleY(${flipV ? -1 : 1})`,
  ].join(" ");

  const cssFilter =
    `${PRESET_CSS[preset]} brightness(${brightness / 100}) contrast(${contrast / 100})`.trim();

  const edits = {
    rotation, flipH, flipV, preset, brightness, contrast, strokes,
  };
  const hasEdits =
    rotation % 360 !== 0 || flipH || flipV || preset !== "none" ||
    brightness !== 100 || contrast !== 100 || strokes.length > 0;

  /** Bake every edit into a real file. */
  const applyEdits = async () => {
    if (item.kind !== "image") { setEditMode(false); return; }
    setBusy(true);
    try {
      const base64 = await renderEdited(item.url, edits);
      const name = `${item.name.replace(/\.[^.]+$/, "")}_edited.jpg`;
      if (isNative()) {
        await saveEditedImage(base64, name, "image/jpeg");
        await deviceScan.scan();
      } else {
        const a = document.createElement("a");
        a.href = `data:image/jpeg;base64,${base64}`;
        a.download = name;
        a.click();
      }
      toast.success(t("saved"));
      setEditMode(false);
      setTool("none");
    } catch (e) {
      toast.error((e as Error).message ?? t("edit_failed"));
    } finally {
      setBusy(false);
    }
  };

  const applyWallpaper = async () => {
    if (item.kind !== "image") { toast.info(t("wallpaper_unsupported")); return; }
    if (!isNative()) { toast.info(t("wallpaper_unsupported")); return; }
    if (busy) return;
    setBusy(true);
    try {
      // The heavy decode + WallpaperManager call happens on a native worker
      // thread, so the UI stays responsive instead of freezing.
      // Path first (decoded + downsampled on a native worker thread), with a
      // raw-bytes fallback so a SAF-only URI can never leave the UI stuck.
      const ok = hasEdits
        ? await setWallpaperSafely({ getBase64: () => renderEdited(item.url, edits) })
        : await setWallpaperSafely({
            path: item.nativeUri ?? item.path,
            getBase64: () => renderEdited(item.url, {
              rotation: 0, flipH: false, flipV: false,
              preset: "none", brightness: 100, contrast: 100, strokes: [],
            }),
          });
      if (ok) toast.success(t("wallpaper_set"));
      else toast.error(t("wallpaper_unsupported"));
    } catch (e) {
      toast.error((e as Error).message ?? t("wallpaper_failed"));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteNow = () => {
    setConfirmOpen(false);
    void onDelete(item);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black text-white" onClick={() => setChromeVisible((v) => !v)}>
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{
          paddingTop: "var(--app-safe-top)",
          paddingBottom: "var(--app-safe-bottom)",
          paddingLeft: "var(--app-safe-left)",
          paddingRight: "var(--app-safe-right)",
        }}
      >
        {item.kind === "image" ? (
          <div className="relative inline-block max-h-full max-w-full">
            <img
              src={item.url}
              alt={item.name}
              onLoad={(e) => {
                const el = e.currentTarget;
                setDims({ w: el.naturalWidth, h: el.naturalHeight });
              }}
              className="block max-h-full max-w-full object-contain transition-transform duration-300"
              style={{ transform, filter: cssFilter || undefined, maxHeight: "100vh" }}
            />
            <DrawLayer
              active={editMode && tool === "draw"}
              strokes={strokes}
              setStrokes={setStrokes}
              color={color}
              width={brush}
            />
          </div>
        ) : (
          <video
            src={item.url}
            controls
            autoPlay
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDims({ w: v.videoWidth, h: v.videoHeight });
            }}
            className="max-h-full max-w-full"
            style={{ transform }}
          />
        )}
      </div>

      {chromeVisible && (
        <div
          className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-[max(var(--app-safe-top),1rem)] pb-3"
          style={{ background: "linear-gradient(180deg, rgba(0,0,0,.7), transparent)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => (editMode ? setEditMode(false) : onClose())}
            className="tap grid h-10 w-10 place-items-center rounded-full bg-white/10"
            aria-label={t("back")}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="text-sm font-medium truncate max-w-[60%]">
            {editMode ? t("edit") : item.name}
          </div>
          <button
            onClick={() => onShare(item)}
            className="tap grid h-10 w-10 place-items-center rounded-full bg-white/10"
            aria-label={t("share")}
          >
            <Share2 size={18} />
          </button>
        </div>
      )}

      {chromeVisible && (
        <div
          className="absolute bottom-0 inset-x-0 pb-[max(var(--app-safe-bottom),0.75rem)]"
          style={{ background: "linear-gradient(0deg, rgba(0,0,0,.85), transparent)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto max-w-md px-4 pt-4">
            {editMode ? (
              <>
                {tool === "filters" && (
                  <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                    {(["none", "vintage", "bw", "compress"] as FilterPreset[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPreset(p)}
                        className="tap shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold"
                        style={{
                          background: preset === p ? "var(--color-accent)" : "rgba(255,255,255,.12)",
                          color: preset === p ? "var(--color-accent-foreground)" : "white",
                        }}
                      >
                        {t(`filter_${p}` as "filter_none")}
                      </button>
                    ))}
                  </div>
                )}

                {tool === "draw" && (
                  <div className="mb-3 flex items-center gap-3">
                    <span className="text-[11px] text-white/70">{t("brush_size")}</span>
                    <input
                      type="range" min={2} max={28} value={brush}
                      onChange={(e) => setBrush(Number(e.target.value))}
                      className="flex-1 accent-[var(--color-accent)]"
                    />
                    <div className="flex gap-1.5">
                      {["#ff3b30", "#ffffff", "#111111", "#34c759", "#0a84ff"].map((c) => (
                        <button
                          key={c}
                          onClick={() => setColor(c)}
                          className="h-6 w-6 rounded-full border-2"
                          style={{ background: c, borderColor: color === c ? "#fff" : "transparent" }}
                          aria-label={c}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => setStrokes([])}
                      className="tap rounded-full bg-white/10 px-3 py-1 text-[11px]"
                    >
                      {t("clear")}
                    </button>
                  </div>
                )}

                <div className="mb-3 space-y-2">
                  <SliderRow
                    label={t("brightness")} value={brightness}
                    onChange={setBrightness} min={20} max={200}
                  />
                  <SliderRow
                    label={t("contrast")} value={contrast}
                    onChange={setContrast} min={20} max={200}
                  />
                </div>

                <div className="grid grid-cols-5 gap-1">
                  <ViewerBtn
                    icon={<Brush size={18} />} label={t("draw")}
                    active={tool === "draw"}
                    onClick={() => setTool((v) => (v === "draw" ? "none" : "draw"))}
                  />
                  <ViewerBtn
                    icon={<Wand2 size={18} />} label={t("filters")}
                    active={tool === "filters"}
                    onClick={() => setTool((v) => (v === "filters" ? "none" : "filters"))}
                  />
                  <ViewerBtn icon={<FlipHorizontal size={18} />} label={t("flip_h")} onClick={() => setFlipH((v) => !v)} />
                  <ViewerBtn icon={<FlipVertical size={18} />} label={t("flip_v")} onClick={() => setFlipV((v) => !v)} />
                  <ViewerBtn icon={<Undo2 size={18} />} label={t("reset")} onClick={resetAll} />
                </div>

                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => { setEditMode(false); setTool("none"); }}
                    className="tap flex-1 rounded-full bg-white/10 py-2.5 text-sm font-semibold"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    onClick={applyEdits}
                    disabled={busy}
                    className="tap flex-1 rounded-full py-2.5 text-sm font-semibold disabled:opacity-60"
                    style={{ background: "var(--color-accent)", color: "var(--color-accent-foreground)" }}
                  >
                    {busy ? <Loader2 size={14} className="inline animate-spin" /> : t("apply")}
                  </button>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-6 gap-1">
                <ViewerBtn icon={<Pencil size={18} />} label={t("edit")} onClick={() => setEditMode(true)} />
                <ViewerBtn icon={<RotateCw size={18} />} label={t("rotate_right")} onClick={() => setRotation((r) => r + 90)} />
                <ViewerBtn icon={<RotateCcw size={18} />} label={t("rotate_left")} onClick={() => setRotation((r) => r - 90)} />
                <ViewerBtn icon={<Info size={18} />} label={t("details")} onClick={() => setDetailsOpen(true)} />
                <ViewerBtn
                  icon={busy ? <Loader2 size={18} className="animate-spin" /> : <ImgIcon size={18} />}
                  label={t("set_wallpaper")}
                  onClick={applyWallpaper}
                />
                <ViewerBtn icon={<Trash2 size={18} />} label={t("delete")} destructive onClick={() => setConfirmOpen(true)} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Properties overlay — closed by hardware back, returning to the photo. */}
      {detailsOpen && (
        <div
          className="absolute inset-0 z-[70] flex items-end bg-black/70 backdrop-blur-sm"
          onClick={(e) => { e.stopPropagation(); setDetailsOpen(false); }}
        >
          <div
            className="w-full rounded-t-3xl p-5 pb-[max(var(--app-safe-bottom),1.25rem)]"
            style={{ background: "var(--color-surface)", color: "var(--color-foreground)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">{t("details")}</h3>
              <button
                onClick={() => setDetailsOpen(false)}
                className="tap grid h-8 w-8 place-items-center rounded-full"
                style={{ background: "var(--color-muted)" }}
                aria-label={t("cancel")}
              >
                <X size={16} />
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("name")}</dt>
              <dd className="truncate text-right">{item.name}</dd>
              <dt className="text-muted-foreground">{t("file_size")}</dt>
              <dd className="text-right">{fmtBytes(item.size)}</dd>
              <dt className="text-muted-foreground">{t("format")}</dt>
              <dd className="text-right">{ext || (item.kind === "image" ? "IMAGE" : "VIDEO")}</dd>
              <dt className="text-muted-foreground">{t("resolution")}</dt>
              <dd className="text-right">{dims ? `${dims.w} × ${dims.h}` : "—"}</dd>
              <dt className="text-muted-foreground">{t("date")}</dt>
              <dd className="text-right">{new Date(item.mtime).toLocaleString()}</dd>
              <dt className="text-muted-foreground">{t("path")}</dt>
              <dd className="truncate text-right">{item.path}</dd>
            </dl>
          </div>
        </div>
      )}

      {/*
        Delete confirmation. Rendered INSIDE the fullscreen viewer instead of
        via a portalled dialog — the portal landed underneath this z-[60]
        layer, which is what made the delete button look like it froze the app.
      */}
      {confirmOpen && (
        <ConfirmSheet
          message={item.kind === "video" ? t("confirm_delete_video") : t("confirm_delete_photo")}
          confirmLabel={t("yes")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={confirmDeleteNow}
        />
      )}
    </div>
  );
}

/**
 * Shared, always-on-top confirmation popup for fullscreen overlays.
 *
 * Rendered through a React portal straight into <body> at z-[9999] with
 * `pointer-events: auto`. This matters when the sheet is opened from inside
 * a Radix dialog: Radix sets `pointer-events: none` on <body> and traps
 * focus, which used to swallow every tap on the Yes / Cancel buttons and
 * made the app look frozen. Pointer/touch events are stopped at the overlay
 * so the viewer underneath never intercepts them either.
 */
export function ConfirmSheet({
  message, confirmLabel, cancelLabel, onConfirm, onCancel,
}: {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || typeof document === "undefined") return null;

  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-black/70 p-6"
      style={{ pointerEvents: "auto" }}
      onPointerDown={stop}
      onTouchStart={stop}
      onClick={(e) => { e.stopPropagation(); onCancel(); }}
    >
      <div
        className="w-full max-w-[320px] rounded-3xl p-5"
        style={{
          background: "var(--color-surface)",
          color: "var(--color-foreground)",
          pointerEvents: "auto",
        }}
        onPointerDown={stop}
        onTouchStart={stop}
        onClick={stop}
      >
        <p className="text-base font-semibold leading-snug">{message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onPointerDown={stop}
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="tap h-10 flex-1 rounded-xl text-sm font-semibold"
            style={{ background: "var(--color-muted)" }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onPointerDown={stop}
            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
            className="tap h-10 flex-1 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SliderRow({
  label, value, onChange, min, max,
}: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[11px] text-white/70">{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--color-accent)]"
      />
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-white/70">{value}%</span>
    </div>
  );
}

/**
 * Freehand drawing surface laid exactly over the displayed image. Strokes are
 * stored in normalized (0..1) coordinates so they can be re-rendered at full
 * resolution when the edit is applied.
 */
function DrawLayer({
  active, strokes, setStrokes, color, width,
}: {
  active: boolean;
  strokes: Stroke[];
  setStrokes: React.Dispatch<React.SetStateAction<Stroke[]>>;
  color: string;
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !el.parentElement) return;
    const measure = () => {
      const r = el.parentElement!.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || size.w === 0 || size.h === 0) return;
    el.width = size.w;
    el.height = size.h;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size.w, size.h);
    paintStrokes(ctx, strokes, size.w, size.h);
  }, [strokes, size]);

  const pointFrom = (e: React.PointerEvent) => {
    const el = canvasRef.current!;
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  if (!active && strokes.length === 0) {
    return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 h-full w-full ${active ? "touch-none" : "pointer-events-none"}`}
      style={{ pointerEvents: active ? "auto" : "none" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (!active) return;
        e.stopPropagation();
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        drawing.current = true;
        const p = pointFrom(e);
        setStrokes((s) => [...s, { pts: [p], color, width }]);
      }}
      onPointerMove={(e) => {
        if (!active || !drawing.current) return;
        e.stopPropagation();
        const p = pointFrom(e);
        setStrokes((s) => {
          if (s.length === 0) return s;
          const next = s.slice();
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, pts: [...last.pts, p] };
          return next;
        });
      }}
      onPointerUp={(e) => { e.stopPropagation(); drawing.current = false; }}
      onPointerCancel={() => { drawing.current = false; }}
    />
  );
}

function paintStrokes(
  ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number,
) {
  const scale = Math.min(w, h) / 400;
  for (const s of strokes) {
    if (s.pts.length === 0) continue;
    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, s.width * Math.max(scale, 0.5));
    ctx.moveTo(s.pts[0].x * w, s.pts[0].y * h);
    for (const p of s.pts.slice(1)) ctx.lineTo(p.x * w, p.y * h);
    if (s.pts.length === 1) ctx.lineTo(s.pts[0].x * w + 0.1, s.pts[0].y * h + 0.1);
    ctx.stroke();
  }
}

/**
 * Bake rotation / flip / filters / brightness / contrast / freehand strokes
 * into pixels via canvas and return raw base64 JPEG.
 */
async function renderEdited(
  src: string,
  edits: {
    rotation: number; flipH: boolean; flipV: boolean;
    preset: FilterPreset; brightness: number; contrast: number; strokes: Stroke[];
  },
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Image could not be read"));
    el.src = src;
  });
  const rad = ((edits.rotation % 360) + 360) % 360;
  const swap = rad === 90 || rad === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? img.naturalHeight : img.naturalWidth;
  canvas.height = swap ? img.naturalWidth : img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const filter =
    `${PRESET_CSS[edits.preset]} brightness(${edits.brightness / 100}) contrast(${edits.contrast / 100})`.trim();
  ctx.save();
  try { ctx.filter = filter; } catch { /* filter unsupported — draw as-is */ }
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rad * Math.PI) / 180);
  ctx.scale(edits.flipH ? -1 : 1, edits.flipV ? -1 : 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();

  // Strokes were captured over the displayed (already transformed) image, so
  // they are painted straight onto the final canvas.
  if (edits.strokes.length > 0) {
    paintStrokes(ctx, edits.strokes, canvas.width, canvas.height);
  }

  // "Compress" trades quality for a much smaller file.
  const quality = edits.preset === "compress" ? 0.45 : 0.92;
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl.slice(dataUrl.indexOf("base64,") + 7);
}

function ViewerBtn({
  icon, label, onClick, destructive, active,
}: {
  icon: React.ReactNode; label: string; onClick: () => void;
  destructive?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`tap flex flex-col items-center justify-center gap-1 rounded-2xl py-2 text-white/90 hover:bg-white/10 ${active ? "bg-white/15" : ""}`}
    >
      <span className={destructive ? "text-red-400" : ""}>{icon}</span>
      <span className={`text-[10px] leading-tight text-center ${destructive ? "text-red-400" : ""}`}>{label}</span>
    </button>
  );
}

/**
 * Lightweight virtualized 3-column grid.
 *
 * We window on page scroll: only the row range currently intersecting the
 * viewport (plus a small overscan) is rendered. This keeps DOM size flat
 * even for albums with thousands of items. Each rendered tile then lazily
 * generates and shows a downscaled thumbnail via `getThumb()` — the
 * original full-resolution file is only decoded when the user opens the
 * viewer.
 */
function VirtualizedGrid({
  items, columns, selectMode, selected, onTap, onLongTap,
}: {
  items: ScannedItem[];
  columns: number;
  selectMode: boolean;
  selected: Set<string>;
  onTap: (item: ScannedItem) => void;
  onLongTap: (item: ScannedItem) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cols = Math.max(1, columns);
  const [tile, setTile] = useState(120);
  const [range, setRange] = useState<[number, number]>([0, 30]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - 8; // account for p-1 padding
      setTile(Math.floor(w / cols) - 4);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cols]);

  useEffect(() => {
    const OVERSCAN = 6;
    const compute = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rowH = tile + 4;
      const viewportH = window.innerHeight;
      const start = Math.max(0, Math.floor((-rect.top) / rowH) - OVERSCAN);
      const end = Math.max(start + 1,
        Math.ceil((-rect.top + viewportH) / rowH) + OVERSCAN);
      setRange([start * cols, end * cols]);
    };
    compute();
    window.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, [tile, cols, items.length]);

  const totalRows = Math.ceil(items.length / cols);
  const rowH = tile + 4;
  const [from, to] = range;
  const visible = items.slice(from, to);
  const topPad = Math.floor(from / cols) * rowH;
  const bottomPad = Math.max(0, (totalRows - Math.ceil(to / cols)) * rowH);

  return (
    <div ref={wrapRef} className="p-1">
      <div style={{ height: topPad }} />
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {visible.map((item) => {
          const isSel = selected.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => onTap(item)}
              onContextMenu={(e) => { e.preventDefault(); onLongTap(item); }}
              className="relative overflow-hidden rounded-md bg-black/40"
              style={{ height: tile }}
              aria-label={item.name}
            >
              <LazyThumb item={item} />
              {item.kind === "video" && (
                <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-black/50 backdrop-blur">
                    <Play size={16} className="text-white" fill="currentColor" />
                  </span>
                </span>
              )}
              {selectMode && (
                <span
                  className="absolute top-1.5 left-1.5 grid h-6 w-6 place-items-center rounded-full border-2"
                  style={{
                    background: isSel ? "var(--color-accent)" : "rgba(0,0,0,.45)",
                    borderColor: isSel ? "var(--color-accent)" : "rgba(255,255,255,.85)",
                  }}
                >
                  {isSel && <Check size={14} className="text-white" strokeWidth={3} />}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ height: bottomPad }} />
    </div>
  );
}

function LazyThumb({ item }: { item: ScannedItem }) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void getThumb(item).then((u) => { if (!cancelled) setSrc(u); });
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); };
  }, [item]);
  return (
    <div ref={ref} className="absolute inset-0">
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

