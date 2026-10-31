import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, ScreenHeader } from "@/components/AppShell";
import { useVault, vault, type VaultFolder } from "@/lib/vault-store";
import { useT } from "@/lib/i18n";
import { useSafePin } from "@/lib/pin-store";
import { SafePinGate } from "@/components/SafePinGate";
import { Folder, Plus, Pencil, Trash2, Fingerprint } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/safe/")({
  head: () => ({
    meta: [
      { title: "Safe — Vault" },
      { name: "description", content: "PIN-locked private folders with on-device AES-256 encryption." },
      { property: "og:title", content: "Safe — Vault" },
      { property: "og:description", content: "PIN-locked private folders with on-device AES-256 encryption." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SafeScreen,
});

function SafeScreen() {
  const navigate = useNavigate();
  const pin = useSafePin();
  const vaultUnlocked = useVault((s) => s.unlocked);
  // Gate on both the PIN session flag and the in-memory vault key —
  // see safe.$folder.tsx for the full rationale.
  const gate = !pin.unlocked || !vaultUnlocked;

  return (
    <AppShell>
      {!gate && <SafeContent />}
      {gate && (
        <SafePinGate
          onCancel={() => navigate({ to: "/" })}
          onSuccess={() => { /* session flag set inside safePin */ }}
        />
      )}
    </AppShell>
  );
}

function SafeContent() {
  const t = useT();
  const folders = useVault((s) => s.folders);
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const [ctxTarget, setCtxTarget] = useState<VaultFolder | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const create = () => {
    const n = newName.trim();
    if (!n) return;
    const id = vault.createFolder(n);
    setNewName("");
    setCreateOpen(false);
    navigate({ to: "/safe/$folder", params: { folder: id } });
  };

  const openRename = () => {
    if (!ctxTarget) return;
    setRenameValue(ctxTarget.name);
    setRenameOpen(true);
  };
  const doRename = () => {
    const n = renameValue.trim();
    if (!n || !ctxTarget) return;
    vault.renameFolder(ctxTarget.id, n);
    setRenameOpen(false);
    setCtxTarget(null);
  };
  const doDelete = () => {
    if (!ctxTarget) return;
    vault.deleteFolder(ctxTarget.id);
    setConfirmDelete(false);
    setCtxTarget(null);
  };

  return (
    <>
      <ScreenHeader title={t("private_vault")} />

      <div className="px-4 pt-4 grid grid-cols-2 gap-3">
        {folders.map((f, i) => (
          <FolderTile
            key={f.id}
            folder={f}
            index={i}
            onOpen={() => navigate({ to: "/safe/$folder", params: { folder: f.id } })}
            onLongPress={() => setCtxTarget(f)}
          />
        ))}
        <button
          onClick={() => setCreateOpen(true)}
          className="flex flex-col items-center justify-center gap-2 rounded-3xl aspect-square p-4 animate-fade-up active:scale-[0.98] transition-transform"
          style={{
            background: "var(--color-surface)",
            border: "2px dashed var(--color-border)",
            animationDelay: `${folders.length * 40}ms`,
          }}
          aria-label={t("add_folder")}
        >
          <span
            className="grid h-14 w-14 place-items-center rounded-2xl"
            style={{ background: "var(--color-muted)" }}
          >
            <Plus size={28} style={{ color: "var(--color-accent)" }} />
          </span>
          <span className="text-xs font-medium text-muted-foreground">{t("add_folder")}</span>
        </button>
      </div>

      {/* Create folder */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t("create_folder")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder={t("new_folder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            className="h-12 rounded-2xl"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button>
            <Button onClick={create} disabled={!newName.trim()}>{t("create_folder")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Long-press context sheet — scoped to the pressed folder */}
      <Dialog
        open={ctxTarget !== null && !renameOpen && !confirmDelete}
        onOpenChange={(o) => { if (!o) setCtxTarget(null); }}
      >
        <DialogContent className="rounded-3xl max-w-xs p-2">
          <DialogHeader className="px-4 pt-3">
            <DialogTitle className="text-sm text-muted-foreground truncate">
              {ctxTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col">
            <button
              onClick={openRename}
              className="flex items-center gap-3 rounded-2xl p-3 text-left hover:bg-[var(--color-muted)]"
            >
              <Pencil size={18} /> <span className="text-sm">{t("rename")}</span>
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-3 rounded-2xl p-3 text-left text-destructive hover:bg-[var(--color-muted)]"
            >
              <Trash2 size={18} /> <span className="text-sm">{t("delete")}</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={renameOpen} onOpenChange={(o) => { if (!o) { setRenameOpen(false); setCtxTarget(null); } }}>
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
            <Button variant="ghost" onClick={() => { setRenameOpen(false); setCtxTarget(null); }}>{t("cancel")}</Button>
            <Button onClick={doRename} disabled={!renameValue.trim()}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={(o) => { if (!o) { setConfirmDelete(false); setCtxTarget(null); } }}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete_folder")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete_folder_confirm", { name: ctxTarget?.name ?? "" })}
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
    </>
  );
}

function FolderTile({
  folder, index, onOpen, onLongPress,
}: {
  folder: VaultFolder;
  index: number;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const t = useT();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const startXY = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  const startPress = (x: number, y: number) => {
    longFired.current = false;
    startXY.current = { x, y };
    clearTimer();
    timer.current = setTimeout(() => {
      longFired.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15);
      onLongPress();
    }, 500);
  };
  const movePress = (x: number, y: number) => {
    if (!startXY.current) return;
    const dx = x - startXY.current.x;
    const dy = y - startXY.current.y;
    if (dx * dx + dy * dy > 100) clearTimer();
  };
  const endPress = () => { clearTimer(); startXY.current = null; };

  // Touch (mobile, primary target)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) startPress(t.clientX, t.clientY);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) movePress(t.clientX, t.clientY);
  };
  const onTouchEnd = () => endPress();

  // Mouse (dev preview only)
  const onMouseDown = (e: React.MouseEvent) => startPress(e.clientX, e.clientY);
  const onMouseMove = (e: React.MouseEvent) => movePress(e.clientX, e.clientY);
  const onMouseEnd = () => endPress();

  const handleClick = () => {
    if (longFired.current) { longFired.current = false; return; }
    onOpen();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={onOpen}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseEnd}
      onMouseLeave={onMouseEnd}
      className="relative flex flex-col items-center justify-center gap-3 rounded-3xl aspect-square p-4 select-none animate-fade-up active:scale-[0.98] transition-transform touch-manipulation"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        animationDelay: `${index * 40}ms`,
      }}
    >
      <Folder size={56} strokeWidth={1.4} style={{ color: "var(--color-muted-foreground)" }} />
      <div className="text-center">
        <div className="font-semibold text-sm truncate max-w-[140px]">{folder.name}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {folder.files.length} {t("encrypted")}
        </div>
      </div>
    </button>
  );
}


export function AuthPrompt({
  open, onCancel, onSuccess,
}: { open: boolean; onCancel: () => void; onSuccess: () => void }) {
  const t = useT();
  // PIN verification is the only supported unlock route at present.
  const [mode, setMode] = useState<"bio" | "pwd">("bio");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    // Until a real Android BiometricPrompt is connected to the key store,
    // never call onSuccess() on a timer or simulated fingerprint scan.
    setMode("pwd");
    setScanning(false);
    if (!open) { setValue(""); setError(""); }
  }, [open]);

  const submit = async () => {
    const ok = await vault.verifyPassword(value);
    if (ok) onSuccess();
    else { setError(t("incorrect_password")); setValue(""); }
  };


  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="rounded-3xl max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-center">{t("authenticate")}</DialogTitle>
          <DialogDescription className="text-center">
            {mode === "bio" ? t("biometric_prompt") : t("enter_pin")}
          </DialogDescription>
        </DialogHeader>
        {mode === "bio" ? (
          <div className="flex flex-col items-center py-4">
            <span
              className="relative grid h-20 w-20 place-items-center rounded-full"
              style={{ background: "color-mix(in oklab, var(--color-accent) 12%, var(--color-surface))" }}
            >
              {scanning && <span className="absolute inset-0 rounded-full animate-pulse-ring" />}
              <Fingerprint size={40} style={{ color: "var(--color-accent)" }} />
            </span>
            <button
              onClick={() => setMode("pwd")}
              className="mt-6 text-xs text-muted-foreground underline underline-offset-4"
            >
              {t("use_pin")}
            </button>
          </div>
        ) : (
          <div>
            <Input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={t("password")}
              className="text-center text-lg h-14 rounded-2xl"
              autoFocus
            />
            {error && <p className="mt-2 text-xs text-center text-destructive">{error}</p>}
            <Button onClick={submit} className="mt-4 w-full h-12 rounded-2xl" disabled={value.length === 0}>
              {t("unlock")}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} className="w-full">{t("cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
