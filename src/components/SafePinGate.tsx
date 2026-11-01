import { useEffect, useState } from "react";
import { safePin } from "@/lib/pin-store";
import { vault } from "@/lib/vault-store";
import { useT } from "@/lib/i18n";
import { ShieldCheck, Delete, ArrowLeft } from "lucide-react";

/**
 * Full-screen premium PIN gate. Two modes:
 *  - Setup: enter PIN twice to confirm ("Set PIN").
 *  - Verify: enter existing PIN to unlock.
 */
export function SafePinGate({
  onSuccess, onCancel,
}: { onSuccess: () => void; onCancel: () => void }) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  useEffect(() => {
    setIsSetup(!safePin.hasPin());
    setMounted(true);
  }, []);
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const MAX = 4;

  useEffect(() => {
    if (pin.length !== MAX) return;
    void submit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (!mounted) return null;

  const triggerShake = () => {
    setShake(true);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(50);
    setTimeout(() => setShake(false), 400);
  };

  const submit = async (value: string) => {
    setBusy(true);
    try {
      if (isSetup) {
        if (stage === "enter") {
          setFirstPin(value);
          setPin("");
          setStage("confirm");
          setError("");
        } else {
          if (value !== firstPin) {
            setError(t("pin_mismatch"));
            triggerShake();
            setPin("");
            setFirstPin("");
            setStage("enter");
            return;
          }
          // The PIN must NEVER open a Safe without its matching AES file key.
          // Existing keys cannot be reinitialized by creating a new UI PIN.
          try {
            if (vault.hasPassword()) {
              setError(t("pin_wrong"));
              return;
            }
            await vault.setInitialPassword(value);
            await safePin.setPin(value);
            onSuccess();
          } catch (e) {
            setError(e instanceof Error ? e.message : t("pin_wrong"));
          }
        }
      } else {
        const ok = await safePin.verify(value);
        if (ok) {
          try {
            const keyReady = vault.hasPassword()
              ? (vault.isUnlocked() || await vault.verifyPassword(value))
              : (await vault.setInitialPassword(value), true);
            if (!keyReady) {
              safePin.lock();
              setError(t("pin_wrong"));
              setPin("");
              return;
            }
            onSuccess();
          } catch (e) {
            safePin.lock();
            setError(e instanceof Error ? e.message : t("pin_wrong"));
            setPin("");
          }
        }
        else {
          setError(t("pin_wrong"));
          triggerShake();
          setPin("");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    setError("");
    setPin((p) => (p.length >= MAX ? p : p + d));
  };
  const backspace = () => { setError(""); setPin((p) => p.slice(0, -1)); };

  const title = isSetup
    ? stage === "enter" ? t("set_pin") : t("confirm_pin")
    : t("enter_pin");

  const subtitle = isSetup
    ? stage === "enter" ? t("pin_setup_hint") : t("pin_confirm_hint")
    : t("pin_unlock_hint");

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col overflow-y-auto overflow-x-hidden"
      style={{
        background: "var(--color-background)",
        // Unsupported color-mix gradients are ignored by older Android
        // WebViews; keep the solid background and the actual PIN controls.
        paddingTop: "var(--app-safe-top)",
        paddingBottom: "calc(var(--app-safe-bottom) + 0.75rem)",
        paddingLeft: "var(--app-safe-left)",
        paddingRight: "var(--app-safe-right)",
        overscrollBehavior: "contain",
      }}
    >
      <div className="px-4 pt-4 pb-2">
        <button
          onClick={onCancel}
          className="tap grid h-10 w-10 place-items-center rounded-full"
          style={{ background: "var(--color-surface)" }}
          aria-label={t("back")}
        >
          <ArrowLeft size={20} />
        </button>
      </div>

      <div className="flex min-w-0 flex-col items-center px-4 pt-2">
        <span
          className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl mb-3 shadow-lg sm:h-20 sm:w-20 sm:mb-6"
          style={{
            background: "var(--color-surface)",
            boxShadow: "0 10px 40px -10px rgba(0,0,0,.22)",
          }}
        >
          <ShieldCheck size={38} style={{ color: "var(--color-accent)" }} />
        </span>
        <h1 className="text-2xl font-bold text-center">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground text-center">{subtitle}</p>

        <div
          className={`mt-6 flex items-center gap-3 transition-transform ${shake ? "animate-[shake_.4s_ease-in-out]" : ""}`}
          style={{
            animation: shake ? "shake .4s cubic-bezier(.36,.07,.19,.97) both" : undefined,
          }}
        >
          {Array.from({ length: MAX }).map((_, i) => {
            const filled = i < pin.length;
            return (
              <span
                key={i}
                className="h-3.5 w-3.5 rounded-full transition-all"
                style={{
                  background: filled ? "var(--color-accent)" : "transparent",
                  border: `2px solid ${filled ? "var(--color-accent)" : "var(--color-border)"}`,
                  transform: filled ? "scale(1.15)" : "scale(1)",
                }}
              />
            );
          })}
        </div>

        <p className="mt-3 h-4 text-xs text-destructive">{error || "\u00A0"}</p>

        <div className="mt-3 mx-auto w-full max-w-[220px] grid grid-cols-3 gap-2">
          {["1","2","3","4","5","6","7","8","9"].map((d) => (
            <KeypadBtn key={d} onClick={() => press(d)}>{d}</KeypadBtn>
          ))}
          <span />
          <KeypadBtn onClick={() => press("0")}>0</KeypadBtn>
          <KeypadBtn onClick={backspace} aria-label={t("backspace")}>
            <Delete size={22} />
          </KeypadBtn>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          10%, 90% { transform: translateX(-2px); }
          20%, 80% { transform: translateX(4px); }
          30%, 50%, 70% { transform: translateX(-8px); }
          40%, 60% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
}

function KeypadBtn({
  children, onClick, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="min-h-11 h-12 rounded-xl text-lg font-semibold flex items-center justify-center transition-all active:scale-95"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
