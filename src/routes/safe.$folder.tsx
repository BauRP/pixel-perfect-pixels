import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, ScreenHeader } from "@/components/AppShell";
import { useVault, vault, fmtBytes, type EncryptedFile } from "@/lib/vault-store";
import { useT } from "@/lib/i18n";
import {
  ArrowLeft, FileIcon, MoreVertical, Plus, Pencil, Trash2,
  ImageIcon, FileText, Film, Loader2, ArrowLeftToLine, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSafePin } from "@/lib/pin-store";
import { SafePinGate } from "@/components/SafePinGate";
import { useBackHandler } from "@/lib/back-handler";
import { toast } from "sonner";
import { useDeviceScan, materializeFile, deviceScan, type ScannedItem } from "@/lib/device-scan";
import {
  isNative, ensureDeletePermission, deleteOriginals, ensurePrivateVaultDir,
  restoreToPublic, shareNative,
} from "@/lib/native-vault";
import { ConfirmSheet } from "./gallery.$folder";
import {
  Dialog as PickerDialog, DialogContent as PickerDialogContent,
  DialogHeader as PickerDialogHeader, DialogTitle as PickerDialogTitle,
  DialogFooter as PickerDialogFooter,
} from "@/components/ui/dialog";
import { Check } from "lucide-react";

export const Route = createFileRoute("/safe/$folder")({
  head: () => ({
    meta: [
      { title: "Private Folder — Vault" },
      { name: "description", content: "View encrypted photos and videos in a private Safe folder." },
      { property: "og:title", content: "Private Folder — Vault" },
      { property: "og:description", content: "View encrypted photos and videos in a private Safe folder." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SafeFolderView,
});

function SafeFolderView() {
  const { folder: folderId } = Route.useParams();
  const navigate = useNavigate();
  const t = useT();
  const pin = useSafePin();
  const vaultUnlocked = useVault((s) => s.unlocked);
  const folder = useVault((s) => s.folders.find((f) => f.id === folderId));
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewer, setViewer] = useState<{ file: EncryptedFile; url: string } | null>(null);
  const [confirmFile, setConfirmFile] = useState<EncryptedFile | null>(null);

  // Hardware back: fullscreen media first, then the picker, then one level
  // up from the Safe folder to the Safe root.
  useBackHandler(viewer !== null, useCallback(() => { setViewer(null); return true; }, []));
  useBackHandler(viewer === null && pickerOpen,
    useCallback(() => { setPickerOpen(false); return true; }, []));
  useBackHandler(viewer === null && !pickerOpen,
    useCallback(() => { navigate({ to: "/safe" }); return true; }, [navigate]));

  // Guarantee the private, non-indexable vault directory exists for ANY
  // user-created folder (never hardcoded to one album).
  useEffect(() => { void ensurePrivateVaultDir(); }, []);

  // Revoke object URL when viewer closes to avoid keeping plaintext in memory.
  useEffect(() => () => { if (viewer) URL.revokeObjectURL(viewer.url); }, [viewer]);

  // Require BOTH the UI PIN session flag AND an in-memory vault key. The
  // vault key is process-scoped (never persisted) so any cold restart
  // must round-trip through the PIN gate to re-derive it, otherwise
  // vault.addFiles() throws "Vault is locked".
  const gate = !pin.unlocked || !vaultUnlocked;

  if (!folder) {
    return (
      <AppShell>
        <ScreenHeader title={t("not_found")} />
        <div className="px-5 py-8 text-sm text-muted-foreground">{t("folder_not_found")}</div>
      </AppShell>
    );
  }

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      await vault.addFiles(folder.id, Array.from(files));
      toast.success(t("encrypted_count", { n: files.length }));
    } catch (e) {
      toast.error((e as Error).message ?? t("encryption_failed"));
    } finally {
      setBusy(false);
    }
  };

  const addFromGallery = async (items: ScannedItem[]) => {
    if (items.length === 0) return;
    setBusy(true);
    try {
      // Ask once for the OS permission that lets us hard-delete originals.
      // A denial is not fatal — the native layer then falls back to the
      // system MediaStore delete-request dialog.
      if (isNative()) await ensureDeletePermission();

      // 1. Read + encrypt each selected item into the app's private,
      //    .nomedia-guarded internal directory (one file at a time so a
      //    single unreadable item can't abort the whole batch).
      const secured: ScannedItem[] = [];
      for (const it of items) {
        try {
          const file = await materializeFile(it);
          // Remember where the original lived so "Restore" can put it back
          // in exactly the same public folder later on.
          await vault.addFiles(folder.id, [file], [{ origPath: it.path }]);
          secured.push(it);
        } catch (e) {
          console.warn("[Vault] secure move failed", it.name, e);
        }
      }
      if (secured.length === 0) throw new Error(t("no_readable_files"));

      // 2. Only AFTER the encrypted copy is safely written do we delete the
      //    originals from public storage, so the media disappears from the
      //    system gallery and every third-party file manager.
      const paths = secured
        .map((it) => it.nativeUri ?? it.path)
        .filter((p): p is string => Boolean(p));
      let removed = 0;
      if (isNative() && paths.length > 0) {
        const res = await deleteOriginals(paths);
        removed = res.deleted.length;
        deviceScan.removeByPaths(res.deleted);
        if (res.failed.length > 0) {
          toast.warning(t("originals_failed", { n: res.failed.length }));
        }
      }
      toast.success(
        isNative()
          ? t("moved_to_safe", { n: secured.length, removed })
          : t("encrypted_count", { n: secured.length }),
      );
    } catch (e) {
      toast.error((e as Error).message ?? t("encryption_failed"));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (f: EncryptedFile) => {
    try {
      const blob = await vault.decryptFile(f);
      const url = URL.createObjectURL(blob);
      setViewer({ file: f, url });
    } catch {
      toast.error(t("decryption_failed"));
    }
  };

  /**
   * Decrypt a vaulted file and write it back to its original public folder,
   * then drop it from the Safe. The media becomes visible to the system
   * gallery and to every other app again.
   */
  const restoreFromSafe = async (f: EncryptedFile) => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await vault.decryptFile(f);
      if (isNative()) {
        const base64 = await blobToBase64(blob);
        await restoreToPublic({
          base64,
          name: f.name,
          mime: f.type,
          relativePath: publicRelativeDir(f),
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = f.name; a.click();
        URL.revokeObjectURL(url);
      }
      vault.deleteFile(folder.id, f.id);
      setViewer(null);
      if (isNative()) void deviceScan.scan();
      toast.success(t("restored"));
    } catch (e) {
      toast.error((e as Error).message ?? t("restore_failed"));
    } finally {
      setBusy(false);
    }
  };

  const doDeleteFolder = () => {
    vault.deleteFolder(folder.id);
    navigate({ to: "/safe" });
  };

  const openRename = () => {
    setRenameValue(folder.name);
    setRenameOpen(true);
  };
  const doRename = () => {
    const n = renameValue.trim();
    if (!n) return;
    vault.renameFolder(folder.id, n);
    setRenameOpen(false);
  };

  return (
    <AppShell>
      <ScreenHeader
        title={folder.name}
        subtitle={`${folder.files.length} ${t("items")} · ${fmtBytes(folder.files.reduce((a, x) => a + x.size, 0))}`}
        back={
          <button
            onClick={() => navigate({ to: "/safe" })}
            className="tap -ml-2 grid place-items-center rounded-full"
            aria-label={t("back")}
          >
            <ArrowLeft size={22} />
          </button>
        }
        right={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="tap grid h-10 w-10 place-items-center rounded-full"
                style={{ background: "var(--color-surface)" }}
                aria-label={t("menu")}
              >
                <MoreVertical size={20} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-2xl min-w-[180px]">
              <DropdownMenuItem onClick={() => setPickerOpen(true)}>
                <Plus size={16} className="mr-2" /> {t("add")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInput.current?.click()}>
                <FileIcon size={16} className="mr-2" /> {t("browse_files")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openRename}>
                <Pencil size={16} className="mr-2" /> {t("rename")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setConfirmDelete(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 size={16} className="mr-2" /> {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="px-4 pt-4">
        {folder.files.length === 0 ? (
          <div
            className="rounded-3xl p-8 text-center animate-fade-up"
            style={{ background: "var(--color-surface)", border: "1px dashed var(--color-border)" }}
          >
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "var(--color-muted)" }}>
              <FileIcon size={22} className="text-muted-foreground" />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{t("empty_folder")}</p>
            <button
              onClick={() => setPickerOpen(true)}
              disabled={busy}
              className="mt-5 tap rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ background: "var(--color-accent)", color: "var(--color-accent-foreground)" }}
            >
              {busy ? <Loader2 size={14} className="inline mr-1.5 animate-spin" /> : <Plus size={14} className="inline mr-1.5" />}
              {t("add")}
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {folder.files.map((f, i) => (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-2xl p-3 animate-fade-up"
                style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", animationDelay: `${Math.min(i, 20) * 25}ms` }}
              >
                <button
                  onClick={() => openFile(f)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left tap"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl shrink-0" style={{ background: "var(--color-muted)" }}>
                    <FileKindIcon type={f.type} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmtBytes(f.size)} · AES-256-GCM
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setConfirmFile(f)}
                  className="tap grid place-items-center rounded-full text-destructive"
                  aria-label={t("delete")}
                >
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files)}
      />

      <GalleryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConfirm={async (items) => {
          setPickerOpen(false);
          await addFromGallery(items);
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete_folder")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete_folder_files_confirm", { name: folder.name, n: folder.files.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={doDeleteFolder} className="bg-destructive text-destructive-foreground">
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t("rename")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doRename()}
            className="h-12 rounded-2xl"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>{t("cancel")}</Button>
            <Button onClick={doRename} disabled={!renameValue.trim()}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Decrypted media viewer.

        Plain fullscreen layer instead of a Radix dialog: the dialog put
        `pointer-events: none` on <body> and focus-trapped the tree, which
        broke the delete confirmation, and its header crammed the action
        buttons into the title row so Close overlapped Delete.
      */}
      {viewer && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black text-white">
          <div
            className="flex items-center gap-3 px-4 pt-[max(var(--app-safe-top),0.75rem)] pb-3"
            style={{ background: "linear-gradient(180deg, rgba(0,0,0,.85), transparent)" }}
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {viewer.file.name}
            </span>
            {/* Restore · Delete · Close — evenly spaced, never overlapping. */}
            <div className="flex shrink-0 items-center gap-4">
              <button
                type="button"
                onClick={() => void restoreFromSafe(viewer.file)}
                disabled={busy}
                className="tap grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 disabled:opacity-50"
                aria-label={t("restore")}
                title={t("restore")}
              >
                {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowLeftToLine size={18} />}
              </button>
              <button
                type="button"
                onClick={() => setConfirmFile(viewer.file)}
                className="tap grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-red-400"
                aria-label={t("delete")}
                title={t("delete")}
              >
                <Trash2 size={18} />
              </button>
              <button
                type="button"
                onClick={() => setViewer(null)}
                className="tap grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10"
                aria-label={t("close")}
                title={t("close")}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-hidden px-2 pb-[max(var(--app-safe-bottom),0.75rem)]">
            {viewer.file.type.startsWith("video/") ? (
              <video src={viewer.url} controls autoPlay className="max-h-full max-w-full" />
            ) : viewer.file.type.startsWith("image/") ? (
              <img
                src={viewer.url}
                alt={viewer.file.name}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="p-8 text-sm text-white/80">{viewer.file.type}</div>
            )}
          </div>
        </div>
      )}

      {confirmFile && (
        <ConfirmSheet
          message={
            confirmFile.type.startsWith("video/")
              ? t("confirm_delete_video")
              : t("confirm_delete_photo")
          }
          confirmLabel={t("yes")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmFile(null)}
          onConfirm={() => {
            vault.deleteFile(folder.id, confirmFile.id);
            setConfirmFile(null);
            setViewer(null);
            toast.success(t("deleted"));
          }}
        />
      )}

      {gate && (
        <SafePinGate
          onCancel={() => navigate({ to: "/safe" })}
          onSuccess={() => { /* pin session handled internally */ }}
        />
      )}
    </AppShell>
  );
}

function FileKindIcon({ type }: { type: string }) {
  if (type.startsWith("image/")) return <ImageIcon size={18} />;
  if (type.startsWith("video/")) return <Film size={18} />;
  return <FileText size={18} />;
}

/**
 * Full-screen picker that lets the user select photos/videos from their
 * already-scanned device gallery to encrypt into a Safe folder.
 */
function GalleryPicker({
  open, onOpenChange, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (items: ScannedItem[]) => void;
}) {
  const t = useT();
  const albums = useDeviceScan((s) => s.albums);
  const scanning = useDeviceScan((s) => s.scanning);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const flat: ScannedItem[] = [];
  for (const a of albums) for (const it of a.items) flat.push(it);

  useEffect(() => { if (!open) setSelected(new Set()); }, [open]);

  const toggle = (id: string) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <PickerDialog open={open} onOpenChange={onOpenChange}>
      <PickerDialogContent className="rounded-3xl max-w-md p-0 overflow-hidden">
        <PickerDialogHeader className="px-4 pt-4 pb-2">
          <PickerDialogTitle className="text-base">
            {t("select_media", { n: selected.size })}
          </PickerDialogTitle>
        </PickerDialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-2">
          {flat.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {scanning ? t("scanning_device") : t("no_media_found")}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1 pb-3">
              {flat.map((it) => {
                const isSel = selected.has(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => toggle(it.id)}
                    className="relative aspect-square overflow-hidden rounded-lg"
                    style={{ background: "var(--color-muted)" }}
                  >
                    {it.kind === "image" ? (
                      <img src={it.url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center">
                        <Film size={20} className="text-white/80" />
                      </div>
                    )}
                    <span
                      className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full border-2"
                      style={{
                        background: isSel ? "var(--color-accent)" : "rgba(0,0,0,.45)",
                        borderColor: isSel ? "var(--color-accent)" : "rgba(255,255,255,.85)",
                      }}
                    >
                      {isSel && <Check size={12} className="text-white" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <PickerDialogFooter className="px-4 pb-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button
            onClick={() => onConfirm(flat.filter((f) => selected.has(f.id)))}
            disabled={selected.size === 0}
          >
            {selected.size > 0 ? t("add_with_count", { n: selected.size }) : t("add")}
          </Button>
        </PickerDialogFooter>
      </PickerDialogContent>
    </PickerDialog>
  );
}

/** Read a Blob as raw base64 (no data-url prefix). */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Derive the public relative directory ("DCIM/Camera", "Pictures/Screenshots")
 * from the absolute path the file was originally imported from.
 */
function publicRelativeDir(f: EncryptedFile): string {
  const abs = f.origPath ?? "";
  const dir = abs.slice(0, abs.lastIndexOf("/"));
  const m = dir.match(/(?:emulated\/\d+|sdcard|storage\/[^/]+)\/(.+)$/);
  if (m && m[1]) return m[1];
  return f.type.startsWith("video/") ? "Movies" : "Pictures";
}
