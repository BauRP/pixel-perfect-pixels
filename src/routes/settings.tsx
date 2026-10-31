import { createFileRoute, Link } from "@tanstack/react-router";
import { showPrivacyOptions, usePrivacyOptionsRequired } from "@/lib/native-ads";
import { AppShell, ScreenHeader } from "@/components/AppShell";
import { useVault, vault, totalBytes, fmtBytes } from "@/lib/vault-store";
import { useT, useLang, LANGS, type Lang } from "@/lib/i18n";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Fingerprint, HardDrive, KeyRound, Languages, Palette, FileText, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { safePin, useSafePin } from "@/lib/pin-store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Vault" },
      { name: "description", content: "Pick one of 17 languages, switch the theme, manage the Safe PIN and biometrics." },
      { property: "og:title", content: "Settings — Vault" },
      { property: "og:description", content: "Pick one of 17 languages, switch the theme, manage the Safe PIN and biometrics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsScreen,
});

const CAPACITY = 5 * 1024 ** 3;

function SettingsScreen() {
  const t = useT();
  const [lang, setLang] = useLang();
  const theme = useVault((s) => s.theme);
  // Native biometric authentication has not yet been wired to the AES vault.
  // Never offer an unlock toggle that the OS cannot enforce.
  const folders = useVault((s) => s.folders);
  const used = totalBytes(folders);
  const pct = Math.min(100, (used / CAPACITY) * 100);

  return (
    <AppShell>
      <ScreenHeader title={t("settings")} />

      <div className="px-4 pt-3 flex flex-col gap-3">
        <Group title={t("general")}>
          <Row
            icon={<Languages size={18} />}
            label={t("language")}
            right={
              <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
                <SelectTrigger className="w-[140px] rounded-xl h-9 border-0" style={{ background: "var(--color-muted)" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="end"
                  sideOffset={6}
                  collisionPadding={12}
                  avoidCollisions={false}
                  className="rounded-2xl max-h-[min(13.5rem,var(--radix-select-content-available-height))] overscroll-contain [scroll-behavior:smooth] [-webkit-overflow-scrolling:touch]"
                >
                  {LANGS.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.native}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </Group>

        <Group title={t("appearance")}>
          <Row
            icon={<Palette size={18} />}
            label={t("theme")}
            right={
              <Select value={theme} onValueChange={(v) => vault.setTheme(v as typeof theme)}>
                <SelectTrigger className="w-[140px] rounded-xl h-9 border-0" style={{ background: "var(--color-muted)" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl">
                  <SelectItem value="system">{t("system")}</SelectItem>
                  <SelectItem value="light">{t("light")}</SelectItem>
                  <SelectItem value="dark">{t("dark")}</SelectItem>
                </SelectContent>
              </Select>
            }
          />
        </Group>

        <Group title={t("security")}>
          <Row
            icon={<Fingerprint size={18} />}
            label={t("biometrics")}
            description={t("biometrics_desc")}
            right={<Switch checked={false} disabled aria-label="Biometric authentication unavailable until native verification is implemented" />}
          />
          <Divider />
          <PasswordRow />
          <Divider />
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "var(--color-muted)" }}>
                <HardDrive size={18} />
              </span>
              <div className="flex-1">
                <div className="text-sm font-medium">{t("storage")}</div>
                <div className="text-[10px] text-muted-foreground">
                  {fmtBytes(used)} {t("used")} {fmtBytes(CAPACITY)}
                </div>
              </div>
              <div className="text-xs font-semibold tabular-nums" style={{ color: "var(--color-accent)" }}>
                {pct.toFixed(1)}%
              </div>
            </div>
            <Progress value={pct} className="mt-2 h-1.5" />
          </div>
          <Divider />
          <PrivacyPolicyRow />
          <PrivacyOptionsRow />
        </Group>

        <div className="text-center text-[11px] text-muted-foreground pt-1">
          {t("version_label")}
        </div>
      </div>
    </AppShell>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="px-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        {title}
      </h2>
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
        {children}
      </div>
    </section>
  );
}
function Divider() {
  return <div className="mx-4 h-px" style={{ background: "var(--color-border)" }} />;
}
function Row({
  icon, label, description, right,
}: { icon: ReactNode; label: string; description?: string; right: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg shrink-0" style={{ background: "var(--color-muted)" }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{label}</div>
        {description && <div className="text-[10px] text-muted-foreground truncate">{description}</div>}
      </div>
      {right}
    </div>
  );
}

function PasswordRow() {
  const t = useT();
  const { hasPin } = useSafePin();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); setErr(null); setBusy(false); };

  const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  const save = async () => {
    setErr(null);
    if (!/^\d{4}$/.test(next)) return setErr(t("pin_must_be_4"));
    if (next !== confirm) return setErr(t("pin_mismatch"));
    setBusy(true);
    try {
      if (hasPin) {
        const ok = await safePin.verify(current);
        if (!ok) { setErr(t("pin_wrong")); return; }
      }
      // First re-wrap the encryption key: changing only the UI PIN destroys access.
      if (vault.hasPassword()) {
        if (!hasPin) { setErr(t("pin_wrong")); return; }
        const changed = await vault.changePassword(current, next);
        if (!changed) { setErr(t("pin_wrong")); return; }
      } else {
        await vault.setInitialPassword(next);
      }
      await safePin.setPin(next);
      setOpen(false);
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("pin_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const title = hasPin ? t("change_password") : t("add_password");

  return (
    <>
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="w-full text-left tap"
      >
        <Row
          icon={<KeyRound size={18} />}
          label={title}
          description={t("pin_desc")}
          right={<span className="text-xs text-muted-foreground">{hasPin ? "••••" : "—"}</span>}
        />
      </button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="w-[min(320px,calc(100vw-2.5rem))] rounded-2xl p-4 gap-3 [&>button]:hidden">
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="text-[15px] font-semibold">{title}</DialogTitle>
            <p className="text-[11px] text-muted-foreground">
              {t("pin_must_be_4")}
            </p>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {hasPin && (
              <Input
                type="password" inputMode="numeric" maxLength={4}
                placeholder={t("current_password")}
                value={current}
                onChange={(e) => setCurrent(digitsOnly(e.target.value))}
                className="h-10 rounded-xl border-0 text-center text-sm tracking-[0.4em] placeholder:tracking-normal placeholder:text-xs"
                style={{ background: "var(--color-muted)" }}
                autoFocus
              />
            )}
            <Input
              type="password" inputMode="numeric" maxLength={4}
              placeholder={t("new_password")}
              value={next}
              onChange={(e) => setNext(digitsOnly(e.target.value))}
              className="h-10 rounded-xl border-0 text-center text-sm tracking-[0.4em] placeholder:tracking-normal placeholder:text-xs"
              style={{ background: "var(--color-muted)" }}
              autoFocus={!hasPin}
            />
            <Input
              type="password" inputMode="numeric" maxLength={4}
              placeholder={t("confirm_password")}
              value={confirm}
              onChange={(e) => setConfirm(digitsOnly(e.target.value))}
              className="h-10 rounded-xl border-0 text-center text-sm tracking-[0.4em] placeholder:tracking-normal placeholder:text-xs"
              style={{ background: "var(--color-muted)" }}
            />
            {err && <p className="text-[11px] text-destructive">{err}</p>}
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              className="h-9 flex-1 rounded-xl text-sm"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={save}
              disabled={busy || next.length !== 4 || confirm.length !== 4 || (hasPin && current.length !== 4)}
              className="h-9 flex-1 rounded-xl text-sm"
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PrivacyPolicyRow() {
  const t = useT();
  return (
    <Link to="/privacy" className="block w-full text-left tap" aria-label={t("privacy_policy")}>
      <Row
        icon={<FileText size={18} />}
        label={t("privacy_policy")}
        right={<span className="text-xs text-muted-foreground">›</span>}
      />
    </Link>
  );
}

/** Google UMP privacy options entry — rendered only when the user is in a consent region. */
function PrivacyOptionsRow() {
  const t = useT();
  const required = usePrivacyOptionsRequired();
  if (!required) return null;
  return (
    <>
      <Divider />
      <button onClick={() => void showPrivacyOptions()} className="w-full text-left tap" aria-label={t("privacy_settings")}>
        <Row
          icon={<ShieldCheck size={18} />}
          label={t("privacy_settings")}
          right={<span className="text-xs text-muted-foreground">›</span>}
        />
      </button>
    </>
  );
}
