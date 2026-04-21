import { create } from "zustand";

export const useMathStore = create((set) => ({
  workspaceMode: "study",
  interactiveParams: {},
  // Full-screen Interactive Lab overlay state (triggered from chat bubbles)
  labOpen: false,
  labConfig: null,
  // AI 设置弹窗 —— 允许从任意子组件（例如 Quiz 页的错误气泡）直接唤出
  aiSettingsOpen: false,
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
  openAISettings: () => set({ aiSettingsOpen: true }),
  closeAISettings: () => set({ aiSettingsOpen: false }),
}));

