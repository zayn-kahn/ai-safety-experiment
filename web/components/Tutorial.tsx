"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** Tutorial mode: on/off switch (remembered), plus the guided tour's current step. */
interface TutorialState {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** Index of the active tour step, or null when the tour is closed. */
  step: number | null;
  setStep: (i: number | null) => void;
  startTour: () => void;
  /** Close the tour and remember that the user has seen it. */
  endTour: () => void;
}

const Ctx = createContext<TutorialState | null>(null);

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
};

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(true);
  const [step, setStep] = useState<number | null>(null);

  // Restore the saved preference, and auto-start the tour on a first visit.
  useEffect(() => {
    const saved = read("vv.tutorial");
    const on = saved === null ? true : saved === "on";
    setEnabledState(on);
    if (on && read("vv.tourSeen") !== "yes" && window.location.pathname === "/") setStep(0);
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    write("vv.tutorial", on ? "on" : "off");
    if (!on) setStep(null);
  }, []);

  const startTour = useCallback(() => setStep(0), []);
  const endTour = useCallback(() => {
    setStep(null);
    write("vv.tourSeen", "yes");
  }, []);

  return <Ctx.Provider value={{ enabled, setEnabled, step, setStep, startTour, endTour }}>{children}</Ctx.Provider>;
}

export function useTutorial(): TutorialState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTutorial outside TutorialProvider");
  return v;
}

/** A short explanation shown under a section only while tutorial mode is on. */
export function Hint({ children }: { children: React.ReactNode }) {
  const { enabled } = useTutorial();
  if (!enabled) return null;
  return <p className="hint">{children}</p>;
}
