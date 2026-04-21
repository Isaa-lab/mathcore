import { create } from "zustand";

export const useMathStore = create((set) => ({
  workspaceMode: "study",
  interactiveParams: {},
  // Full-screen Interactive Lab overlay state (triggered from chat bubbles)
  labOpen: false,
  labConfig: null,
  setWorkspaceMode: (mode) => set({ workspaceMode: mode }),
  setInteractiveParam: (key, value) =>
    set((state) => ({
      interactiveParams: {
        ...state.interactiveParams,
        [key]: value,
      },
    })),
  openLab: (config) => set({ labOpen: true, labConfig: config || null }),
  closeLab: () => set({ labOpen: false }),
}));

