import { create } from "zustand";

export const useMathStore = create((set) => ({
  workspaceMode: "study",
  interactiveParams: {},
  setWorkspaceMode: (mode) => set({ workspaceMode: mode }),
  setInteractiveParam: (key, value) =>
    set((state) => ({
      interactiveParams: {
        ...state.interactiveParams,
        [key]: value,
      },
    })),
}));

