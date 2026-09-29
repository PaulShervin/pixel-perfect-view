import { create } from "zustand";
import { getSim } from "./engine";
import type { Snapshot } from "./types";

interface UiState {
  snap: Snapshot;
  showPaths: boolean;
  selected: string | null;
  refresh: () => void;
  setShowPaths: (v: boolean) => void;
  select: (id: string | null) => void;
}

export const useSimStore = create<UiState>((set) => ({
  snap: getSim().snapshot(),
  showPaths: true,
  selected: "R1",
  refresh: () => set({ snap: getSim().snapshot() }),
  setShowPaths: (v) => set({ showPaths: v }),
  select: (id) => set({ selected: id }),
}));
