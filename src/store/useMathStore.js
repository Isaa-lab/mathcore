import { create } from "zustand";

export const useMathStore = create((set) => ({
  interactiveParams: {},
  setInteractiveParam: (key, value) =>
    set((state) => ({
      interactiveParams: {
        ...state.interactiveParams,
        [key]: value,
      },
    })),
}));

